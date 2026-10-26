# Tram B — Belle-Beille Campus

Extension GNOME Shell qui affiche, dans la barre du haut (top bar), les deux prochains départs du tram B depuis l'arrêt **Belle-Beille Campus**, direction **Monplaisir**.

```
[B] 4 min · 12 min
```

## Fonctionnalités

- Pastille « B » aux couleurs officielles de la ligne (`#00569D`), comme sur la carte du site.
- Minutes restantes avant les 2 prochains départs, « à l'approche » quand le tram est imminent.
- Flux téléchargé toutes les 30 s, affichage recalculé toutes les 10 s entre deux téléchargements.
- Clic sur l'indicateur : rafraîchissement immédiat.
- `…` au démarrage, `—` si aucun départ dans l'heure (nuit), `?` si le flux est injoignable. Les minutes s'estompent si le flux ne répond plus depuis 3 min.

## Comment ça fonctionne

- **Source** : flux GTFS-RT `trip-updates` d'Irigo (`https://ara-api.enroute.mobi/irigo/gtfs/trip-updates`), le même que la carte du site. Il donne les heures de passage prévues, en temps réel, pour l'heure à venir.
- **Décodage** : `gtfs.js` contient un petit décodeur protobuf qui ne lit que les champs utiles, sans dépendance. Il est testable avec Node.
- **Filtre** : ligne `B`, sens `direction_id = 1` (vers Monplaisir), arrêt `1BBCA` (quai Belle-Beille Campus). Les trams qui arrivent en terminus passent aussi par `1BBCA`, mais dans l'autre sens (`direction_id = 0`) : ils sont exclus. Les courses limitées à Molière partent dans le bon sens, elles sont comptées.

Ces réglages sont des constantes en haut de `extension.js` (`DEPARTURE`, `DEPARTURE_COUNT`, intervalles).

## Structure des fichiers

```
tram-b@custom/
├── extension.js   # Indicateur, téléchargement et affichage
├── gtfs.js        # Décodeur GTFS-RT minimal + recherche des prochains départs
├── metadata.json  # Métadonnées GNOME Shell (uuid, versions supportées, etc.)
└── stylesheet.css # Pastille de ligne et texte
```

## Installation

L'`uuid` du dossier doit correspondre à celui de `metadata.json` (`tram-b@custom`) :

```bash
cp -r tram_extension ~/.local/share/gnome-shell/extensions/tram-b@custom
```

Puis déconnexion/reconnexion (Wayland) ou `Alt + F2` → `r` (X11), et :

```bash
gnome-extensions enable tram-b@custom
```

Logs en cas de souci : `journalctl -f -o cat /usr/bin/gnome-shell | grep tram`.

Support des versions GNOME Shell `45` et `46` déclaré dans le `metadata.json`.
