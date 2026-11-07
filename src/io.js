// Export / import waypoints and tracks as GPX or GeoJSON so the family can share them.
// GPX opens in most GPS and mapping apps (Garmin, Google Earth, onX, Gaia, etc.).
import { newId } from './storage.js';
import { lineLength } from './geo.js';

const NS = 'https://mo-hunt-map/gpx/1';
const xmlEsc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);
const iso = (t) => (t ? new Date(t).toISOString() : null);

// ---------------- export ----------------
export function toGPX({ waypoints = [], tracks = [] }) {
  const wpts = waypoints.map((w) => `  <wpt lat="${w.lat.toFixed(7)}" lon="${w.lng.toFixed(7)}">
    ${w.created ? `<time>${iso(w.created)}</time>` : ''}
    <name>${xmlEsc(w.name)}</name>
    ${w.notes ? `<desc>${xmlEsc(w.notes)}</desc>` : ''}
    <type>${xmlEsc(w.type)}</type>
    <extensions><hm:id>${xmlEsc(w.id)}</hm:id></extensions>
  </wpt>`);
  const trks = tracks.map((t) => `  <trk>
    <name>${xmlEsc(t.name)}</name>
    ${t.notes ? `<desc>${xmlEsc(t.notes)}</desc>` : ''}
    <extensions><hm:id>${xmlEsc(t.id)}</hm:id></extensions>
    <trkseg>
${t.points.map((p) => `      <trkpt lat="${p[1].toFixed(7)}" lon="${p[0].toFixed(7)}">${p[3] != null ? `<ele>${p[3]}</ele>` : ''}${p[2] ? `<time>${iso(p[2])}</time>` : ''}</trkpt>`).join('\n')}
    </trkseg>
  </trk>`);
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="MO Hunt Map" xmlns="http://www.topografix.com/GPX/1/1" xmlns:hm="${NS}">
${[...wpts, ...trks].join('\n')}
</gpx>
`;
}

export function toGeoJSON({ waypoints = [], tracks = [] }) {
  return JSON.stringify({
    type: 'FeatureCollection',
    features: [
      ...waypoints.map((w) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [w.lng, w.lat] },
        properties: { id: w.id, kind: 'waypoint', name: w.name, notes: w.notes || '', type: w.type, created: iso(w.created) },
      })),
      ...tracks.map((t) => ({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: t.points.map((p) => (p[3] != null ? [p[0], p[1], p[3]] : [p[0], p[1]])) },
        properties: { id: t.id, kind: 'track', name: t.name, notes: t.notes || '', times: t.points.map((p) => p[2] || null) },
      })),
    ],
  });
}

// Share via the phone's share sheet (Messages, Mail, AirDrop, Files…), or download as a fallback.
// Must be called straight from a button tap (no awaits before it).
export function shareFile(text, filename, mime) {
  const file = new File([text], filename, { type: mime });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    return navigator.share({ files: [file], title: filename }).then(
      () => 'shared',
      (err) => (err.name === 'AbortError' ? 'cancelled' : download(file)),
    );
  }
  return Promise.resolve(download(file));
}

function download(file) {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return 'downloaded';
}

export function exportName(label, ext) {
  const safe = label.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 40) || 'hunt-map';
  return `${safe}-${new Date().toISOString().slice(0, 10)}.${ext}`;
}

// ---------------- import ----------------
const KNOWN_TYPES = ['stand', 'blind', 'camera', 'scrape', 'rub', 'parking', 'sighting', 'harvest', 'other'];
function guessType(type, name) {
  const t = String(type || '').toLowerCase();
  if (KNOWN_TYPES.includes(t)) return t;
  const s = `${t} ${String(name || '').toLowerCase()}`;
  const rules = [
    ['stand', /stand|tree ?stand|ladder/], ['blind', /blind/], ['camera', /cam|camera/], ['scrape', /scrape/],
    ['rub', /\brub/], ['parking', /park|truck|car\b/], ['harvest', /harvest|kill|shot/], ['sighting', /sight|deer|buck|doe/],
  ];
  return rules.find(([, re]) => re.test(s))?.[0] || 'other';
}

export function parseFile(text, filename = '') {
  const trimmed = text.trim();
  if (trimmed.startsWith('{')) return parseGeoJSON(JSON.parse(trimmed));
  if (trimmed.startsWith('<') || /\.gpx$/i.test(filename)) return parseGPX(trimmed);
  throw new Error('Not a GPX or GeoJSON file');
}

function parseGPX(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('This GPX file could not be read');
  const kids = (el, name) => [...el.children].filter((c) => c.localName === name);
  const child = (el, name) => kids(el, name)[0];
  const textOf = (el, name) => child(el, name)?.textContent.trim() || '';
  const hmId = (el) => [...el.getElementsByTagNameNS(NS, 'id')][0]?.textContent.trim();
  const num = (v) => (v === '' || v == null ? null : Number(v));

  const waypoints = [...doc.getElementsByTagNameNS('*', 'wpt')].map((w) => {
    const name = textOf(w, 'name') || 'Imported point';
    const time = textOf(w, 'time');
    return {
      id: hmId(w) || newId(),
      lat: Number(w.getAttribute('lat')),
      lng: Number(w.getAttribute('lon')),
      name,
      notes: textOf(w, 'desc') || textOf(w, 'cmt'),
      type: guessType(textOf(w, 'type') || textOf(w, 'sym'), name),
      created: time ? Date.parse(time) : Date.now(),
    };
  }).filter((w) => isFinite(w.lat) && isFinite(w.lng));

  const lines = [];
  for (const trk of doc.getElementsByTagNameNS('*', 'trk')) {
    const pts = [...trk.getElementsByTagNameNS('*', 'trkpt')];
    lines.push({ el: trk, pts });
  }
  for (const rte of doc.getElementsByTagNameNS('*', 'rte')) {
    lines.push({ el: rte, pts: [...rte.getElementsByTagNameNS('*', 'rtept')] });
  }
  const tracks = lines.map(({ el, pts }) => {
    const points = pts.map((p) => {
      const time = textOf(p, 'time');
      return [Number(p.getAttribute('lon')), Number(p.getAttribute('lat')), time ? Date.parse(time) : null, num(textOf(p, 'ele'))];
    }).filter((p) => isFinite(p[0]) && isFinite(p[1]));
    return makeTrack(hmId(el), textOf(el, 'name'), textOf(el, 'desc'), points);
  }).filter((t) => t.points.length >= 2);

  return { waypoints, tracks };
}

function parseGeoJSON(gj) {
  const feats = gj.type === 'FeatureCollection' ? gj.features : gj.type === 'Feature' ? [gj] : [];
  const waypoints = [];
  const tracks = [];
  for (const f of feats) {
    const p = f.properties || {};
    const g = f.geometry;
    if (!g) continue;
    if (g.type === 'Point') {
      const name = p.name || p.title || 'Imported point';
      waypoints.push({
        id: p.id || newId(),
        lng: g.coordinates[0],
        lat: g.coordinates[1],
        name,
        notes: p.notes || p.description || p.desc || '',
        type: guessType(p.type || p.sym, name),
        created: p.created ? Date.parse(p.created) : Date.now(),
      });
    } else if (g.type === 'LineString' || g.type === 'MultiLineString') {
      const parts = g.type === 'LineString' ? [g.coordinates] : g.coordinates;
      parts.forEach((coords, i) => {
        const times = Array.isArray(p.times) && parts.length === 1 ? p.times : [];
        const points = coords.map((c, j) => [c[0], c[1], times[j] ? Date.parse(times[j]) || times[j] : null, c[2] ?? null]);
        const id = parts.length === 1 ? p.id : null;
        tracks.push(makeTrack(id, p.name ? `${p.name}${parts.length > 1 ? ` (${i + 1})` : ''}` : '', p.notes || p.description || '', points));
      });
    }
  }
  return { waypoints, tracks: tracks.filter((t) => t.points.length >= 2) };
}

function makeTrack(id, name, notes, points) {
  const times = points.map((p) => p[2]).filter(Boolean);
  return {
    id: id || newId(),
    name: name || 'Imported track',
    notes: notes || '',
    points,
    distance: lineLength(points),
    started: times[0] || null,
    ended: times[times.length - 1] || null,
    recording: false,
  };
}
