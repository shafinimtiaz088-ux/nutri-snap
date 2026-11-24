// crypto.js — encryption helpers using the built-in Web Crypto API.
// The user's PIN is stretched with PBKDF2 into two keys:
//   • an AES-GCM key that encrypts history and the allergy profile
//   • an HMAC key that turns barcodes into private record IDs
// Keys are non-extractable and only ever kept in memory while the app is unlocked.

const enc = new TextEncoder();
const dec = new TextDecoder();

export const PBKDF2_ITERATIONS = 310_000;
const CHECK_TEXT = 'nutrisnap-unlock-check';

export function randomBytes(length) {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

export async function deriveKeys(pin, salt, iterations = PBKDF2_ITERATIONS) {
  const subtle = globalThis.crypto.subtle;
  const base = await subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = new Uint8Array(
    await subtle.deriveBits({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, base, 512)
  );
  const aes = await subtle.importKey('raw', bits.slice(0, 32), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  const mac = await subtle.importKey('raw', bits.slice(32), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  bits.fill(0); // wipe the raw key material
  return { aes, mac };
}

export async function encryptJSON(keys, value) {
  const iv = randomBytes(12);
  const data = enc.encode(JSON.stringify(value));
  const ct = await globalThis.crypto.subtle.encrypt({ name: 'AES-GCM', iv }, keys.aes, data);
  return { iv, ct: new Uint8Array(ct) };
}

/** Throws if the key is wrong or the data was tampered with (AES-GCM is authenticated). */
export async function decryptJSON(keys, box) {
  const pt = await globalThis.crypto.subtle.decrypt({ name: 'AES-GCM', iv: box.iv }, keys.aes, box.ct);
  return JSON.parse(dec.decode(pt));
}

/** A private, stable ID for a barcode, so stored record keys don't reveal what was scanned. */
export async function recordId(keys, code) {
  const sig = await globalThis.crypto.subtle.sign('HMAC', keys.mac, enc.encode(code));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Encrypted known value, used to check the PIN without storing the PIN or a hash of it. */
export function makeCheck(keys) {
  return encryptJSON(keys, CHECK_TEXT);
}

export async function verifyCheck(keys, box) {
  try {
    return (await decryptJSON(keys, box)) === CHECK_TEXT;
  } catch {
    return false;
  }
}
