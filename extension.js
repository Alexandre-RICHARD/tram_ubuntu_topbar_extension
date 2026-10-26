import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Soup from 'gi://Soup?version=3.0';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

import { decodeTripUpdates, findNextDepartures } from './gtfs.js';

// Flux GTFS-RT Irigo : heures de passage prévues pour l'heure à venir (le même que la carte du site)
const TRIP_UPDATES_URL = 'https://ara-api.enroute.mobi/irigo/gtfs/trip-updates';

// Ligne B, au départ de Belle-Beille Campus, direction Monplaisir.
// Les courses direction_id 0 (vers Belle-Beille) passent aussi à 1BBCA, en terminus : on les exclut.
const DEPARTURE = {
    routeId: 'B',
    directionId: 1,
    stopId: '1BBCA',
};
const LINE_LABEL = 'B';
const DEPARTURE_COUNT = 1;

const FETCH_INTERVAL_SECONDS = 30;
const RENDER_INTERVAL_SECONDS = 10;
const REQUEST_TIMEOUT_SECONDS = 10;

// Au-delà, les prévisions affichées sont estompées : le flux ne répond plus
const STALE_AFTER_SECONDS = 3 * 60;

/** "3 min", "à l'approche" (même formulation que le site) */
function formatDelay(timeSeconds, nowSeconds) {
    const minutes = Math.round((timeSeconds - nowSeconds) / 60);
    return minutes <= 0 ? "à l'approche" : `${minutes} min`;
}

export default class TramExtension extends Extension {
    enable() {
        this._feed = null;
        this._lastFetch = 0;
        this._hasFailed = false;
        this._cancellable = new Gio.Cancellable();
        this._session = new Soup.Session({ timeout: REQUEST_TIMEOUT_SECONDS });

        this._button = new St.Button({
            style_class: 'tram-button',
            reactive: true,
            can_focus: true,
            track_hover: true,
            y_align: Clutter.ActorAlign.CENTER,
        });

        const box = new St.BoxLayout({
            style_class: 'tram-box',
            vertical: false,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._button.set_child(box);

        const badge = new St.Label({
            text: LINE_LABEL,
            style_class: 'tram-line-badge',
            y_align: Clutter.ActorAlign.CENTER,
        });
        box.add_child(badge);

        this._label = new St.Label({
            text: '…',
            style_class: 'tram-departures',
            y_align: Clutter.ActorAlign.CENTER,
        });
        box.add_child(this._label);

        // Clic : rafraîchissement immédiat
        this._button.connect('clicked', () => this._fetch());

        Main.panel._centerBox.insert_child_at_index(this._button, 0);

        this._fetch();
        this._fetchTimerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, FETCH_INTERVAL_SECONDS, () => {
            this._fetch();
            return GLib.SOURCE_CONTINUE;
        });
        // Entre deux téléchargements, les minutes restantes défilent à partir du dernier flux reçu
        this._renderTimerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, RENDER_INTERVAL_SECONDS, () => {
            this._render();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _fetch() {
        const message = Soup.Message.new('GET', TRIP_UPDATES_URL);
        this._session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, this._cancellable, (session, result) => {
            try {
                const bytes = session.send_and_read_finish(result);
                if (message.get_status() !== Soup.Status.OK) {
                    throw new Error(`HTTP ${message.get_status()}`);
                }
                this._feed = decodeTripUpdates(bytes.get_data());
                this._lastFetch = Date.now() / 1000;
                this._hasFailed = false;
            } catch (error) {
                if (error.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) return;
                this._hasFailed = true;
                console.warn(`[tram] Flux Irigo indisponible : ${error.message}`);
            }
            this._render();
        });
    }

    _render() {
        if (!this._label) return;

        const now = Date.now() / 1000;
        const isStale = now - this._lastFetch > STALE_AFTER_SECONDS;
        if (isStale) this._button.add_style_class_name('tram-stale');
        else this._button.remove_style_class_name('tram-stale');

        if (!this._feed) {
            this._label.set_text(this._hasFailed ? '?' : '…');
            return;
        }

        const departures = findNextDepartures(this._feed, DEPARTURE, now).slice(0, DEPARTURE_COUNT);
        this._label.set_text(departures.length > 0
            ? departures.map(time => formatDelay(time, now)).join(' · ')
            : '—');
    }

    disable() {
        if (this._fetchTimerId) {
            GLib.Source.remove(this._fetchTimerId);
            this._fetchTimerId = 0;
        }
        if (this._renderTimerId) {
            GLib.Source.remove(this._renderTimerId);
            this._renderTimerId = 0;
        }

        this._cancellable?.cancel();
        this._cancellable = null;
        this._session?.abort();
        this._session = null;

        if (this._button) {
            this._button.destroy();
            this._button = null;
        }
        this._label = null;
        this._feed = null;
    }
}
