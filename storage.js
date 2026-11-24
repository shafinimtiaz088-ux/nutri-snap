// storage.js — IndexedDB wrapper. Everything personal is stored encrypted.
//   meta store:    salt, PIN check value, encrypted allergy profile
//   history store: { id: HMAC(barcode), box: AES-GCM encrypted product + date }
import { encryptJSON, decryptJSON, recordId } from './crypto.js';

const DB_NAME = 'nutrisnap';
const DB_VERSION = 1;
let dbPromise = null;

function openDB() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
        if (!db.objectStoreNames.contains('history')) db.createObjectStore('history', { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

async function tx(store, mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let result;
    const req = fn(s);
    if (req) req.onsuccess = () => { result = req.result; };
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export async function getMeta(key) {
  const row = await tx('meta', 'readonly', (s) => s.get(key));
  return row ? row.value : undefined;
}

export function setMeta(key, value) {
  return tx('meta', 'readwrite', (s) => s.put({ key, value }));
}

export async function saveProfile(keys, profile) {
  await setMeta('profile', await encryptJSON(keys, profile));
}

export async function loadProfile(keys) {
  const box = await getMeta('profile');
  return box ? decryptJSON(keys, box) : { allergies: [] };
}

export async function saveHistoryItem(keys, product) {
  const id = await recordId(keys, product.code);
  const box = await encryptJSON(keys, { ...product, savedAt: Date.now() });
  await tx('history', 'readwrite', (s) => s.put({ id, box }));
}

export async function getHistoryItem(keys, code) {
  const id = await recordId(keys, code);
  const row = await tx('history', 'readonly', (s) => s.get(id));
  return row ? decryptJSON(keys, row.box) : null;
}

export async function deleteHistoryItem(keys, code) {
  const id = await recordId(keys, code);
  await tx('history', 'readwrite', (s) => s.delete(id));
}

/** All history, newest first. Records that fail to decrypt are skipped. */
export async function listHistory(keys) {
  const rows = (await tx('history', 'readonly', (s) => s.getAll())) || [];
  const items = await Promise.all(rows.map((r) => decryptJSON(keys, r.box).catch(() => null)));
  return items.filter(Boolean).sort((a, b) => b.savedAt - a.savedAt);
}

export function clearHistory() {
  return tx('history', 'readwrite', (s) => s.clear());
}

/** Re-encrypts everything with new keys (used when the PIN changes). */
export async function reencryptAll(oldKeys, newKeys, newSalt, newCheck) {
  const items = await listHistory(oldKeys);
  const profile = await loadProfile(oldKeys);
  const rows = await Promise.all(items.map(async (item) => ({
    id: await recordId(newKeys, item.code),
    box: await encryptJSON(newKeys, item),
  })));
  const profileBox = await encryptJSON(newKeys, profile);
  const db = await openDB();
  // One transaction so a failure can't leave data half-converted.
  await new Promise((resolve, reject) => {
    const t = db.transaction(['history', 'meta'], 'readwrite');
    const h = t.objectStore('history');
    const m = t.objectStore('meta');
    h.clear();
    rows.forEach((r) => h.put(r));
    m.put({ key: 'salt', value: newSalt });
    m.put({ key: 'check', value: newCheck });
    m.put({ key: 'profile', value: profileBox });
    t.oncomplete = resolve;
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export async function deleteEverything() {
  const db = await openDB();
  db.close();
  dbPromise = null;
  await new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = resolve;
    req.onerror = () => reject(req.error);
    req.onblocked = resolve;
  });
  try { localStorage.clear(); } catch { /* storage may be unavailable */ }
}
