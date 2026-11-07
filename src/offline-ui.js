import { listAreas, deleteArea, newArea, downloadArea, estimate, fmtBytes, MAX_TILES, OFFLINE_LAYERS } from './offline.js';
import { put } from './storage.js';
import { closeSheets, openPanel, toast, esc } from './ui.js';
import { load, save } from './prefs.js';
import { fmtDate } from './geo.js';

const $ = (s) => document.querySelector(s);

export function initOffline({ map, app, panel, isBusy }) {
  const prefs = load('offline', { outlines: true, maxZoom: 15, layers: ['topo', 'photo'] });
  let areas = [];
  let running = null; // { area, ctrl }
  let wakeLock = null;

  // ---------- outlines of downloaded areas ----------
  const fc = () => ({
    type: 'FeatureCollection',
    features: prefs.outlines ? areas.map((a) => ({
      type: 'Feature',
      properties: { name: a.name },
      geometry: { type: 'Polygon', coordinates: [[
        [a.bounds.west, a.bounds.south], [a.bounds.east, a.bounds.south], [a.bounds.east, a.bounds.north],
        [a.bounds.west, a.bounds.north], [a.bounds.west, a.bounds.south]]] },
    })) : [],
  });
  map.on('load', () => {
    map.addSource('offline-areas', { type: 'geojson', data: fc() });
    map.addLayer({
      id: 'offline-areas', type: 'line', source: 'offline-areas',
      paint: { 'line-color': '#ffffff', 'line-width': 2, 'line-dasharray': [3, 2], 'line-opacity': 0.9 },
    });
  });
  const drawOutlines = () => map.getSource('offline-areas')?.setData(fc());

  const chk = $('#chk-area-outlines');
  chk.checked = prefs.outlines;
  chk.addEventListener('change', () => {
    prefs.outlines = chk.checked;
    save('offline', prefs);
    drawOutlines();
  });

  // ---------- list in the Layers panel ----------
  async function refresh() {
    areas = (await listAreas()).sort((a, b) => b.created - a.created);
    drawOutlines();
    const list = $('#area-list');
    list.innerHTML = areas.length ? areas.map((a) => {
      const isRunning = running?.area.id === a.id;
      const status = isRunning
        ? `Downloading… ${Math.floor(((a.done + a.failed) / a.tiles) * 100)}%`
        : a.complete
          ? `${fmtBytes(a.bytes)} · ${a.layers.map((l) => OFFLINE_LAYERS[l].label).join(' + ')} · ${fmtDate(a.created)}`
          : `<span class="warn">Not finished (${Math.floor(((a.done + a.failed) / a.tiles) * 100)}%)</span>`;
      const failed = a.complete && a.failed ? ` <span class="warn">· ${a.failed} tiles missing</span>` : '';
      return `<div class="area" data-id="${a.id}"><b>${esc(a.name)}</b><small>${status}${failed}</small>
        <div class="actions">
          <button type="button" class="btn small" data-act="show">Show</button>
          ${!a.complete && !isRunning ? '<button type="button" class="btn small primary" data-act="resume">Resume</button>' : ''}
          ${a.complete && a.failed && !isRunning ? '<button type="button" class="btn small" data-act="resume">Retry missing</button>' : ''}
          <button type="button" class="btn small danger" data-act="delete">Delete</button>
        </div></div>`;
    }).join('') : '<p class="fine">No offline areas yet.</p>';
    try {
      const est = await navigator.storage.estimate();
      $('#storage-usage').textContent = `This app is using ${fmtBytes(est.usage || 0)} of storage on this device.`;
    } catch {
      $('#storage-usage').textContent = '';
    }
  }
  $('#area-list').addEventListener('click', async (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    const id = e.target.closest('[data-id]')?.dataset.id;
    const a = areas.find((x) => x.id === id);
    if (!a) return;
    if (act === 'show') {
      closeSheets();
      map.fitBounds([[a.bounds.west, a.bounds.south], [a.bounds.east, a.bounds.north]], { padding: 30 });
    }
    if (act === 'resume') start(a);
    if (act === 'delete') {
      if (running?.area.id === a.id) running.ctrl.abort();
      if (!confirm(`Delete offline maps for "${a.name}"? (${fmtBytes(a.bytes)})`)) return;
      await deleteArea(a.id);
      toast('Offline area deleted');
      refresh();
    }
  });
  refresh();

  // ---------- choosing an area ----------
  let selecting = false;
  const frame = $('#select-frame');
  const bar = $('#offline-bar');
  const goBtn = $('#offline-go');

  function frameBounds() {
    const r = frame.getBoundingClientRect();
    const m = map.getContainer().getBoundingClientRect();
    const nw = map.unproject([r.left - m.left, r.top - m.top]);
    const se = map.unproject([r.right - m.left, r.bottom - m.top]);
    return { west: nw.lng, north: nw.lat, east: se.lng, south: se.lat };
  }
  function chosenLayers() {
    return [...bar.querySelectorAll('[data-layer]')].filter((c) => c.checked).map((c) => c.dataset.layer);
  }
  function updateEstimate() {
    if (!selecting) return;
    const layers = chosenLayers();
    const est = estimate(frameBounds(), prefs.maxZoom, layers);
    let msg;
    let ok = layers.length > 0 && est.tiles > 0;
    if (!layers.length) msg = 'Pick at least one map type';
    else if (est.tiles > MAX_TILES) {
      ok = false;
      msg = `Too big: ${est.tiles.toLocaleString()} tiles. Zoom in, or pick less detail.`;
    } else msg = `${est.tiles.toLocaleString()} tiles · about ${fmtBytes(est.bytes)}`;
    $('#offline-est').textContent = msg;
    $('#offline-est').classList.toggle('warn', !ok && layers.length > 0);
    goBtn.disabled = !ok;
  }
  map.on('move', updateEstimate);

  bar.querySelectorAll('[data-layer]').forEach((c) => {
    c.checked = prefs.layers.includes(c.dataset.layer);
    c.addEventListener('change', () => {
      prefs.layers = chosenLayers();
      save('offline', prefs);
      updateEstimate();
    });
  });
  const seg = $('#detail-seg');
  const paintSeg = () => seg.querySelectorAll('[data-z]').forEach((b) => b.setAttribute('aria-checked', String(Number(b.dataset.z) === prefs.maxZoom)));
  paintSeg();
  seg.addEventListener('click', (e) => {
    const z = e.target.closest('[data-z]')?.dataset.z;
    if (!z) return;
    prefs.maxZoom = Number(z);
    save('offline', prefs);
    paintSeg();
    updateEstimate();
  });

  function startSelecting() {
    if (running) return toast('Wait for the current download to finish, or stop it first.');
    if (isBusy()) return toast('Finish measuring or placing first.');
    closeSheets();
    selecting = true;
    document.body.classList.add('selecting');
    frame.classList.remove('hidden');
    bar.classList.remove('hidden');
    $('#area-name').value = `Area ${areas.length + 1}`;
    if (map.getZoom() < 11) map.easeTo({ zoom: 12 });
    updateEstimate();
  }
  function stopSelecting() {
    selecting = false;
    document.body.classList.remove('selecting');
    frame.classList.add('hidden');
    bar.classList.add('hidden');
  }
  $('#btn-offline-new').addEventListener('click', startSelecting);
  $('#offline-cancel').addEventListener('click', () => {
    stopSelecting();
    openPanel(panel);
  });
  goBtn.addEventListener('click', () => {
    const area = newArea({
      name: $('#area-name').value.trim() || `Area ${areas.length + 1}`,
      bounds: frameBounds(),
      maxZoom: prefs.maxZoom,
      layers: chosenLayers(),
    });
    stopSelecting();
    start(area);
  });

  // ---------- downloading ----------
  const chip = $('#dl-chip');
  function paintChip(a) {
    const pct = Math.floor(((a.done + a.failed) / a.tiles) * 100);
    chip.querySelector('.dl-text').textContent = `⬇ ${a.name}: ${pct}% · ${fmtBytes(a.bytes)}  (tap to stop)`;
    chip.querySelector('.dl-bar span').style.width = `${pct}%`;
  }
  chip.addEventListener('click', () => {
    if (running && confirm(`Stop downloading "${running.area.name}"? You can resume it later from Layers → Offline maps.`)) running.ctrl.abort();
  });

  async function start(area) {
    if (running) return toast('Another download is running.');
    if (!navigator.onLine) return toast('No internet connection. Connect to Wi-Fi to download.');
    const ctrl = new AbortController();
    running = { area, ctrl };
    chip.classList.remove('hidden');
    paintChip(area);
    try {
      if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen');
    } catch {
      /* screen may sleep */
    }
    toast('Downloading. Keep the app open with the screen on until it finishes.', { ms: 5000 });
    await put('areas', area);
    refresh();
    let lastPaint = 0;
    try {
      await downloadArea(area, {
        signal: ctrl.signal,
        onProgress(a) {
          const now = performance.now();
          if (now - lastPaint > 250) {
            lastPaint = now;
            paintChip(a);
          }
        },
      });
    } catch (err) {
      toast(`Download problem: ${esc(err.message)}`, { ms: 5000 });
    }
    running = null;
    wakeLock?.release().catch(() => {});
    wakeLock = null;
    chip.classList.add('hidden');
    if (area.complete) {
      toast(area.failed
        ? `“${esc(area.name)}” saved, but ${area.failed} tiles failed. Open Layers → Offline maps to retry.`
        : `“${esc(area.name)}” is ready for offline use (${fmtBytes(area.bytes)}).`, { ms: 6000 });
    } else {
      toast(`Download stopped. Resume it from Layers → Offline maps.`, { ms: 5000 });
    }
    refresh();
  }

  // Phone screen locked or app closed mid-download: offer to resume next time.
  listAreas().then((all) => {
    const unfinished = all.find((a) => !a.complete);
    if (unfinished) {
      toast(`Offline map “${esc(unfinished.name)}” didn't finish.`, {
        ms: 0,
        actions: [
          { label: 'Resume', run: () => start(unfinished) },
          { label: 'Later', secondary: true, run: () => {} },
        ],
      });
    }
  });

  // Satellite needs signal: suggest switching when offline (now, or when signal drops).
  const offlineHint = () => {
    if (app.prefs.basemap === 'satellite') {
      toast('No signal. Satellite needs internet; Topo and USGS Photo work in downloaded areas.', {
        ms: 0,
        actions: [
          { label: 'Use Topo', run: () => app.setBasemap('topo') },
          { label: 'OK', secondary: true, run: () => {} },
        ],
      });
    }
  };
  window.addEventListener('offline', offlineHint);
  if (!navigator.onLine) setTimeout(offlineHint, 1000);

  return { refresh, get selecting() { return selecting; } };
}
