import maplibregl from './maplibre.js';
import { load, save } from './prefs.js';
import { registerTileProtocol, viaCache } from './offline.js';

// ---------- Base maps (all free, no API keys) ----------
export const BASEMAPS = {
  satellite: {
    label: 'Satellite',
    tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
    maxzoom: 19,
    attribution: 'Imagery © <a href="https://www.esri.com/">Esri</a>, Maxar, Earthstar Geographics, USDA FSA, USGS, and the GIS User Community',
  },
  topo: {
    label: 'Topo',
    tiles: ['https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}'],
    maxzoom: 16,
    attribution: '<a href="https://www.usgs.gov/programs/national-geospatial-program/national-map">USGS The National Map</a>',
  },
  photo: {
    label: 'USGS Photo',
    tiles: ['https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}'],
    maxzoom: 16,
    attribution: '<a href="https://www.usgs.gov/programs/national-geospatial-program/national-map">USGS The National Map</a> (NAIP imagery)',
  },
};

// Esri reference overlay (roads + place names) for the satellite view.
const LABEL_TILES = [
  'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}',
  'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
];

// ---------- Public land layers (static GeoJSON in public/data) ----------
export const OVERLAYS = [
  {
    id: 'federal',
    label: 'Federal land (National Forest, Corps, Refuges)',
    file: 'data/federal.geojson',
    // colour by managing agency
    color: ['match', ['get', 'manager'], 'USFS', '#c6e85c', 'USACE', '#56a8ff', 'FWS', '#d58cff', 'NPS', '#e0a36b', '#ffe14d'],
    swatch: '#c6e85c',
  },
  { id: 'ca', label: 'MDC Conservation Areas', file: 'data/mdc-conservation-areas.geojson', color: '#4dff7c', swatch: '#4dff7c' },
  { id: 'na', label: 'MDC Natural Areas', file: 'data/mdc-natural-areas.geojson', color: '#33f0ee', swatch: '#33f0ee', dashed: true },
  { id: 'mrap', label: 'MRAP land (private, open to public)', file: 'data/mdc-mrap.geojson', color: '#ffa31a', swatch: '#ffa31a' },
];

const MISSOURI = [[-95.78, 35.99], [-89.1, 40.62]];
const DEFAULT_VIEW = { center: [-94.34, 37.85], zoom: 10 }; // Vernon County

export function createMap(container) {
  const base = new URL('.', location.href).href; // app folder, works on GitHub Pages sub-paths
  const prefs = load('map', { basemap: 'satellite', labels: true, overlays: Object.fromEntries(OVERLAYS.map((o) => [o.id, true])) });
  const view = load('view', DEFAULT_VIEW);

  const sources = {};
  const layers = [];
  registerTileProtocol();
  for (const [id, b] of Object.entries(BASEMAPS)) {
    // USGS maps go through cache:// so downloaded offline areas are used automatically.
    const tiles = id === 'satellite' ? b.tiles : b.tiles.map(viaCache);
    sources[`bm-${id}`] = { type: 'raster', tiles, tileSize: 256, maxzoom: b.maxzoom, attribution: b.attribution };
    layers.push({ id: `bm-${id}`, type: 'raster', source: `bm-${id}`, layout: { visibility: prefs.basemap === id ? 'visible' : 'none' } });
  }
  LABEL_TILES.forEach((t, i) => {
    sources[`ref-${i}`] = { type: 'raster', tiles: [t], tileSize: 256, maxzoom: 19 };
    layers.push({ id: `ref-${i}`, type: 'raster', source: `ref-${i}`, layout: { visibility: 'none' } });
  });

  for (const o of OVERLAYS) {
    sources[o.id] = { type: 'geojson', data: base + o.file, attribution: o.id === 'federal' ? 'USGS PAD-US' : 'Missouri Dept. of Conservation' };
    const vis = prefs.overlays[o.id] !== false ? 'visible' : 'none';
    layers.push({
      id: `${o.id}-fill`, type: 'fill', source: o.id, layout: { visibility: vis },
      paint: { 'fill-color': o.color, 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 6, 0.35, 14, 0.18] },
    });
    // dark edge under the coloured line so boundaries stand out on both satellite and topo
    layers.push({
      id: `${o.id}-casing`, type: 'line', source: o.id, layout: { visibility: vis, 'line-join': 'round' },
      paint: { 'line-color': '#000', 'line-opacity': 0.55, 'line-width': ['interpolate', ['linear'], ['zoom'], 7, 2.5, 12, 4.5, 16, 7] },
    });
    layers.push({
      id: `${o.id}-line`, type: 'line', source: o.id, layout: { visibility: vis, 'line-join': 'round' },
      paint: {
        'line-color': o.color,
        'line-width': ['interpolate', ['linear'], ['zoom'], 7, 1, 12, 2.5, 16, 4],
        ...(o.dashed ? { 'line-dasharray': [2, 1.5] } : {}),
      },
    });
  }
  // Labels last so they sit on top of every fill.
  for (const o of OVERLAYS) {
    layers.push({
      id: `${o.id}-label`, type: 'symbol', source: o.id, minzoom: o.id === 'federal' ? 8 : 11,
      layout: {
        visibility: prefs.overlays[o.id] !== false ? 'visible' : 'none',
        'text-field': ['get', 'label'],
        'text-font': ['Open Sans Semibold'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 10, 11, 15, 15],
        'text-max-width': 9,
        'symbol-placement': 'point',
      },
      paint: { 'text-color': '#ffffff', 'text-halo-color': 'rgba(0,0,0,0.85)', 'text-halo-width': 1.6 },
    });
  }

  const map = new maplibregl.Map({
    container,
    style: { version: 8, glyphs: `${base}fonts/{fontstack}/{range}.pbf`, sources, layers },
    center: view.center,
    zoom: view.zoom,
    bearing: view.bearing || 0,
    maxBounds: [[MISSOURI[0][0] - 3, MISSOURI[0][1] - 3], [MISSOURI[1][0] + 3, MISSOURI[1][1] + 3]],
    maxZoom: 19,
    minZoom: 5,
    attributionControl: false,
    pitchWithRotate: false,
    dragRotate: true,
    fadeDuration: 0,
  });
  map.touchPitch.disable();
  map.addControl(new maplibregl.ScaleControl({ unit: 'imperial', maxWidth: 110 }), 'bottom-left');
  // Attribution as a small (i) button in the corner; tap it to read the credits.
  map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left');
  // MapLibre re-opens the credits on load/resize; keep them closed unless the (i) is tapped.
  const attrib = map.getContainer().querySelector('.maplibregl-ctrl-attrib');
  if (attrib) {
    let userOpened = false;
    attrib.addEventListener('click', (e) => {
      if (e.target.closest('.maplibregl-ctrl-attrib-button')) userOpened = attrib.classList.contains('maplibregl-compact-show');
    });
    new MutationObserver(() => {
      if (!userOpened && attrib.classList.contains('maplibregl-compact-show')) attrib.classList.remove('maplibregl-compact-show');
    }).observe(attrib, { attributes: true, attributeFilter: ['class'] });
    attrib.classList.remove('maplibregl-compact-show');
  }

  map.on('moveend', () => {
    const c = map.getCenter();
    save('view', { center: [c.lng, c.lat], zoom: map.getZoom(), bearing: map.getBearing() });
  });

  const state = { prefs, map };

  // ---------- switching ----------
  state.setBasemap = (id) => {
    prefs.basemap = id;
    for (const k of Object.keys(BASEMAPS)) map.setLayoutProperty(`bm-${k}`, 'visibility', k === id ? 'visible' : 'none');
    state.applyLabels();
    save('map', prefs);
  };
  state.applyLabels = () => {
    const on = prefs.labels && prefs.basemap !== 'topo';
    LABEL_TILES.forEach((_, i) => map.setLayoutProperty(`ref-${i}`, 'visibility', on ? 'visible' : 'none'));
  };
  state.setLabels = (on) => {
    prefs.labels = on;
    state.applyLabels();
    save('map', prefs);
  };
  state.setOverlay = (id, on) => {
    prefs.overlays[id] = on;
    for (const s of ['fill', 'casing', 'line', 'label']) map.setLayoutProperty(`${id}-${s}`, 'visibility', on ? 'visible' : 'none');
    save('map', prefs);
  };
  map.on('load', () => state.applyLabels());

  // ---------- what's here? ----------
  state.featuresAt = (point) => {
    const r = 4;
    const fillLayers = OVERLAYS.map((o) => `${o.id}-fill`).filter((l) => map.getLayoutProperty(l, 'visibility') !== 'none');
    const hits = map.queryRenderedFeatures([[point.x - r, point.y - r], [point.x + r, point.y + r]], { layers: fillLayers });
    const seen = new Set();
    return hits.filter((f) => {
      const key = `${f.source}:${f.properties.name}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).map((f) => ({ ...f.properties, _source: f.source }));
  };

  return state;
}
