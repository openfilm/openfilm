/** Bounded, optional local analysis storage. Storage failures never interrupt preview/export. */
const DATABASE = 'openfilm-vision-analysis-v3';
const LIMIT = 128 * 1024 * 1024;
let opening;
function database() {
  return opening ??= new Promise((resolve) => {
    if (!globalThis.indexedDB) return resolve(null);
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore('frames', { keyPath: 'key' });
      store.createIndex('used', 'used');
      request.result.createObjectStore('meta');
    };
    request.onsuccess = () => { request.result.onversionchange = () => { request.result.close(); opening = undefined; }; resolve(request.result); };
    request.onerror = request.onblocked = () => resolve(null);
  });
}
export async function cachedAnalysis(key) {
  try {
    const db = await database(); if (!db) return null;
    return await new Promise((resolve) => {
      const tx = db.transaction('frames', 'readonly'), req = tx.objectStore('frames').get(key);
      req.onsuccess = () => resolve(req.result?.value ?? null);
      req.onerror = () => resolve(null);
    });
  } catch { return null; }
}
export async function storeAnalysis(key, value, bytes) {
  if (!(bytes > 0) || bytes > LIMIT / 4) return;
  try {
    const db = await database(); if (!db) return;
    await new Promise((resolve) => {
      const tx = db.transaction(['frames', 'meta'], 'readwrite'), frames = tx.objectStore('frames'), meta = tx.objectStore('meta');
      tx.oncomplete = tx.onerror = tx.onabort = () => resolve();
      const get = meta.get('bytes');
      get.onsuccess = () => {
        const old = frames.get(key);
        old.onsuccess = () => {
          let total = (get.result ?? 0) - (old.result?.bytes ?? 0) + bytes;
          frames.put({ key, value, bytes, used: Date.now() });
          if (total <= LIMIT) { meta.put(total, 'bytes'); return; }
          const cursor = frames.index('used').openCursor();
          cursor.onsuccess = () => {
            const row = cursor.result;
            if (total <= LIMIT || !row) { meta.put(Math.max(0, total), 'bytes'); return; }
            if (row.value.key !== key) { total -= row.value.bytes; row.delete(); }
            row.continue();
          };
        };
      };
    });
  } catch { /* private mode, quota exhaustion or an unavailable disk */ }
}
export async function clearAnalysisCache() {
  try {
    const db = await database(); if (!db) return;
    await new Promise((resolve) => {
      const tx = db.transaction(['frames', 'meta'], 'readwrite');
      tx.objectStore('frames').clear(); tx.objectStore('meta').clear();
      tx.oncomplete = tx.onerror = tx.onabort = () => resolve();
    });
  } catch {}
}
