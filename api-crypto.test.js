// Unit tests for the API client (with a fake fetch) and the encryption helpers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchProduct, LookupError } from '../js/api.js';
import { deriveKeys, encryptJSON, decryptJSON, makeCheck, verifyCheck, recordId, randomBytes } from '../js/crypto.js';

const jsonResponse = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => body });

test('fetchProduct returns a normalised product', async () => {
  let calledUrl = '';
  const fetchFn = async (url) => {
    calledUrl = url;
    return jsonResponse(200, { status: 1, product: { code: '5449000000996', product_name: 'Coca-Cola', nutriscore_grade: 'e' } });
  };
  const p = await fetchProduct('5449000000996', { fetchFn, isOnline: true });
  assert.equal(p.name, 'Coca-Cola');
  assert.match(calledUrl, /\/api\/v2\/product\/5449000000996\?fields=/);
});

test('fetchProduct returns null for unknown products (404)', async () => {
  const p = await fetchProduct('0000000000000', { fetchFn: async () => jsonResponse(404, { status: 0 }), isOnline: true });
  assert.equal(p, null);
});

test('fetchProduct reports offline without making a request', async () => {
  let called = false;
  await assert.rejects(
    fetchProduct('5449000000996', { fetchFn: async () => { called = true; }, isOnline: false }),
    (e) => e instanceof LookupError && e.kind === 'offline'
  );
  assert.equal(called, false);
});

test('fetchProduct times out on a slow server', async () => {
  const slow = (url, { signal }) => new Promise((_, reject) => {
    signal.addEventListener('abort', () => { const e = new Error('aborted'); e.name = 'AbortError'; reject(e); });
  });
  await assert.rejects(fetchProduct('5449000000996', { fetchFn: slow, timeout: 50, isOnline: true }), (e) => e.kind === 'timeout');
});

test('fetchProduct handles server errors and bad JSON', async () => {
  await assert.rejects(fetchProduct('1', { fetchFn: async () => jsonResponse(503, {}), isOnline: true }), (e) => e.kind === 'server');
  const badJson = async () => ({ status: 200, ok: true, json: async () => { throw new SyntaxError('bad'); } });
  await assert.rejects(fetchProduct('1', { fetchFn: badJson, isOnline: true }), (e) => e.kind === 'bad-data');
  await assert.rejects(fetchProduct('1', { fetchFn: async () => { throw new TypeError('Failed to fetch'); }, isOnline: true }), (e) => e.kind === 'network');
});

// Fewer PBKDF2 iterations keep the tests fast; the app uses 310,000.
const FAST = 1000;

test('encrypt then decrypt returns the same data', async () => {
  const keys = await deriveKeys('482916', randomBytes(16), FAST);
  const data = { name: 'Nutella', allergies: ['milk'] };
  const box = await encryptJSON(keys, data);
  assert.notEqual(new TextDecoder().decode(box.ct), JSON.stringify(data)); // really encrypted
  assert.deepEqual(await decryptJSON(keys, box), data);
});

test('the right PIN unlocks, the wrong PIN does not', async () => {
  const salt = randomBytes(16);
  const check = await makeCheck(await deriveKeys('482916', salt, FAST));
  assert.equal(await verifyCheck(await deriveKeys('482916', salt, FAST), check), true);
  assert.equal(await verifyCheck(await deriveKeys('482917', salt, FAST), check), false);
});

test('tampered data is detected', async () => {
  const keys = await deriveKeys('482916', randomBytes(16), FAST);
  const box = await encryptJSON(keys, { a: 1 });
  box.ct[0] ^= 1;
  await assert.rejects(decryptJSON(keys, box));
});

test('record IDs are stable and do not reveal the barcode', async () => {
  const keys = await deriveKeys('482916', randomBytes(16), FAST);
  const id1 = await recordId(keys, '3017620422003');
  assert.equal(id1, await recordId(keys, '3017620422003'));
  assert.equal(id1.length, 64);
  assert.ok(!id1.includes('3017620422003'));
});
