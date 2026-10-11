// A small IndexedDB key/value store for things built in the browser (regions, the player, textures), so a second
// visit loads them instead of building them again. Every call fails soft: no IndexedDB means building again.

export interface BuiltStore {
  get<T>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
}

const none: BuiltStore = { get: async () => undefined, put: async () => {} };

export async function openBuiltStore(name = 'skate-scape-built'): Promise<BuiltStore> {
  if (typeof indexedDB === 'undefined') return none;
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('built');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }).catch(() => null);
  if (!db) return none;
  return {
    get: <T>(key: string) => new Promise<T | undefined>((resolve) => {
      try {
        const request = db.transaction('built', 'readonly').objectStore('built').get(key);
        request.onsuccess = () => resolve(request.result as T | undefined);
        request.onerror = () => resolve(undefined);
      } catch { resolve(undefined); }
    }),
    put: (key, value) => new Promise<void>((resolve) => {
      try {
        const tx = db.transaction('built', 'readwrite');
        tx.objectStore('built').put(value, key);
        tx.oncomplete = tx.onerror = tx.onabort = () => resolve();
      } catch { resolve(); }
    }),
  };
}
