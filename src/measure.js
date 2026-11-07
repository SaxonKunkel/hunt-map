import { lineLength, ringArea, fmtDistance, fmtArea } from './geo.js';

// Measure tool: tap the map to add points. Line mode shows total distance;
// Area mode closes the shape and shows acres plus the distance around it.
export function createMeasure(map, { onChange }) {
  let active = false;
  let mode = 'line';
  let pts = [];

  const fc = (features) => ({ type: 'FeatureCollection', features });

  map.on('load', () => {
    map.addSource('measure', { type: 'geojson', data: fc([]) });
    map.addLayer({
      id: 'measure-fill', type: 'fill', source: 'measure', filter: ['==', '$type', 'Polygon'],
      paint: { 'fill-color': '#ffee00', 'fill-opacity': 0.25 },
    });
    map.addLayer({
      id: 'measure-casing', type: 'line', source: 'measure', filter: ['!=', '$type', 'Point'],
      paint: { 'line-color': '#000', 'line-width': 5, 'line-opacity': 0.6 },
    });
    map.addLayer({
      id: 'measure-line', type: 'line', source: 'measure', filter: ['!=', '$type', 'Point'],
      paint: { 'line-color': '#ffee00', 'line-width': 3, 'line-dasharray': [2, 1] },
    });
    map.addLayer({
      id: 'measure-pts', type: 'circle', source: 'measure', filter: ['==', '$type', 'Point'],
      paint: { 'circle-radius': 7, 'circle-color': '#ffee00', 'circle-stroke-color': '#000', 'circle-stroke-width': 2 },
    });
  });

  function render() {
    const features = pts.map((p) => ({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: p } }));
    if (mode === 'area' && pts.length >= 3) {
      features.unshift({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[...pts, pts[0]]] } });
    } else if (pts.length >= 2) {
      features.unshift({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: pts } });
    }
    map.getSource('measure')?.setData(fc(features));
    onChange(readout());
  }

  function readout() {
    if (!pts.length) return { main: mode === 'area' ? 'Tap the map around the area' : 'Tap the map to measure', sub: '' };
    if (mode === 'line') {
      return { main: fmtDistance(lineLength(pts)), sub: `${pts.length} point${pts.length > 1 ? 's' : ''}` };
    }
    if (pts.length < 3) return { main: 'Add at least 3 points', sub: '' };
    const ring = [...pts, pts[0]];
    return { main: fmtArea(ringArea(ring)), sub: `Distance around: ${fmtDistance(lineLength(ring))}` };
  }

  return {
    get active() { return active; },
    get mode() { return mode; },
    start() {
      active = true;
      pts = [];
      render();
    },
    stop() {
      active = false;
      pts = [];
      render();
    },
    setMode(m) {
      mode = m;
      render();
    },
    add(lngLat) {
      pts.push([lngLat.lng, lngLat.lat]);
      render();
    },
    undo() {
      pts.pop();
      render();
    },
    clear() {
      pts = [];
      render();
    },
  };
}
