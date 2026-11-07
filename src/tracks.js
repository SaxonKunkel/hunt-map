import { getAll, put, remove, newId } from './storage.js';
import { openSheet, closeSheets, esc, toast } from './ui.js';
import { distance, lineLength, fmtDistance, fmtDuration, fmtDate } from './geo.js';
import { toGPX, shareFile, exportName } from './io.js';

const MIN_STEP_M = 4; // ignore GPS jitter smaller than this
const MAX_ACCURACY_M = 35; // ignore poor fixes

const TRACK_COLOR = '#ff3df0';
const LIVE_COLOR = '#ff2d55';

export function createTracks(map, { onRecordingChange }) {
  const tracks = new Map(); // id -> track
  let visible = true;
  let rec = null; // track being recorded
  let watchId = null;
  let wakeLock = null;
  let lastSave = 0;

  const fc = (features) => ({ type: 'FeatureCollection', features });
  const lineOf = (t) => ({
    type: 'Feature',
    properties: { id: t.id, name: t.name },
    geometry: { type: 'LineString', coordinates: t.points.map((p) => [p[0], p[1]]) },
  });

  map.on('load', () => {
    map.addSource('tracks', { type: 'geojson', data: fc([]) });
    map.addSource('track-live', { type: 'geojson', data: fc([]) });
    for (const [src, color, dash] of [['tracks', TRACK_COLOR, false], ['track-live', LIVE_COLOR, true]]) {
      map.addLayer({
        id: `${src}-casing`, type: 'line', source: src,
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': '#000', 'line-opacity': 0.6, 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 4, 16, 8] },
      });
      map.addLayer({
        id: `${src}-line`, type: 'line', source: src,
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': color,
          'line-width': ['interpolate', ['linear'], ['zoom'], 10, 2.5, 16, 5],
          ...(dash ? { 'line-dasharray': [1.5, 1] } : {}),
        },
      });
    }
    refresh();
    refreshLive();
  });

  function refresh() {
    map.getSource('tracks')?.setData(fc(visible ? [...tracks.values()].filter((t) => t.points.length > 1).map(lineOf) : []));
  }
  function refreshLive() {
    map.getSource('track-live')?.setData(fc(rec && rec.points.length > 1 ? [lineOf(rec)] : []));
  }

  async function load() {
    for (const t of await getAll('tracks')) {
      if (t.recording) {
        // App was closed while recording: offer to keep going.
        rec = t;
        refreshLive();
        toast(`Unfinished track “${esc(t.name)}” (${fmtDistance(t.distance)}).`, {
          ms: 0,
          actions: [
            { label: 'Resume', run: () => resume() },
            { label: 'Finish', secondary: true, run: () => stop() },
          ],
        });
      } else tracks.set(t.id, t);
    }
    refresh();
  }

  // ---------- recording ----------
  async function keepAwake() {
    try {
      if ('wakeLock' in navigator && document.visibilityState === 'visible') wakeLock = await navigator.wakeLock.request('screen');
    } catch {
      /* not supported: screen may sleep */
    }
  }
  document.addEventListener('visibilitychange', () => {
    if (rec && document.visibilityState === 'visible') keepAwake();
  });

  function onPosition(pos) {
    if (!rec) return;
    const { longitude, latitude, accuracy, altitude } = pos.coords;
    if (accuracy > MAX_ACCURACY_M) return;
    const pt = [longitude, latitude, pos.timestamp || Date.now(), altitude == null ? null : Math.round(altitude * 10) / 10];
    const prev = rec.points[rec.points.length - 1];
    if (prev) {
      const d = distance(prev, pt);
      if (d < Math.max(MIN_STEP_M, accuracy * 0.5)) return;
      rec.distance += d;
    }
    rec.points.push(pt);
    refreshLive();
    onRecordingChange(status());
    // save progress every ~10 s so nothing is lost if the phone kills the app
    if (Date.now() - lastSave > 10000) {
      lastSave = Date.now();
      put('tracks', rec);
    }
  }

  function watch() {
    watchId = navigator.geolocation.watchPosition(onPosition, () => {}, { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 });
    keepAwake();
    onRecordingChange(status());
  }

  async function start() {
    if (rec) return;
    rec = { id: newId(), name: `Track ${fmtDate(Date.now())}`, points: [], distance: 0, started: Date.now(), recording: true };
    await put('tracks', rec);
    watch();
  }

  function resume() {
    if (rec && watchId == null) watch();
  }

  async function stop() {
    if (!rec) return null;
    if (watchId != null) navigator.geolocation.clearWatch(watchId);
    watchId = null;
    wakeLock?.release().catch(() => {});
    wakeLock = null;
    const t = rec;
    rec = null;
    refreshLive();
    onRecordingChange(null);
    if (t.points.length < 2) {
      await remove('tracks', t.id);
      toast('Track too short. Not saved.');
      return null;
    }
    t.recording = false;
    t.ended = t.points[t.points.length - 1][2] || Date.now();
    await put('tracks', t);
    tracks.set(t.id, t);
    refresh();
    return t;
  }

  function status() {
    if (!rec) return null;
    return { distance: rec.distance, elapsed: Date.now() - rec.started, points: rec.points.length, active: watchId != null };
  }

  // ---------- viewing ----------
  function trackAt(point) {
    if (!visible || !map.getLayer('tracks-line')) return null;
    const r = 8;
    const hit = map.queryRenderedFeatures([[point.x - r, point.y - r], [point.x + r, point.y + r]], { layers: ['tracks-line'] })[0];
    return hit ? tracks.get(hit.properties.id) : null;
  }

  function zoomTo(t) {
    const xs = t.points.map((p) => p[0]);
    const ys = t.points.map((p) => p[1]);
    map.fitBounds([[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]], { padding: 60, maxZoom: 17 });
  }

  function showCard(id) {
    const t = tracks.get(id);
    if (!t) return;
    const body = openSheet(`
      <article class="card">
        <h3><span class="swatch" style="--c:${TRACK_COLOR}"></span>${esc(t.name)}</h3>
        <dl>
          <dt>Distance</dt><dd>${fmtDistance(t.distance || lineLength(t.points))}</dd>
          ${t.started && t.ended ? `<dt>Time</dt><dd>${fmtDuration(t.ended - t.started)}</dd>` : ''}
          ${t.started ? `<dt>Started</dt><dd>${fmtDate(t.started)}</dd>` : ''}
        </dl>
        ${t.notes ? `<p class="notes">${esc(t.notes)}</p>` : ''}
        <div class="actions">
          <button type="button" class="btn" data-act="zoom">Show all</button>
          <button type="button" class="btn" data-act="share">Share</button>
          <button type="button" class="btn" data-act="rename">Rename</button>
          <button type="button" class="btn danger" data-act="delete">Delete</button>
        </div>
      </article>`);
    body.onclick = async (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'zoom') {
        closeSheets();
        zoomTo(t);
      }
      if (act === 'share') shareFile(toGPX({ tracks: [t] }), exportName(t.name, 'gpx'), 'application/gpx+xml');
      if (act === 'rename') {
        const name = prompt('Track name', t.name);
        if (name && name.trim()) {
          t.name = name.trim();
          await put('tracks', t);
          refresh();
          showCard(t.id);
        }
      }
      if (act === 'delete' && confirm(`Delete track "${t.name}"?`)) {
        await remove('tracks', t.id);
        tracks.delete(t.id);
        refresh();
        closeSheets();
        toast('Track deleted');
      }
    };
  }

  return {
    load,
    start,
    stop,
    resume,
    status,
    trackAt,
    showCard,
    zoomTo,
    get recording() { return !!rec; },
    list: () => [...tracks.values()],
    get visible() { return visible; },
    setVisible(on) {
      visible = on;
      refresh();
    },
    async importMany(list) {
      for (const t of list) {
        await put('tracks', t);
        tracks.set(t.id, t);
      }
      refresh();
    },
    TRACK_COLOR,
  };
}
