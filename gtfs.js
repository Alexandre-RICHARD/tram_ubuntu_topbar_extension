// Décodeur GTFS-RT minimal : ne lit que les champs utiles aux prochains passages.
// Pas de dépendance (ni protobufjs ni gi://) : testable tel quel avec Node.
// Numéros de champs : gtfs-realtime.proto (github.com/google/transit).

const WIRE_VARINT = 0;
const WIRE_64BIT = 1;
const WIRE_LENGTH_DELIMITED = 2;
const WIRE_32BIT = 5;

const SKIPPED = 1; // StopTimeUpdate.ScheduleRelationship

const textDecoder = new TextDecoder();

/** Parcourt les champs d'un message protobuf, appelle onField(numéro, valeur) pour chacun */
function readMessage(bytes, start, end, onField) {
    let pos = start;

    // Varint en arithmétique flottante : les timestamps int64 dépassent les 32 bits des opérateurs binaires
    const readVarint = () => {
        let value = 0;
        let factor = 1;
        let byte;
        do {
            byte = bytes[pos++];
            value += (byte & 0x7f) * factor;
            factor *= 128;
        } while (byte & 0x80);
        return value;
    };

    while (pos < end) {
        const key = readVarint();
        const field = Math.floor(key / 8);
        const wireType = key % 8;

        switch (wireType) {
        case WIRE_VARINT:
            onField(field, readVarint());
            break;
        case WIRE_LENGTH_DELIMITED: {
            const length = readVarint();
            onField(field, { start: pos, end: pos + length });
            pos += length;
            break;
        }
        case WIRE_64BIT:
            pos += 8;
            break;
        case WIRE_32BIT:
            pos += 4;
            break;
        default:
            throw new Error(`Type protobuf inconnu : ${wireType}`);
        }
    }
}

function readString(bytes, range) {
    return textDecoder.decode(bytes.subarray(range.start, range.end));
}

/** StopTimeEvent → time (s depuis l'epoch) */
function readEventTime(bytes, range) {
    let time;
    readMessage(bytes, range.start, range.end, (field, value) => {
        if (field === 2) time = value;
    });
    return time;
}

function readStopTimeUpdate(bytes, range) {
    const update = { stopId: undefined, arrival: undefined, departure: undefined, skipped: false };
    readMessage(bytes, range.start, range.end, (field, value) => {
        if (field === 2) update.arrival = readEventTime(bytes, value);
        else if (field === 3) update.departure = readEventTime(bytes, value);
        else if (field === 4) update.stopId = readString(bytes, value);
        else if (field === 5) update.skipped = value === SKIPPED;
    });
    return update;
}

function readTripDescriptor(bytes, range) {
    const trip = { tripId: undefined, routeId: undefined, directionId: undefined };
    readMessage(bytes, range.start, range.end, (field, value) => {
        if (field === 1) trip.tripId = readString(bytes, value);
        else if (field === 5) trip.routeId = readString(bytes, value);
        else if (field === 6) trip.directionId = value;
    });
    return trip;
}

function readTripUpdate(bytes, range) {
    const tripUpdate = { trip: undefined, stopTimeUpdates: [] };
    readMessage(bytes, range.start, range.end, (field, value) => {
        if (field === 1) tripUpdate.trip = readTripDescriptor(bytes, value);
        else if (field === 2) tripUpdate.stopTimeUpdates.push(readStopTimeUpdate(bytes, value));
    });
    return tripUpdate;
}

/** FeedMessage → { timestamp, tripUpdates } */
export function decodeTripUpdates(bytes) {
    const feed = { timestamp: undefined, tripUpdates: [] };
    readMessage(bytes, 0, bytes.length, (field, value) => {
        if (field === 1) {
            readMessage(bytes, value.start, value.end, (headerField, headerValue) => {
                if (headerField === 3) feed.timestamp = headerValue;
            });
        } else if (field === 2) {
            readMessage(bytes, value.start, value.end, (entityField, entityValue) => {
                if (entityField === 3) feed.tripUpdates.push(readTripUpdate(bytes, entityValue));
            });
        }
    });
    return feed;
}

/** Prochains départs (s depuis l'epoch, triés) d'une ligne, dans un sens, à un arrêt donné */
export function findNextDepartures(feed, { routeId, directionId, stopId }, now) {
    const departures = [];
    for (const { trip, stopTimeUpdates } of feed.tripUpdates) {
        if (trip?.routeId !== routeId || trip.directionId !== directionId) continue;

        const update = stopTimeUpdates.find(stopTimeUpdate => stopTimeUpdate.stopId === stopId);
        if (!update || update.skipped) continue;

        const time = update.departure ?? update.arrival;
        if (time !== undefined && time >= now) departures.push(time);
    }
    return departures.sort((a, b) => a - b);
}
