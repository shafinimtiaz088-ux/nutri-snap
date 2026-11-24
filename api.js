// api.js — talks to the Open Food Facts API (free, no API key needed).
import { normaliseProduct } from './logic.js';

const BASE = 'https://world.openfoodfacts.org/api/v2/product/';
// Only request the fields we use: smaller responses load faster on mobile data.
const FIELDS = [
  'code', 'product_name', 'brands', 'quantity', 'image_front_small_url', 'nutriscore_grade',
  'nutriments', 'allergens_tags', 'traces_tags', 'ingredients_text',
].join(',');

export class LookupError extends Error {
  constructor(kind, message) {
    super(message);
    this.kind = kind; // 'offline' | 'timeout' | 'network' | 'server' | 'bad-data'
  }
}

/**
 * Fetches and normalises a product. Resolves to null if the product isn't in the database.
 * fetchFn and isOnline can be replaced in unit tests.
 */
export async function fetchProduct(code, { timeout = 8000, fetchFn = globalThis.fetch, isOnline } = {}) {
  const online = isOnline ?? (typeof navigator === 'undefined' ? true : navigator.onLine);
  if (!online) throw new LookupError('offline', "You're offline. Connect to the internet to look up new products.");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  let res;
  try {
    res = await fetchFn(`${BASE}${encodeURIComponent(code)}?fields=${FIELDS}`, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    });
  } catch (err) {
    if (err && err.name === 'AbortError') {
      throw new LookupError('timeout', 'The food database took too long to respond. Please try again.');
    }
    throw new LookupError('network', "Couldn't reach the food database. Check your connection and try again.");
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 404) return null; // v2 API returns 404 for unknown barcodes
  if (!res.ok) throw new LookupError('server', `The food database returned an error (${res.status}). Please try again later.`);

  let json;
  try {
    json = await res.json();
  } catch {
    throw new LookupError('bad-data', 'The food database sent data we could not read.');
  }
  return normaliseProduct(json, code);
}
