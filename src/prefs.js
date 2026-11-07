// Small settings stored in localStorage (map view, layer choices).
// Waypoints and tracks will use IndexedDB instead (see storage.js in phase 2).
const PREFIX = 'huntmap:';

export function load(key, fallback) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return structuredClone(fallback);
    return { ...structuredClone(fallback), ...JSON.parse(raw) };
  } catch {
    return structuredClone(fallback);
  }
}

export function save(key, value) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* storage full or blocked: settings just won't persist */
  }
}
