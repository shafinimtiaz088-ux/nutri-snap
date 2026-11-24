// Unit tests for the app's logic. Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateBarcode, hasValidCheckDigit, normaliseProduct, nutrientLevel, nutriScoreInfo,
  findAllergenMatches, tagToLabel, searchHistory, validatePin, safeImageUrl, lockoutDuration, formatAmount,
} from '../js/logic.js';

test('valid EAN-13 barcode passes', () => {
  assert.deepEqual(validateBarcode('3017620422003'), { valid: true, code: '3017620422003', error: null });
});

test('spaces and dashes are removed', () => {
  assert.equal(validateBarcode(' 3017 6204-22003 ').code, '3017620422003');
});

test('wrong check digit is rejected', () => {
  const r = validateBarcode('3017620422004');
  assert.equal(r.valid, false);
  assert.match(r.error, /last digit/);
});

test('letters, empty input and wrong lengths are rejected', () => {
  assert.match(validateBarcode('').error, /enter a barcode/);
  assert.match(validateBarcode('30176abc22003').error, /numbers only/);
  assert.match(validateBarcode('12345').error, /8, 12, 13 or 14/);
  assert.match(validateBarcode('<script>').error, /numbers only/);
});

test('EAN-8 check digit works', () => {
  assert.equal(hasValidCheckDigit('96385074'), true);
  assert.equal(hasValidCheckDigit('96385075'), false);
});

test('12-digit UPC-A is converted to EAN-13', () => {
  assert.equal(validateBarcode('036000291452').code, '0036000291452');
});

test('scanner codes can skip the checksum', () => {
  assert.equal(validateBarcode('01234565', { checksum: false }).valid, true);
});

const sampleResponse = {
  status: 1,
  product: {
    code: '3017620422003',
    product_name: 'Nutella',
    brands: 'Ferrero, Nutella',
    quantity: '400 g',
    image_front_small_url: 'https://images.openfoodfacts.org/images/products/301/762/042/2003/front_en.200.jpg',
    nutriscore_grade: 'e',
    nutriments: { 'energy-kcal_100g': 539, fat_100g: 30.9, 'saturated-fat_100g': 10.6, sugars_100g: '56.3', salt_100g: 0.107 },
    allergens_tags: ['en:milk', 'en:nuts', 'en:soybeans'],
    traces_tags: [],
    ingredients_text: 'Sugar, palm oil, hazelnuts 13%...',
  },
};

test('API response is normalised', () => {
  const p = normaliseProduct(sampleResponse, '3017620422003');
  assert.equal(p.name, 'Nutella');
  assert.equal(p.brand, 'Ferrero');
  assert.equal(p.nutriScore, 'e');
  assert.equal(p.nutrients.sugars, 56.3); // string converted to number
  assert.equal(p.nutrients.salt, 0.11);   // rounded to 2 decimal places
  assert.deepEqual(p.allergens, ['en:milk', 'en:nuts', 'en:soybeans']);
});

test('not-found, empty or broken responses return null', () => {
  assert.equal(normaliseProduct({ status: 0, status_verbose: 'product not found' }, '1'), null);
  assert.equal(normaliseProduct(null, '1'), null);
  assert.equal(normaliseProduct('garbage', '1'), null);
});

test('missing fields get safe defaults', () => {
  const p = normaliseProduct({ status: 1, product: { nutriscore_grade: 'unknown', nutriments: { fat_100g: -5 } } }, '3017620422003');
  assert.equal(p.name, 'Unnamed product');
  assert.equal(p.code, '3017620422003');
  assert.equal(p.nutriScore, null);
  assert.equal(p.nutrients.fat, null); // negative values ignored
  assert.equal(p.image, null);
  assert.deepEqual(p.allergens, []);
});

test('only HTTPS Open Food Facts images are allowed', () => {
  assert.ok(safeImageUrl('https://images.openfoodfacts.org/a.jpg'));
  assert.equal(safeImageUrl('http://images.openfoodfacts.org/a.jpg'), null);
  assert.equal(safeImageUrl('https://evil.example.com/a.jpg'), null);
  assert.equal(safeImageUrl('https://openfoodfacts.org.evil.com/a.jpg'), null);
  assert.equal(safeImageUrl('javascript:alert(1)'), null);
});

test('FSA traffic-light levels use the right thresholds', () => {
  assert.equal(nutrientLevel('sugars', 5), 'low');
  assert.equal(nutrientLevel('sugars', 5.1), 'medium');
  assert.equal(nutrientLevel('sugars', 22.5), 'medium');
  assert.equal(nutrientLevel('sugars', 22.6), 'high');
  assert.equal(nutrientLevel('salt', 1.6), 'high');
  assert.equal(nutrientLevel('fat', null), null);
  assert.equal(nutrientLevel('unknown', 3), null);
});

test('Nutri-Score text is readable', () => {
  assert.equal(nutriScoreInfo('a').letter, 'A');
  assert.match(nutriScoreInfo('e').label, /Bad/);
  assert.equal(nutriScoreInfo(null).letter, null);
});

test('allergy matching finds "contains" and "may contain"', () => {
  const product = { allergens: ['en:milk', 'en:nuts'], traces: ['en:peanuts'] };
  const m = findAllergenMatches(product, ['milk', 'peanuts', 'fish']);
  assert.deepEqual(m.contains, ['Milk']);
  assert.deepEqual(m.mayContain, ['Peanuts']);
});

test('no allergy profile means no warnings', () => {
  const m = findAllergenMatches({ allergens: ['en:milk'], traces: [] }, []);
  assert.deepEqual(m, { contains: [], mayContain: [] });
});

test('tags become readable labels', () => {
  assert.equal(tagToLabel('en:sesame-seeds'), 'Sesame seeds');
  assert.equal(tagToLabel('fr:lait'), 'Lait');
});

test('formatAmount handles missing values', () => {
  assert.equal(formatAmount(3.2, 'g'), '3.2 g');
  assert.equal(formatAmount(null), 'Not listed');
});

test('history search matches name, brand and barcode', () => {
  const items = [
    { name: 'Nutella', brand: 'Ferrero', code: '3017620422003' },
    { name: 'Coca-Cola', brand: 'Coca-Cola', code: '5449000000996' },
  ];
  assert.equal(searchHistory(items, 'nut').length, 1);
  assert.equal(searchHistory(items, 'FERRERO').length, 1);
  assert.equal(searchHistory(items, '5449').length, 1);
  assert.equal(searchHistory(items, '').length, 2);
});

test('PIN rules block weak PINs', () => {
  assert.match(validatePin('1234'), /6 to 12/);
  assert.match(validatePin('111111'), /same digit/);
  assert.match(validatePin('123456'), /sequence/);
  assert.match(validatePin('987654'), /sequence/);
  assert.match(validatePin('482916', '482917'), /don't match/);
  assert.equal(validatePin('482916', '482916'), null);
});

test('lockout gets longer after repeated wrong PINs', () => {
  assert.equal(lockoutDuration(4), 0);
  assert.equal(lockoutDuration(5), 30_000);
  assert.equal(lockoutDuration(6), 60_000);
  assert.equal(lockoutDuration(50), 15 * 60_000); // capped
});
