// Offline map areas: download USGS base map tiles for a box into the phone's Cache Storage.
// The map reads tiles through the "cache://" protocol (see tileProtocol), which uses a saved copy
// when there is one and the network otherwise.
import maplibregl from './maplibre.js';
import { getAll, put, remove, newId } from './storage.js';

// Only public-domain USGS maps are downloadable. Esri's terms don't allow offline copies.
export const OFFLINE_LAYERS = {
  topo: { label: 'Topo', url: 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}', estKB: 18, maxZoom: 16 },
  photo: { label: 'USGS Photo', url: 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}', estKB: 22, maxZoom: 16 },
};
export const MIN_ZOOM = 8; // zoomed-out overview always included (only a handful of tiles)
export const MAX_TILES = 20000; // per area, to be polite to the free USGS servers (~400 MB)
const CONCURRENCY = 4;

// ---------- tile math ----------
const lon2x = (lon, z) => Math.floor(((lon + 180) / 360) * 2 ** z);
const lat2y = (lat, z) => {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
};
function ranges(b, minZ, maxZ) {
  const out = [];
  for (let z = minZ; z <= maxZ; z++) {
    const x0 = lon2x(b.west, z), x1 = lon2x(b.east, z);
    const y0 = lat2y(b.north, z), y1 = lat2y(b.south, z);
    out.push({ z, x0, x1, y0, y1, n: (x1 - x0 + 1) * (y1 - y0 + 1) });
  }
  return out;
}
function* tileUrls(area) {
  for (const layer of area.layers) {
    const tpl = OFFLINE_LAYERS[layer].url;
    for (const r of ranges(area.bounds, area.minZoom, Math.min(area.maxZoom, OFFLINE_LAYERS[layer].maxZoom))) {
      for (let x = r.x0; x <= r.x1; x++) for (let y = r.y0; y <= r.y1; y++) {
        yield tpl.replace('{z}', r.z).replace('{x}', x).replace('{y}', y);
      }
    }
  }
}

export function estimate(bounds, maxZoom, layers) {
  let tiles = 0, kb = 0;
  for (const l of layers) {
    const n = ranges(bounds, MIN_ZOOM, Math.min(maxZoom, OFFLINE_LAYERS[l].maxZoom)).reduce((s, r) => s + r.n, 0);
    tiles += n;
    kb += n * OFFLINE_LAYERS[l].estKB;
  }
  return { tiles, bytes: kb * 1024 };
}

export const fmtBytes = (b) => (b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : b >= 1e6 ? `${Math.round(b / 1e6)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`);

// ---------- map integration ----------
// Base map sources use cache://host/path URLs; this serves the saved tile if we have it.
let registered = false;
export function registerTileProtocol() {
  if (registered) return;
  registered = true;
  maplibregl.addProtocol('cache', async (params, abortController) => {
    const url = `https://${params.url.slice('cache://'.length)}`;
    if ('caches' in self) {
      try {
        const hit = await caches.match(url);
        if (hit) return { data: await hit.arrayBuffer() };
      } catch {
        /* fall through to network */
      }
    }
    const res = await fetch(url, { signal: abortController.signal });
    if (!res.ok) throw new Error(`Tile ${res.status}`);
    return { data: await res.arrayBuffer(), cacheControl: res.headers.get('cache-control'), expires: res.headers.get('expires') };
  });
}
export const viaCache = (url) => url.replace(/^https:\/\//, 'cache://');

// ---------- areas ----------
export const listAreas = () => getAll('areas');

export async function deleteArea(id) {
  await caches.delete(`tiles-${id}`);
  await remove('areas', id);
}

export function newArea({ name, bounds, maxZoom, layers }) {
  const { tiles, bytes } = estimate(bounds, maxZoom, layers);
  return { id: newId(), name, bounds, minZoom: MIN_ZOOM, maxZoom, layers, tiles, estBytes: bytes, bytes: 0, done: 0, failed: 0, complete: false, created: Date.now() };
}

// Download (or resume) an area. Calls onProgress(area) as it goes. Stop with signal.abort().
export async function downloadArea(area, { onProgress, signal }) {
  const cache = await caches.open(`tiles-${area.id}`);
  area.done = 0;
  area.failed = 0;
  area.complete = false;
  await put('areas', area);
  const it = tileUrls(area);
  let lastSave = Date.now();

  async function worker() {
    for (;;) {
      if (signal.aborted) return;
      const next = it.next();
      if (next.done) return;
      const url = next.value;
      try {
        if (!(await cache.match(url))) {
          let res;
          for (let attempt = 0; attempt < 2; attempt++) {
            res = await fetch(url, { mode: 'cors', signal });
            if (res.ok) break;
          }
          if (!res.ok) throw new Error(res.status);
          const blob = await res.blob();
          await cache.put(url, new Response(blob, { headers: { 'Content-Type': res.headers.get('Content-Type') || 'image/jpeg' } }));
          area.bytes += blob.size;
        }
        area.done++;
      } catch (err) {
        if (signal.aborted) return;
        area.failed++;
      }
      onProgress(area);
      if (Date.now() - lastSave > 3000) {
        lastSave = Date.now();
        put('areas', area);
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  area.complete = !signal.aborted && area.done + area.failed >= area.tiles;
  await put('areas', area);
  onProgress(area);
  return area;
}
