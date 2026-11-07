# MO Hunt Map

A free, personal hunting map for Missouri that you install on your phone like an app (a PWA).

## What's in Phase 1
- Satellite (Esri), Topo (USGS) and USGS Photo base maps, with an optional roads and place names overlay
- Public land: MDC Conservation Areas, Natural Areas, MRAP land, and federal land (Mark Twain NF, Corps lakes, refuges) from USGS PAD-US
- Tap any area to see its name, acreage, type, owner, county and links to MDC regulations and maps
- GPS location with heading. The locate button cycles: follow me → map turns with compass → follow me
- Public land data is built into the app, so it works with no signal once installed

## Phase 2: waypoints and tracks
- Pin button: drop a waypoint (stand, blind, trail cam, scrape, rub, parking, deer sighting, harvest) with a name and notes
- Track button: record a walk in or out, with distance and time (keep the screen on)
- List button: all waypoints (nearest first) and tracks. Everything is saved on the phone (IndexedDB)

## Phase 3: measure and share
- Ruler button: tap points to measure distance or area (acres)
- Share any waypoint or track, or Share all, as a GPX file by text, email or AirDrop. Import GPX or GeoJSON from family or other apps

## Phase 4: offline maps
- Layers → Offline maps → Download an area. Fit the area in the box, pick Topo and/or USGS Photo and the detail level, check the size, then download
- Only the public-domain USGS maps can be downloaded. Esri satellite stays online-only because of its terms of use
- Each area is capped at 20,000 tiles (about a 25-mile box at Best detail) to respect the free USGS servers
- Downloaded areas show as dashed white boxes. Delete them from the same panel

## Folder layout
```
index.html              the page
src/                    app code (map.js, gps.js, main.js, styles.css ...)
public/data/            public land GeoJSON (downloaded by scripts/fetch-data.mjs)
public/fonts/           label font, so labels work offline
public/icons/           app icons (made by scripts/make-icons.mjs)
public/sw.js            service worker (offline support)
public/manifest.webmanifest   makes it installable
scripts/                one-time data and icon scripts
phone-test.cmd          double-click to test on your phone over Wi-Fi
```

## Updating public land data
About once a year, run `npm run fetch-data`. It re-downloads the MDC and PAD-US boundaries.

## Private land (Vernon County)
Vernon County's parcel map is hosted by a vendor (IntegrityGIS), and the county doesn't publish a free download, so it isn't built into the app. The Layers panel links to the county's viewer instead.

## Data credits
Missouri Department of Conservation; USGS PAD-US 4.1; USGS The National Map; Esri World Imagery (personal, non-commercial use).
