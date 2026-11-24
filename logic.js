// logic.js — pure functions with no browser dependencies.
// Kept separate from the UI so they can be unit tested with `npm test`.

/** The 14 allergens that UK/EU law requires to be declared, mapped to Open Food Facts tags. */
export const ALLERGENS = [
  { id: 'gluten', label: 'Gluten (wheat, barley, rye, oats)', tags: ['en:gluten'] },
  { id: 'milk', label: 'Milk', tags: ['en:milk'] },
  { id: 'eggs', label: 'Eggs', tags: ['en:eggs'] },
  { id: 'peanuts', label: 'Peanuts', tags: ['en:peanuts'] },
  { id: 'nuts', label: 'Tree nuts', tags: ['en:nuts'] },
  { id: 'soy', label: 'Soya', tags: ['en:soybeans'] },
  { id: 'fish', label: 'Fish', tags: ['en:fish'] },
  { id: 'crustaceans', label: 'Crustaceans', tags: ['en:crustaceans'] },
  { id: 'molluscs', label: 'Molluscs', tags: ['en:molluscs'] },
  { id: 'sesame', label: 'Sesame', tags: ['en:sesame-seeds'] },
  { id: 'celery', label: 'Celery', tags: ['en:celery'] },
  { id: 'mustard', label: 'Mustard', tags: ['en:mustard'] },
  { id: 'sulphites', label: 'Sulphites', tags: ['en:sulphur-dioxide-and-sulphites'] },
  { id: 'lupin', label: 'Lupin', tags: ['en:lupin'] },
];

const VALID_LENGTHS = [8, 12, 13, 14];

/** Removes spaces and dashes that people often type into barcodes. */
export function cleanBarcode(input) {
  return String(input ?? '').trim().replace(/[\s-]/g, '');
}

/** GTIN check digit (EAN-8, UPC-A, EAN-13, GTIN-14). */
export function hasValidCheckDigit(code) {
  if (!/^\d+$/.test(code) || code.length < 2) return false;
  const digits = code.split('').map(Number);
  const check = digits.pop();
  let sum = 0;
  // Weights alternate 3,1,3,1… starting from the digit next to the check digit.
  for (let i = digits.length - 1, w = 3; i >= 0; i--, w = w === 3 ? 1 : 3) {
    sum += digits[i] * w;
  }
  return (10 - (sum % 10)) % 10 === check;
}

/**
 * Validates a barcode typed by the user or read by the scanner.
 * Returns { valid, code, error } where code is normalised (UPC-A → EAN-13).
 */
export function validateBarcode(input, { checksum = true } = {}) {
  const code = cleanBarcode(input);
  if (code === '') return { valid: false, code, error: 'Please enter a barcode number.' };
  if (!/^\d+$/.test(code)) return { valid: false, code, error: 'Barcodes contain numbers only.' };
  if (!VALID_LENGTHS.includes(code.length)) {
    return { valid: false, code, error: 'Barcodes are 8, 12, 13 or 14 digits long.' };
  }
  if (checksum && !hasValidCheckDigit(code)) {
    return { valid: false, code, error: "That barcode doesn't look right. Check the last digit." };
  }
  // Open Food Facts stores UPC-A codes as 13-digit EAN codes with a leading zero.
  const normalised = code.length === 12 ? '0' + code : code;
  return { valid: true, code: normalised, error: null };
}

/** Only allow product images from Open Food Facts over HTTPS (matches the CSP). */
export function safeImageUrl(url) {
  if (typeof url !== 'string') return null;
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return null;
    if (!/(^|\.)openfoodfacts\.org$/.test(u.hostname)) return null;
    return u.href;
  } catch {
    return null;
  }
}

function num(v) {
  const n = typeof v === 'string' ? parseFloat(v) : v;
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
}

function text(v, max = 300) {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

function tagList(v) {
  return Array.isArray(v) ? v.filter((t) => typeof t === 'string').slice(0, 50) : [];
}

/**
 * Turns a raw Open Food Facts API response into the small, validated object the app uses.
 * Returns null when the product was not found.
 */
export function normaliseProduct(json, requestedCode) {
  if (!json || typeof json !== 'object') return null;
  if (json.status !== 1 && json.status !== 'success') return null;
  const p = json.product;
  if (!p || typeof p !== 'object') return null;

  const n = p.nutriments && typeof p.nutriments === 'object' ? p.nutriments : {};
  const grade = typeof p.nutriscore_grade === 'string' ? p.nutriscore_grade.toLowerCase() : '';

  return {
    code: /^\d{8,14}$/.test(String(p.code)) ? String(p.code) : requestedCode,
    name: text(p.product_name) || 'Unnamed product',
    brand: text(p.brands).split(',')[0].trim(),
    quantity: text(p.quantity, 50),
    image: safeImageUrl(p.image_front_small_url),
    nutriScore: /^[a-e]$/.test(grade) ? grade : null,
    nutrients: {
      energyKcal: num(n['energy-kcal_100g']),
      fat: num(n.fat_100g),
      saturates: num(n['saturated-fat_100g']),
      sugars: num(n.sugars_100g),
      salt: num(n.salt_100g),
    },
    allergens: tagList(p.allergens_tags),
    traces: tagList(p.traces_tags),
    ingredients: text(p.ingredients_text, 3000),
  };
}

/** UK Food Standards Agency front-of-pack thresholds for food, per 100 g. */
export const FSA_THRESHOLDS = {
  fat: { low: 3, high: 17.5 },
  saturates: { low: 1.5, high: 5 },
  sugars: { low: 5, high: 22.5 },
  salt: { low: 0.3, high: 1.5 },
};

/** Returns 'low' | 'medium' | 'high', or null when the value is missing. */
export function nutrientLevel(nutrient, value) {
  const t = FSA_THRESHOLDS[nutrient];
  if (!t || value === null || value === undefined || !Number.isFinite(value)) return null;
  if (value <= t.low) return 'low';
  if (value > t.high) return 'high';
  return 'medium';
}

const NUTRISCORE_TEXT = {
  a: 'Very good nutritional quality',
  b: 'Good nutritional quality',
  c: 'Average nutritional quality',
  d: 'Poor nutritional quality',
  e: 'Bad nutritional quality',
};

export function nutriScoreInfo(grade) {
  if (!grade || !NUTRISCORE_TEXT[grade]) {
    return { letter: null, label: 'Nutri-Score not available for this product' };
  }
  return { letter: grade.toUpperCase(), label: `Nutri-Score ${grade.toUpperCase()}: ${NUTRISCORE_TEXT[grade]}` };
}

/** Compares a product's allergen tags with the user's allergy profile. */
export function findAllergenMatches(product, profileIds) {
  const result = { contains: [], mayContain: [] };
  if (!product || !Array.isArray(profileIds)) return result;
  for (const a of ALLERGENS) {
    if (!profileIds.includes(a.id)) continue;
    if (a.tags.some((t) => product.allergens.includes(t))) result.contains.push(a.label);
    else if (a.tags.some((t) => product.traces.includes(t))) result.mayContain.push(a.label);
  }
  return result;
}

/** Turns tags like "en:sesame-seeds" into readable text like "Sesame seeds". */
export function tagToLabel(tag) {
  const raw = String(tag).replace(/^[a-z]{2}:/, '').replace(/-/g, ' ').trim();
  return raw ? raw.charAt(0).toUpperCase() + raw.slice(1) : '';
}

export function formatAmount(value, unit = 'g') {
  if (value === null || value === undefined) return 'Not listed';
  return `${value} ${unit}`;
}

/** Filters history items by name, brand or barcode (case-insensitive). */
export function searchHistory(items, query) {
  const q = String(query ?? '').trim().toLowerCase();
  if (!q) return items;
  return items.filter((i) =>
    [i.name, i.brand, i.code].some((f) => String(f ?? '').toLowerCase().includes(q))
  );
}

/** PIN rules: 6–12 digits, not all the same digit, not a simple run like 123456. */
export function validatePin(pin, confirm) {
  const p = String(pin ?? '');
  if (!/^\d{6,12}$/.test(p)) return 'Your PIN must be 6 to 12 digits.';
  if (/^(\d)\1+$/.test(p)) return "Don't use the same digit repeated.";
  const asc = '01234567890123456789';
  const desc = '98765432109876543210';
  if (asc.includes(p) || desc.includes(p)) return "Don't use a simple sequence like 123456.";
  if (confirm !== undefined && p !== String(confirm)) return "The two PINs don't match.";
  return null;
}

/** Wrong-PIN lockout: 5 free attempts, then 30 s, doubling each time (max 15 min). */
export function lockoutDuration(failedAttempts) {
  if (failedAttempts < 5) return 0;
  return Math.min(30_000 * 2 ** (failedAttempts - 5), 15 * 60_000);
}
