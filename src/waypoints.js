import maplibregl from './maplibre.js';
import { getAll, put, remove, newId } from './storage.js';
import { openSheet, closeSheets, esc, toast } from './ui.js';
import { distance, bearing, compassDir, fmtDistance, fmtDate } from './geo.js';
import { toGPX, shareFile, exportName } from './io.js';

export const TYPES = {
  stand: { label: 'Stand', icon: '🪜', color: '#ff7a1a' },
  blind: { label: 'Blind', icon: '⛺', color: '#8d6e3f' },
  camera: { label: 'Trail cam', icon: '📷', color: '#5f6b73' },
  scrape: { label: 'Scrape', icon: '🐾', color: '#b5432f' },
  rub: { label: 'Rub', icon: '🌳', color: '#2e7d32' },
  parking: { label: 'Parking', icon: '🅿️', color: '#1e63d6' },
  sighting: { label: 'Deer sighting', icon: '🦌', color: '#c8a15a' },
  harvest: { label: 'Harvest', icon: '🎯', color: '#d81b60' },
  other: { label: 'Other', icon: '📍', color: '#7b1fa2' },
};

export function createWaypoints(map, { getMyPosition }) {
  const items = new Map(); // id -> { wp, marker }
  let visible = true;

  function markerEl(wp) {
    const t = TYPES[wp.type] || TYPES.other;
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'wp';
    el.style.setProperty('--c', t.color);
    el.innerHTML = `<span class="wp-icon">${t.icon}</span><span class="wp-name">${esc(wp.name)}</span>`;
    el.setAttribute('aria-label', `${t.label}: ${wp.name}`);
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      showCard(wp.id);
    });
    return el;
  }

  function render(wp) {
    items.get(wp.id)?.marker.remove();
    const marker = new maplibregl.Marker({ element: markerEl(wp), anchor: 'bottom' }).setLngLat([wp.lng, wp.lat]);
    if (visible) marker.addTo(map);
    items.set(wp.id, { wp, marker });
  }

  async function load() {
    const all = await getAll('waypoints');
    all.forEach(render);
  }

  async function save(wp) {
    wp.updated = Date.now();
    await put('waypoints', wp);
    render(wp);
  }

  async function del(id) {
    await remove('waypoints', id);
    items.get(id)?.marker.remove();
    items.delete(id);
  }

  // Short names under icons only when zoomed in enough to read them.
  const updateLabels = () => map.getContainer().classList.toggle('wp-labels', map.getZoom() >= 13);
  map.on('zoom', updateLabels);
  updateLabels();

  function fromMe(wp) {
    const p = getMyPosition();
    if (!p) return '';
    const me = [p.coords.longitude, p.coords.latitude];
    const there = [wp.lng, wp.lat];
    return `${fmtDistance(distance(me, there))} ${compassDir(bearing(me, there))} of you`;
  }

  function showCard(id) {
    const { wp } = items.get(id) || {};
    if (!wp) return;
    const t = TYPES[wp.type] || TYPES.other;
    const away = fromMe(wp);
    const body = openSheet(`
      <article class="card">
        <h3><span class="wp-badge" style="--c:${t.color}">${t.icon}</span>${esc(wp.name)}</h3>
        <dl>
          <dt>Type</dt><dd>${t.label}</dd>
          ${away ? `<dt>Distance</dt><dd>${away}</dd>` : ''}
          <dt>Location</dt><dd>${wp.lat.toFixed(5)}, ${wp.lng.toFixed(5)}</dd>
          <dt>Added</dt><dd>${fmtDate(wp.created)}</dd>
        </dl>
        ${wp.notes ? `<p class="notes">${esc(wp.notes)}</p>` : ''}
        <div class="actions">
          <button type="button" class="btn" data-act="edit">Edit</button>
          <button type="button" class="btn" data-act="share">Share</button>
          <button type="button" class="btn" data-act="copy">Copy coords</button>
          <button type="button" class="btn danger" data-act="delete">Delete</button>
        </div>
      </article>`);
    body.onclick = async (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'edit') openEditor(wp);
      if (act === 'share') shareFile(toGPX({ waypoints: [wp] }), exportName(wp.name, 'gpx'), 'application/gpx+xml');
      if (act === 'copy') {
        const text = `${wp.lat.toFixed(6)}, ${wp.lng.toFixed(6)}`;
        try {
          await navigator.clipboard.writeText(text);
          toast('Coordinates copied');
        } catch {
          toast(text);
        }
      }
      if (act === 'delete' && confirm(`Delete "${wp.name}"?`)) {
        await del(wp.id);
        closeSheets();
        toast('Waypoint deleted');
      }
    };
  }

  // Add or edit form. `wp` may be a new, unsaved waypoint.
  function openEditor(wp) {
    const isNew = !items.has(wp.id);
    let type = wp.type || 'stand';
    const form = document.createElement('form');
    form.className = 'editor';
    form.innerHTML = `
      <h3>${isNew ? 'New waypoint' : 'Edit waypoint'}</h3>
      <div class="type-grid">
        ${Object.entries(TYPES)
          .map(([k, t]) => `<button type="button" class="type-btn" data-type="${k}" style="--c:${t.color}" aria-pressed="${k === type}">
              <span class="wp-badge">${t.icon}</span><span>${t.label}</span></button>`)
          .join('')}
      </div>
      <label class="field">Name<input name="name" maxlength="60" autocomplete="off" enterkeyhint="done" /></label>
      <label class="field">Notes<textarea name="notes" rows="3" maxlength="2000" placeholder="Wind, best times, what you saw…"></textarea></label>
      <div class="actions">
        <button type="submit" class="btn primary">Save</button>
        <button type="button" class="btn" data-act="cancel">Cancel</button>
      </div>`;
    const nameIn = form.querySelector('[name="name"]');
    const notesIn = form.querySelector('[name="notes"]');
    nameIn.value = wp.name || '';
    notesIn.value = wp.notes || '';
    const grid = form.querySelector('.type-grid');
    grid.addEventListener('click', (e) => {
      const b = e.target.closest('[data-type]');
      if (!b) return;
      const oldDefault = TYPES[type].label;
      type = b.dataset.type;
      grid.querySelectorAll('[data-type]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      // keep auto-generated names in step with the chosen type
      if (!nameIn.value || nameIn.value.startsWith(oldDefault)) nameIn.value = defaultName(type);
    });
    if (!nameIn.value) nameIn.value = defaultName(type);
    form.querySelector('[data-act="cancel"]').onclick = () => (isNew ? closeSheets() : showCard(wp.id));
    form.onsubmit = async (e) => {
      e.preventDefault();
      const saved = {
        ...wp,
        type,
        name: nameIn.value.trim() || defaultName(type),
        notes: notesIn.value.trim(),
        created: wp.created || Date.now(),
      };
      await save(saved);
      closeSheets();
      toast(`Saved “${esc(saved.name)}”`);
    };
    openSheet(form);
  }

  function defaultName(type) {
    const n = [...items.values()].filter((i) => i.wp.type === type).length + 1;
    return `${TYPES[type].label} ${n}`;
  }

  return {
    load,
    showCard,
    add(lng, lat) {
      openEditor({ id: newId(), lng, lat });
    },
    list: () => [...items.values()].map((i) => i.wp),
    get visible() { return visible; },
    setVisible(on) {
      visible = on;
      for (const { marker } of items.values()) on ? marker.addTo(map) : marker.remove();
    },
    async importMany(wps) {
      for (const wp of wps) await save(wp);
    },
  };
}
