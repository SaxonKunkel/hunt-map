// Distance / direction helpers (feet and miles).
const R = 6371008.8; // earth radius, metres
const rad = (d) => (d * Math.PI) / 180;

export function distance([lng1, lat1], [lng2, lat2]) {
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export function bearing([lng1, lat1], [lng2, lat2]) {
  const y = Math.sin(rad(lng2 - lng1)) * Math.cos(rad(lat2));
  const x = Math.cos(rad(lat1)) * Math.sin(rad(lat2)) - Math.sin(rad(lat1)) * Math.cos(rad(lat2)) * Math.cos(rad(lng2 - lng1));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

export function lineLength(coords) {
  let d = 0;
  for (let i = 1; i < coords.length; i++) d += distance(coords[i - 1], coords[i]);
  return d;
}

// Area of a closed [lng,lat] ring in square metres (spherical approximation, same method as Turf.js).
export function ringArea(coords) {
  let total = 0;
  const n = coords.length;
  if (n < 4) return 0;
  for (let i = 0; i < n - 1; i++) {
    const p1 = coords[i];
    const p2 = coords[i + 1];
    const p3 = coords[(i + 2) % (n - 1)];
    total += (rad(p3[0]) - rad(p1[0])) * Math.sin(rad(p2[1]));
  }
  return Math.abs((total * R * R) / 2);
}

export function fmtArea(m2) {
  const acres = m2 / 4046.8564;
  if (acres < 1) return `${acres.toFixed(2)} acres (${Math.round(m2 * 10.7639).toLocaleString()} sq ft)`;
  return `${acres < 100 ? acres.toFixed(1) : Math.round(acres).toLocaleString()} acres`;
}

const DIRS =['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
export const compassDir = (deg) => DIRS[Math.round(deg / 45) % 8];

export function fmtDistance(m) {
  const ft = m * 3.28084;
  if (ft < 1000) return `${Math.round(ft)} ft`;
  const mi = m / 1609.344;
  return `${mi < 10 ? mi.toFixed(2) : mi.toFixed(1)} mi`;
}

export function fmtDuration(ms) {
  const s = Math.round(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}

export const fmtDate = (t) =>
  new Date(t).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
