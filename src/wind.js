// Wind forecast from Open-Meteo (free, no key, personal use; uses NOAA models in the US).
// Shows the wind where the map is centred, an hourly forecast, and "scent cones"
// pointing downwind from stands and blinds. The last forecasts are saved for use without signal.
import { openSheet, closeSheets, esc } from './ui.js';
import { load, save } from './prefs.js';
import { distance, compassDir } from './geo.js';

const API = 'https://api.open-meteo.com/v1/forecast';
const FRESH_MS = 30 * 60 * 1000; // re-fetch after 30 minutes
const NEAR_M = 4000; // a saved forecast within ~2.5 miles counts as "here"
const CONE_M = 365; // scent cone length (~400 yards)
const CONE_TYPES = ['stand', 'blind'];

// ---------- data ----------
function savedForecasts() {
  try {
    return JSON.parse(localStorage.getItem('huntmap:wind') || '[]');
  } catch {
    return [];
  }
}
function storeForecast(f) {
  const list = savedForecasts().filter((x) => distance([x.lng, x.lat], [f.lng, f.lat]) > 500);
  list.unshift(f);
  try {
    localStorage.setItem('huntmap:wind', JSON.stringify(list.slice(0, 15)));
  } catch {
    /* storage full */
  }
}
function nearestSaved(lng, lat) {
  let best = null;
  for (const f of savedForecasts()) {
    const d = distance([lng, lat], [f.lng, f.lat]);
    if (d < NEAR_M && (!best || f.fetched > best.fetched)) best = f;
  }
  return best;
}

async function fetchForecast(lng, lat) {
  const params = new URLSearchParams({
    latitude: lat.toFixed(3),
    longitude: lng.toFixed(3),
    hourly: 'wind_speed_10m,wind_direction_10m,wind_gusts_10m,temperature_2m,precipitation_probability',
    wind_speed_unit: 'mph',
    temperature_unit: 'fahrenheit',
    timezone: 'auto',
    forecast_days: '3',
  });
  const res = await fetch(`${API}?${params}`);
  if (!res.ok) throw new Error(`Weather service error ${res.status}`);
  const j = await res.json();
  const h = j.hourly;
  return {
    lng, lat,
    fetched: Date.now(),
    hours: h.time.map((t, i) => ({
      t: new Date(t).getTime(), // local time of that place (Missouri = phone's time zone)
      spd: Math.round(h.wind_speed_10m[i]),
      dir: Math.round(h.wind_direction_10m[i]), // direction the wind comes FROM
      gust: Math.round(h.wind_gusts_10m[i]),
      temp: Math.round(h.temperature_2m[i]),
      pop: h.precipitation_probability?.[i] ?? null,
    })),
  };
}

// Use a fresh saved forecast if we have one; otherwise fetch; if offline, fall back to the saved one.
export async function getForecast(lng, lat, { force = false } = {}) {
  const saved = nearestSaved(lng, lat);
  if (saved && !force && Date.now() - saved.fetched < FRESH_MS) return saved;
  if (navigator.onLine !== false) {
    try {
      const f = await fetchForecast(lng, lat);
      storeForecast(f);
      return f;
    } catch {
      /* fall back below */
    }
  }
  return saved;
}

const hourStart = (t) => {
  const d = new Date(t);
  d.setMinutes(0, 0, 0);
  return d.getTime();
};
export function hourAt(f, t) {
  if (!f) return null;
  const h = hourStart(t);
  return f.hours.find((x) => x.t === h) || null;
}

// ---------- helpers for display ----------
const arrow = (dir, size = 18) =>
  // arrow points the way the wind is blowing TO (from-direction + 180)
  `<svg class="wind-arrow" width="${size}" height="${size}" viewBox="0 0 24 24" style="transform:rotate(${(dir + 180) % 360}deg)"><path d="M12 2 6 14h4v8h4v-8h4L12 2Z"/></svg>`;
const fmtHour = (t) => new Date(t).toLocaleTimeString([], { hour: 'numeric' });
const fmtDay = (t) => new Date(t).toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
const ago = (t) => {
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h} hr ago` : `${Math.round(h / 24)} days ago`;
};
export const windText = (h) => `${compassDir(h.dir)} ${h.spd} mph${h.gust > h.spd + 2 ? `, gusts ${h.gust}` : ''}`;

// ---------- scent cone geometry ----------
function cone([lng, lat], towardDeg, halfAngle, meters) {
  const pts = [[lng, lat]];
  const mPerDegLat = 111320;
  const mPerDegLng = 111320 * Math.cos((lat * Math.PI) / 180);
  for (let a = -halfAngle; a <= halfAngle; a += halfAngle / 6) {
    const b = ((towardDeg + a) * Math.PI) / 180;
    pts.push([lng + (Math.sin(b) * meters) / mPerDegLng, lat + (Math.cos(b) * meters) / mPerDegLat]);
  }
  pts.push([lng, lat]);
  return pts;
}

// ---------- map + UI ----------
export function createWind(map, { getWaypoints }) {
  const prefs = load('wind', { show: true, cones: true });
  const chip = document.querySelector('#wind-chip');
  let forecast = null; // forecast for the area on screen
  let pickedHour = null; // null = now
  let loading = false;

  map.on('load', () => {
    map.addSource('scent', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({
      id: 'scent-fill', type: 'fill', source: 'scent',
      paint: { 'fill-color': '#ff5a1f', 'fill-opacity': 0.28 },
    }, map.getLayer('tracks-casing') ? 'tracks-casing' : undefined);
    map.addLayer({
      id: 'scent-line', type: 'line', source: 'scent',
      paint: { 'line-color': '#ff5a1f', 'line-width': 1.5, 'line-dasharray': [2, 2] },
    });
    drawCones();
  });

  const current = () => hourAt(forecast, pickedHour ?? Date.now());

  function drawCones() {
    const src = map.getSource('scent');
    if (!src) return;
    const h = prefs.show && prefs.cones ? current() : null;
    const features = [];
    if (h && forecast) {
      // light winds swirl, so the cone is wider
      const half = h.spd < 4 ? 40 : h.spd < 8 ? 28 : 20;
      for (const w of getWaypoints()) {
        if (!CONE_TYPES.includes(w.type)) continue;
        if (distance([w.lng, w.lat], [forecast.lng, forecast.lat]) > 15000) continue;
        features.push({
          type: 'Feature', properties: {},
          geometry: { type: 'Polygon', coordinates: [cone([w.lng, w.lat], (h.dir + 180) % 360, half, CONE_M)] },
        });
      }
    }
    src.setData({ type: 'FeatureCollection', features });
  }

  function paintChip() {
    if (!prefs.show) {
      chip.classList.add('hidden');
      return;
    }
    chip.classList.remove('hidden');
    const h = current();
    if (!h) {
      chip.innerHTML = loading ? '🌬 Getting wind…' : '🌬 Wind: needs signal';
      return;
    }
    const when = pickedHour ? ` · ${new Date(pickedHour).toLocaleString([], { weekday: 'short', hour: 'numeric' })}` : '';
    const stale = Date.now() - forecast.fetched > 3 * 3600 * 1000 ? ' · old' : '';
    chip.innerHTML = `${arrow(h.dir)} <span>${windText(h)}${when}${stale}</span>`;
  }

  let timer;
  async function update({ force = false } = {}) {
    if (!prefs.show) {
      paintChip();
      drawCones();
      return;
    }
    if (pickedHour && pickedHour < hourStart(Date.now())) pickedHour = null; // that hour has passed
    const c = map.getCenter();
    // keep the forecast we have if it still covers the middle of the screen
    if (!force && forecast && distance([c.lng, c.lat], [forecast.lng, forecast.lat]) < NEAR_M && Date.now() - forecast.fetched < FRESH_MS) {
      paintChip();
      drawCones();
      return;
    }
    if (map.getZoom() < 7) {
      chip.innerHTML = '🌬 Zoom in for wind';
      return;
    }
    loading = true;
    paintChip();
    const f = await getForecast(c.lng, c.lat, { force });
    loading = false;
    if (f) forecast = f;
    paintChip();
    drawCones();
  }
  map.on('moveend', () => {
    clearTimeout(timer);
    timer = setTimeout(update, 800);
  });
  // Don't wait for every map tile to load (slow on weak signal): get the wind straight away.
  setTimeout(update, 0);
  setInterval(() => update(), 10 * 60 * 1000);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && update());
  window.addEventListener('online', () => update({ force: true }));

  // ---------- hourly forecast sheet ----------
  async function showForecast(lng, lat, title) {
    const body = openSheet('<p class="fine">Getting the forecast…</p>');
    const f = await getForecast(lng, lat);
    if (!f) {
      body.innerHTML = '<p>No forecast saved for this spot yet. Check the wind here once while you have signal and it will be saved for later.</p>';
      return;
    }
    // the sheet may have been closed or replaced while loading
    if (!document.body.contains(body) || body.closest('.sheet').classList.contains('hidden')) return;
    forecast = distance([f.lng, f.lat], [map.getCenter().lng, map.getCenter().lat]) < NEAR_M ? f : forecast;
    const now = hourStart(Date.now());
    const hours = f.hours.filter((h) => h.t >= now).slice(0, 48);
    let lastDay = '';
    const rows = hours.map((h) => {
      const day = fmtDay(h.t);
      const head = day !== lastDay ? `<li class="day">${day}</li>` : '';
      lastDay = day;
      const picked = (pickedHour ?? now) === h.t;
      return `${head}<li><button type="button" data-t="${h.t}" class="${picked ? 'picked' : ''}">
        <span class="w-time">${h.t === now ? 'Now' : fmtHour(h.t)}</span>
        ${arrow(h.dir, 22)}
        <span class="w-dir">${compassDir(h.dir)}</span>
        <span class="w-spd"><b>${h.spd}</b> mph${h.gust > h.spd + 2 ? ` <small>g${h.gust}</small>` : ''}</span>
        <span class="w-temp">${h.temp}°${h.pop ? ` <small>${h.pop}%💧</small>` : ''}</span>
      </button></li>`;
    }).join('');
    body.innerHTML = `
      <h3 class="w-title">🌬 Wind${title ? ` at ${esc(title)}` : ' here'}</h3>
      <p class="fine">Forecast from ${ago(f.fetched)}${navigator.onLine === false ? ' (no signal, showing saved forecast)' : ''}. Arrows point the way the wind is blowing. Tap an hour to see scent cones for that time.</p>
      <label class="row"><input type="checkbox" id="chk-cones" ${prefs.cones ? 'checked' : ''}/> <span>Show scent cones from stands &amp; blinds</span></label>
      <ul class="wind-list">${rows}</ul>
      <p class="fine">Forecasts cover about a 1-mile area. In hollows and along ridges, the wind near the ground can swirl, and thermals pull air downhill in the morning and evening and uphill in the day. Keep using a wind checker.</p>
      <p class="fine">Weather data by <a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo.com</a></p>`;
    body.onclick = (e) => {
      const t = e.target.closest('[data-t]')?.dataset.t;
      if (!t) return;
      pickedHour = Number(t) === now ? null : Number(t);
      body.querySelectorAll('[data-t]').forEach((b) => b.classList.toggle('picked', b.dataset.t === t));
      paintChip();
      drawCones();
    };
    body.onchange = (e) => {
      if (e.target.id === 'chk-cones') {
        prefs.cones = e.target.checked;
        save('wind', prefs);
        drawCones();
      }
    };
  }

  chip.addEventListener('click', () => {
    const c = map.getCenter();
    showForecast(c.lng, c.lat);
  });

  return {
    showForecast,
    redraw: drawCones,
    get show() { return prefs.show; },
    setShow(on) {
      prefs.show = on;
      save('wind', prefs);
      update();
    },
    forStand(wp) {
      map.easeTo({ center: [wp.lng, wp.lat], zoom: Math.max(map.getZoom(), 15) });
      showForecast(wp.lng, wp.lat, wp.name);
    },
  };
}
