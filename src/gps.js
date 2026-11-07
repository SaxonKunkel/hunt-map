import maplibregl from './maplibre.js';

// Shows your position (blue dot), accuracy circle and the direction the phone is pointing.
// Locate button cycles: off -> follow me -> follow me + map turns with compass -> follow me ...
export function createLocator(map, { onState, onFix, onError }) {
  const el = document.createElement('div');
  el.className = 'me';
  el.innerHTML = '<div class="me-cone"></div><div class="me-dot"></div>';
  const marker = new maplibregl.Marker({ element: el, rotationAlignment: 'map', pitchAlignment: 'map' });

  let watchId = null;
  let last = null; // last GeoLocationPosition
  let heading = null; // degrees from true north
  let mode = 'off'; // off | on | follow | compass
  let lastRotate = 0;

  map.on('load', () => {
    map.addSource('me-acc', { type: 'geojson', data: empty() });
    map.addLayer({
      id: 'me-acc', type: 'fill', source: 'me-acc',
      paint: { 'fill-color': '#1e90ff', 'fill-opacity': 0.15 },
    });
    map.addLayer({
      id: 'me-acc-line', type: 'line', source: 'me-acc',
      paint: { 'line-color': '#1e90ff', 'line-width': 1.5, 'line-opacity': 0.6 },
    });
  });

  // If the user drags the map, stop following (but keep showing the dot).
  map.on('dragstart', (e) => {
    if (e.originalEvent && (mode === 'follow' || mode === 'compass')) setMode('on');
  });

  function setMode(m) {
    const leavingCompass = mode === 'compass' && m === 'follow';
    mode = m;
    if (leavingCompass) map.easeTo({ bearing: 0, duration: 300 });
    onState(mode);
  }

  async function requestCompass() {
    // iPhone needs explicit permission, and it must be asked from a button tap.
    const DOE = window.DeviceOrientationEvent;
    if (DOE && typeof DOE.requestPermission === 'function') {
      try {
        if ((await DOE.requestPermission()) !== 'granted') return;
      } catch {
        return;
      }
    }
    if ('ondeviceorientationabsolute' in window) {
      window.addEventListener('deviceorientationabsolute', onOrientation, true);
    } else {
      window.addEventListener('deviceorientation', onOrientation, true);
    }
  }

  function onOrientation(e) {
    let h = null;
    if (typeof e.webkitCompassHeading === 'number') h = e.webkitCompassHeading; // iOS, already true-ish north
    else if (e.absolute && typeof e.alpha === 'number') h = 360 - e.alpha; // Android
    if (h == null || isNaN(h)) return;
    const screenAngle = (screen.orientation && screen.orientation.angle) || window.orientation || 0;
    heading = (h + screenAngle + 360) % 360;
    applyHeading();
  }

  function applyHeading() {
    el.classList.toggle('has-heading', heading != null);
    if (heading == null) return;
    marker.setRotation(heading);
    if (mode === 'compass') {
      const now = performance.now();
      if (now - lastRotate > 120) {
        lastRotate = now;
        map.easeTo({ bearing: heading, duration: 150, easing: (t) => t });
      }
    }
  }

  function onPosition(pos) {
    const first = !last;
    last = pos;
    const { longitude, latitude, accuracy, heading: gpsHeading, speed } = pos.coords;
    marker.setLngLat([longitude, latitude]);
    if (first) marker.addTo(map);
    // When walking and the compass isn't available, use the direction of travel.
    if (heading == null && gpsHeading != null && !isNaN(gpsHeading) && speed > 0.7) {
      marker.setRotation(gpsHeading);
      el.classList.add('has-heading');
    }
    const src = map.getSource('me-acc');
    if (src) src.setData(circle([longitude, latitude], accuracy));
    if (mode === 'follow' || mode === 'compass') followTo([longitude, latitude], first);
    onFix(pos);
  }

  // Keep the map centred on you. The first time, zoom in; don't interrupt that zoom with the next fixes.
  let wantZoom = null;
  function followTo(center, zoomIn) {
    if (zoomIn) wantZoom = Math.max(map.getZoom(), 15);
    map.easeTo({ center, zoom: wantZoom ?? map.getZoom(), duration: zoomIn ? 800 : 400 });
  }
  map.on('zoomstart', (e) => {
    if (e.originalEvent) wantZoom = null; // you pinched: respect your zoom
  });
  map.on('zoomend', () => {
    if (wantZoom != null && Math.abs(map.getZoom() - wantZoom) < 0.01) wantZoom = null;
  });

  function start() {
    if (!('geolocation' in navigator)) {
      onError('This browser has no GPS access.');
      return;
    }
    watchId = navigator.geolocation.watchPosition(onPosition, (err) => {
      if (err.code === err.PERMISSION_DENIED) {
        onError('Location is blocked. On iPhone: Settings → Privacy & Security → Location Services → Safari Websites (or Hunt Map) → While Using.');
        stop();
      } else {
        onError('Waiting for GPS signal…');
      }
    }, { enableHighAccuracy: true, maximumAge: 2000, timeout: 30000 });
  }

  function stop() {
    if (watchId != null) navigator.geolocation.clearWatch(watchId);
    watchId = null;
    setMode('off');
  }

  // Called when the locate button is tapped.
  async function toggle() {
    if (mode === 'off') {
      await requestCompass();
      start();
      setMode('follow');
      if (last) followTo([last.coords.longitude, last.coords.latitude], true);
      return;
    }
    if (mode === 'on') {
      setMode('follow');
      if (last) map.easeTo({ center: [last.coords.longitude, last.coords.latitude], duration: 500 });
      return;
    }
    if (mode === 'follow') {
      if (heading != null) {
        setMode('compass');
        applyHeading();
      } else if (last) {
        map.easeTo({ center: [last.coords.longitude, last.coords.latitude], duration: 500 });
      }
      return;
    }
    // compass -> back to follow, north up
    setMode('follow');
  }

  return {
    toggle,
    stop,
    get mode() { return mode; },
    get position() { return last; },
    northUp() {
      if (mode === 'compass') setMode('follow');
      map.easeTo({ bearing: 0, pitch: 0, duration: 400 });
    },
  };
}

function empty() {
  return { type: 'FeatureCollection', features: [] };
}

// Polygon approximating a circle of `meters` radius around [lng, lat].
function circle([lng, lat], meters, steps = 48) {
  const coords = [];
  const dLat = meters / 111320;
  const dLng = meters / (111320 * Math.cos((lat * Math.PI) / 180));
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    coords.push([lng + dLng * Math.cos(a), lat + dLat * Math.sin(a)]);
  }
  return { type: 'Feature', geometry: { type: 'Polygon', coordinates: [coords] }, properties: {} };
}
