# North Park Street Sweeping

**Live site: https://senjoshua.github.io/north-park-parking/**

A static map of the street-sweeping schedule for each side of the blocks around
32nd St in North Park, San Diego. Pick a day to see which sides get swept. Tap a side to
see its sign and upcoming dates, and save where you parked (stored only in your browser).

## Run locally

Open `index.html` in a browser. No server or build step is needed, just an internet
connection for the map tiles, map library and fonts.

## Host on GitHub Pages

1. Push this folder to a GitHub repo.
2. Repo **Settings → Pages → Build and deployment**: Source = *Deploy from a branch*,
   Branch = `main`, folder = `/ (root)`.
3. The site appears at `https://<user>.github.io/<repo>/`.

No build step or backend. Leaflet, MapLibre and the fonts load from public CDNs. The basemap is
[OpenFreeMap](https://openfreemap.org) vector tiles (free, no API key), recolored to match the page.
If WebGL or OpenFreeMap is unavailable it falls back to OpenStreetMap / Esri raster tiles.

## Files

| File | What it is |
| --- | --- |
| `index.html`, `styles.css`, `app.js` | The page |
| `sign.js` | Draws the sign icon (SVG) for a block side |
| `data/segments.js` | Schedule + geometry per block side (generated) |
| `tools/build_data.py` | Re-fetches schedules from the City of San Diego GeoSweep service |

## Updating schedules

    python3 tools/build_data.py

This queries the city's public GeoSweep "Street Sweeping Route" layer for the
blocks inside the `AREA` outline and rewrites `data/segments.js`. To cover more or
fewer streets, edit `AREA` in that script. You can also edit `data/segments.js` by hand
(`day`: 0=Sun…6=Sat; `weeks`: `[2, 4]` for 2nd & 4th, `null` for every week).
