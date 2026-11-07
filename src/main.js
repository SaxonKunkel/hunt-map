import 'maplibre-gl/dist/maplibre-gl.css';
import './styles.css';
import { createMap, BASEMAPS, OVERLAYS } from './map.js';
import { createLocator } from './gps.js';
import { createWaypoints, TYPES } from './waypoints.js';
import { createTracks } from './tracks.js';
import { load, save } from './prefs.js';
import { openSheet, openPanel, closeSheets, isOpen, toast, esc } from './ui.js';
import { distance, fmtDistance, fmtDuration, fmtDate } from './geo.js';
import { createMeasure } from './measure.js';
import { toGPX, toGeoJSON, shareFile, exportName, parseFile } from './io.js';
import { initOffline } from './offline-ui.js';

const $ = (sel) => document.querySelector(sel);
const app = createMap('map');
const { map } = app;

// ---------------- GPS ----------------
const chip = $('#gps-chip');
const locateBtn = $('#btn-locate');
const locator = createLocator(map, {
  onState(mode) {
    locateBtn.dataset.mode = mode;
    if (mode === 'off') chip.classList.add('hidden');
  },
  onFix(pos) {
    const { latitude, longitude, accuracy } = pos.coords;
    chip.classList.remove('hidden', 'warn');
    chip.textContent = `${latitude.toFixed(5)}, ${longitude.toFixed(5)}  ·  ±${Math.round(accuracy * 3.281)} ft`;
  },
  onError(msg) {
    chip.classList.remove('hidden');
    chip.classList.add('warn');
    chip.textContent = msg;
  },
});
locateBtn.addEventListener('click', () => locator.toggle());

chip.addEventListener('click', async () => {
  const p = locator.position;
  if (!p) return;
  const text = `${p.coords.latitude.toFixed(6)}, ${p.coords.longitude.toFixed(6)}`;
  try {
    await navigator.clipboard.writeText(text);
    toast('Coordinates copied');
  } catch {
    toast(text);
  }
});

// ---------------- North / compass button ----------------
const needle = $('#north-needle');
const turnNeedle = () => (needle.style.transform = `rotate(${-map.getBearing()}deg)`);
map.on('rotate', turnNeedle);
turnNeedle();
$('#btn-north').addEventListener('click', () => locator.northUp());

// ---------------- Waypoints ----------------
const waypoints = createWaypoints(map, { getMyPosition: () => locator.position });
waypoints.load();

let placing = false;
function startPlacing() {
  closeSheets();
  placing = true;
  document.body.classList.add('placing');
  $('#crosshair').classList.remove('hidden');
  $('#place-bar').classList.remove('hidden');
}
function stopPlacing() {
  placing = false;
  document.body.classList.remove('placing');
  $('#crosshair').classList.add('hidden');
  $('#place-bar').classList.add('hidden');
}
$('#btn-add').addEventListener('click', () => (placing ? stopPlacing() : startPlacing()));
$('#place-cancel').addEventListener('click', stopPlacing);
$('#place-here').addEventListener('click', () => {
  const c = map.getCenter();
  stopPlacing();
  waypoints.add(c.lng, c.lat);
});
$('#place-me').addEventListener('click', () => {
  const p = locator.position;
  if (!p) {
    toast('No GPS fix yet. Tap the location button first.');
    return;
  }
  stopPlacing();
  waypoints.add(p.coords.longitude, p.coords.latitude);
});

// ---------------- Tracks ----------------
const recChip = $('#rec-chip');
const recBtn = $('#btn-record');
let recTimer = null;
const tracks = createTracks(map, {
  onRecordingChange(s) {
    recBtn.classList.toggle('recording', !!s);
    recChip.classList.toggle('hidden', !s);
    clearInterval(recTimer);
    if (s) {
      const paint = () => {
        const st = tracks.status();
        if (st) recChip.innerHTML = `<span class="dot"></span>${st.active ? 'REC' : 'PAUSED'} · ${fmtDistance(st.distance)} · ${fmtDuration(st.elapsed)}`;
      };
      paint();
      recTimer = setInterval(paint, 1000);
    }
  },
});
tracks.load();

async function stopRecording() {
  const t = await tracks.stop();
  if (t) {
    toast(`Saved “${esc(t.name)}”: ${fmtDistance(t.distance)}`);
    tracks.showCard(t.id);
  }
}
recBtn.addEventListener('click', async () => {
  if (tracks.recording) {
    const st = tracks.status();
    if (st && !st.active) return tracks.resume();
    if (confirm('Stop recording and save this track?')) stopRecording();
    return;
  }
  if (locator.mode === 'off') locator.toggle(); // show the blue dot too
  await tracks.start();
  toast('Recording. Keep the app open on screen; iPhones pause GPS when the screen locks.', { ms: 6000 });
});
recChip.addEventListener('click', () => recBtn.click());

// ---------------- Saved list ----------------
const listPrefs = load('list', { showWaypoints: true, showTracks: true });
waypoints.setVisible(listPrefs.showWaypoints);
tracks.setVisible(listPrefs.showTracks);

function showSavedList() {
  const p = locator.position;
  const me = p ? [p.coords.longitude, p.coords.latitude] : null;
  const wps = waypoints.list().map((w) => ({ ...w, d: me ? distance(me, [w.lng, w.lat]) : null }));
  wps.sort((a, b) => (me ? a.d - b.d : (b.created || 0) - (a.created || 0)));
  const trs = tracks.list().sort((a, b) => (b.started || 0) - (a.started || 0));
  const body = openSheet(`
    <h2>Share with family</h2>
    <div class="io-row">
      <button type="button" class="btn primary" data-io="gpx">Share all</button>
      <button type="button" class="btn" data-io="import">Import</button>
      <button type="button" class="btn" data-io="geojson">GeoJSON</button>
    </div>
    <p class="fine">Share all sends a GPX file by text, email or AirDrop. On the other phone, tap the file, Save to Files, then tap Import here.</p>
    <h2>Waypoints (${wps.length})${me ? ' · nearest first' : ''}</h2>
    <label class="row"><input type="checkbox" data-toggle="wp" ${listPrefs.showWaypoints ? 'checked' : ''}/> <span>Show on map</span></label>
    <ul class="list">
      ${wps.map((w) => {
        const t = TYPES[w.type] || TYPES.other;
        return `<li><button type="button" data-wp="${w.id}"><span class="wp-badge" style="--c:${t.color}">${t.icon}</span>
          <span class="li-main">${esc(w.name)}<small>${t.label}${w.d != null ? ` · ${fmtDistance(w.d)} away` : ''}</small></span></button></li>`;
      }).join('') || '<li class="empty">None yet. Tap the pin button to add one.</li>'}
    </ul>
    <h2>Tracks (${trs.length})</h2>
    <label class="row"><input type="checkbox" data-toggle="tr" ${listPrefs.showTracks ? 'checked' : ''}/> <span>Show on map</span></label>
    <ul class="list">
      ${trs.map((t) => `<li><button type="button" data-tr="${t.id}"><span class="swatch" style="--c:${tracks.TRACK_COLOR}"></span>
          <span class="li-main">${esc(t.name)}<small>${fmtDistance(t.distance)}${t.started ? ` · ${fmtDate(t.started)}` : ''}</small></span></button></li>`).join('') ||
        '<li class="empty">None yet. Tap Track to record a walk.</li>'}
    </ul>`);
  body.onclick = (e) => {
    const io = e.target.closest('[data-io]')?.dataset.io;
    if (io === 'import') return $('#import-file').click();
    if (io) {
      const data = { waypoints: waypoints.list(), tracks: tracks.list() };
      if (!data.waypoints.length && !data.tracks.length) return toast('Nothing to share yet.');
      // shareFile must run right away (no waiting) so iPhone allows the share sheet
      if (io === 'gpx') shareFile(toGPX(data), exportName('hunt-map', 'gpx'), 'application/gpx+xml');
      else shareFile(toGeoJSON(data), exportName('hunt-map', 'geojson'), 'application/geo+json');
      return;
    }
    const wp = e.target.closest('[data-wp]')?.dataset.wp;
    const tr = e.target.closest('[data-tr]')?.dataset.tr;
    if (wp) {
      const w = waypoints.list().find((x) => x.id === wp);
      if (!waypoints.visible) setShow('wp', true);
      map.flyTo({ center: [w.lng, w.lat], zoom: Math.max(map.getZoom(), 15) });
      waypoints.showCard(wp);
    }
    if (tr) {
      if (!tracks.visible) setShow('tr', true);
      tracks.zoomTo(tracks.list().find((x) => x.id === tr));
      tracks.showCard(tr);
    }
  };
  body.onchange = (e) => {
    const k = e.target.dataset.toggle;
    if (k) setShow(k, e.target.checked);
  };
}
function setShow(kind, on) {
  if (kind === 'wp') {
    listPrefs.showWaypoints = on;
    waypoints.setVisible(on);
  } else {
    listPrefs.showTracks = on;
    tracks.setVisible(on);
  }
  save('list', listPrefs);
}
$('#btn-saved').addEventListener('click', () => (isOpen($('#sheet')) ? closeSheets() : showSavedList()));

// ---------------- Import GPX / GeoJSON ----------------
$('#import-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  let data;
  try {
    data = parseFile(await file.text(), file.name);
  } catch (err) {
    return toast(`Couldn't read that file: ${esc(err.message)}`, { ms: 5000 });
  }
  // Skip things we already have (same id, or same name in the same place).
  const haveWp = waypoints.list();
  const newWps = data.waypoints.filter((w) => !haveWp.some((h) => h.id === w.id ||
    (h.name === w.name && distance([h.lng, h.lat], [w.lng, w.lat]) < 2)));
  const haveTr = tracks.list();
  const newTrs = data.tracks.filter((t) => !haveTr.some((h) => h.id === t.id ||
    (h.name === t.name && h.points.length === t.points.length && distance(h.points[0], t.points[0]) < 2)));
  await waypoints.importMany(newWps);
  await tracks.importMany(newTrs);
  const skipped = data.waypoints.length + data.tracks.length - newWps.length - newTrs.length;
  toast(`Imported ${newWps.length} waypoint${newWps.length === 1 ? '' : 's'} and ${newTrs.length} track${newTrs.length === 1 ? '' : 's'}` +
    (skipped ? ` (${skipped} already here)` : ''), { ms: 5000 });
  if (!waypoints.visible && newWps.length) setShow('wp', true);
  if (!tracks.visible && newTrs.length) setShow('tr', true);
  // show what came in
  const pts = [...newWps.map((w) => [w.lng, w.lat]), ...newTrs.flatMap((t) => t.points.map((p) => [p[0], p[1]]))];
  if (pts.length) {
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    map.fitBounds([[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]], { padding: 80, maxZoom: 16 });
  }
  closeSheets();
});

// ---------------- Measure ----------------
const measure = createMeasure(map, {
  onChange({ main, sub }) {
    $('#measure-main').textContent = main;
    $('#measure-sub').textContent = sub;
  },
});
function startMeasure() {
  closeSheets();
  if (placing) stopPlacing();
  measure.start();
  document.body.classList.add('measuring');
  $('#measure-bar').classList.remove('hidden');
}
function stopMeasure() {
  measure.stop();
  document.body.classList.remove('measuring');
  $('#measure-bar').classList.add('hidden');
}
$('#btn-measure').addEventListener('click', startMeasure);
$('#measure-done').addEventListener('click', stopMeasure);
$('#measure-undo').addEventListener('click', () => measure.undo());
$('#measure-clear').addEventListener('click', () => measure.clear());
$('#measure-seg').addEventListener('click', (e) => {
  const m = e.target.closest('[data-mode]')?.dataset.mode;
  if (!m) return;
  $('#measure-seg').querySelectorAll('[data-mode]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.mode === m)));
  measure.setMode(m);
});

// ---------------- Tap the map -> track or public land info ----------------
const fmtAcres = (a) => (a == null ? '' : `${Math.round(a).toLocaleString()} acres`);
const COLORS = Object.fromEntries(OVERLAYS.map((o) => [o.id, o.swatch]));
const FED_COLORS = { USFS: '#c6e85c', USACE: '#56a8ff', FWS: '#d58cff', NPS: '#e0a36b' };

map.on('click', (e) => {
  if (placing || offline.selecting) return;
  if (measure.active) return measure.add(e.lngLat);
  const t = tracks.trackAt(e.point);
  if (t) return tracks.showCard(t.id);
  const hits = app.featuresAt(e.point);
  if (!hits.length) return closeSheets();
  const { lng, lat } = e.lngLat;
  openSheet(
    hits
      .map((p) => {
        const color = p._source === 'federal' ? FED_COLORS[p.manager] || '#ffe14d' : COLORS[p._source];
        const rows = [
          ['Type', p.kind],
          ['Size', fmtAcres(p.acres)],
          ['Owner', p.owner],
          ['Access', p.access],
          ['County', p.county],
        ].filter(([, v]) => v);
        const links = [
          ['Regulations', p.regs],
          ['Area page', p.link],
          ['Area map', p.map],
        ].filter(([, v]) => v);
        return `<article class="card">
          <h3><span class="swatch" style="--c:${color}"></span>${esc(p.name)}</h3>
          <dl>${rows.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
          ${links.length ? `<div class="links">${links.map(([k, v]) => `<a href="${esc(v)}" target="_blank" rel="noopener">${k} ↗</a>`).join('')}</div>` : ''}
        </article>`;
      })
      .join('') + `<p class="fine">Tapped at ${lat.toFixed(5)}, ${lng.toFixed(5)}. Links need signal.</p>`,
  );
});

// ---------------- Layers panel ----------------
const panel = $('#layers-panel');
const seg = $('#basemap-seg');
seg.innerHTML = Object.entries(BASEMAPS)
  .map(([id, b]) => `<button type="button" role="radio" data-id="${id}">${b.label}</button>`)
  .join('');
function renderSeg() {
  seg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.id === app.prefs.basemap)));
  $('#row-labels').classList.toggle('disabled', app.prefs.basemap === 'topo');
}
seg.addEventListener('click', (e) => {
  const id = e.target.closest('button')?.dataset.id;
  if (!id) return;
  app.setBasemap(id);
  renderSeg();
});
renderSeg();

const chkLabels = $('#chk-labels');
chkLabels.checked = app.prefs.labels;
chkLabels.addEventListener('change', () => app.setLabels(chkLabels.checked));

$('#overlay-list').innerHTML =
  OVERLAYS.map(
    (o) => `<label class="row"><input type="checkbox" data-id="${o.id}" ${app.prefs.overlays[o.id] !== false ? 'checked' : ''}/>
    <span class="swatch" style="--c:${o.swatch}"></span><span>${o.label}</span></label>`,
  ).join('') +
  `<p class="fine legend">Federal colors: <b style="color:#c6e85c">Forest Service</b> · <b style="color:#56a8ff">Corps of Engineers</b> · <b style="color:#d58cff">Fish &amp; Wildlife</b> · <b style="color:#e0a36b">Park Service</b></p>`;
$('#overlay-list').addEventListener('change', (e) => {
  const id = e.target.dataset.id;
  if (id) app.setOverlay(id, e.target.checked);
});

// ---------------- Offline maps ----------------
const offline = initOffline({
  map,
  app: { prefs: app.prefs, setBasemap: (id) => { app.setBasemap(id); renderSeg(); } },
  panel,
  isBusy: () => placing || measure.active,
});

$('#btn-layers').addEventListener('click', () => {
  if (isOpen(panel)) return closeSheets();
  offline.refresh();
  openPanel(panel);
});

fetch('data/meta.json')
  .then((r) => r.json())
  .then((m) => ($('#data-date').textContent = `Public land data downloaded ${m.fetched}.`))
  .catch(() => {});

// ---------------- Offline support (service worker) ----------------
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register('./sw.js').then((reg) => {
    const promptUpdate = (worker) =>
      toast('A new version is ready.', {
        ms: 0,
        actions: [{
          label: 'Update',
          run: () => {
            if (tracks.recording && !confirm('A track is recording. Update anyway? (Recording will resume after.)')) return;
            worker.postMessage('skipWaiting');
          },
        }],
      });
    if (reg.waiting && navigator.serviceWorker.controller) promptUpdate(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w?.addEventListener('statechange', () => {
        if (w.state === 'installed' && navigator.serviceWorker.controller) promptUpdate(w);
      });
    });
    document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && reg.update());
  }).catch(() => {});
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    reloading = true;
    location.reload();
  });
}

// Ask the phone to keep our saved data (helps on iPhone once installed).
if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});

// ---------------- iPhone "add to home screen" hint ----------------
const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
const hint = load('hint', { shown: false });
if (isIOS && !standalone && !hint.shown) {
  setTimeout(() => {
    toast('Install: tap <b>Share</b> <span aria-hidden="true">⬆︎</span> then <b>Add to Home Screen</b>.', {
      ms: 0,
      actions: [{ label: 'OK', run: () => save('hint', { shown: true }) }],
    });
  }, 1500);
}
