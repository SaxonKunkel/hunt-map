// MapLibre 6 runs map rendering work in a separate "worker" file.
// Point it at the copy Vite bundles with the app so it also works offline.
import * as maplibregl from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';

maplibregl.setWorkerUrl(workerUrl);

export default maplibregl;
