// Waypoints and tracks are saved on the phone in IndexedDB (survives closing the app).
const DB_NAME = 'huntmap';
const DB_VERSION = 2;
export const STORES = ['waypoints', 'tracks', 'areas']; // areas = downloaded offline map areas

let dbPromise;
function db() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        for (const s of STORES) {
          if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => {
        const d = req.result;
        // if another copy of the app (e.g. after an update) needs the database, let go of it
        d.onversionchange = () => {
          d.close();
          dbPromise = null;
        };
        resolve(d);
      };
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

async function tx(store, mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction(store, mode);
    const result = fn(t.objectStore(store));
    t.oncomplete = () => resolve(result?.result ?? result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export const getAll = (store) => tx(store, 'readonly', (s) => s.getAll());
export const put = (store, item) => tx(store, 'readwrite', (s) => s.put(item));
export const remove = (store, id) => tx(store, 'readwrite', (s) => s.delete(id));

export const newId = () =>
  (crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`);
