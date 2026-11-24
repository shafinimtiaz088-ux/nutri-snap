// app.js — screens, navigation and wiring everything together.
import {
  ALLERGENS, validateBarcode, validatePin, nutrientLevel, nutriScoreInfo,
  findAllergenMatches, tagToLabel, formatAmount, searchHistory, lockoutDuration,
} from './logic.js';
import { deriveKeys, makeCheck, verifyCheck, randomBytes } from './crypto.js';
import * as store from './storage.js';
import { fetchProduct } from './api.js';
import { Scanner, cameraErrorMessage, decodeImageFile, getEngine } from './scanner.js';

const $ = (id) => document.getElementById(id);
const EXAMPLE_BARCODE = '3017620422003';
const AUTO_LOCK_MS = 2 * 60_000;

const state = {
  keys: null,        // in-memory encryption keys; null = locked
  profile: { allergies: [] },
  history: [],
  current: null,     // product on screen
  lastCode: null,
  hiddenAt: 0,
};

const scanner = new Scanner($('video'));

/* ---------- Small UI helpers ---------- */

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v; // textContent, never innerHTML: blocks XSS from API data
    else if (k.startsWith('aria-') || k === 'role') node.setAttribute(k, v);
    else node[k] = v;
  }
  children.flat().forEach((c) => c && node.append(c));
  return node;
}

let toastTimer;
function toast(message) {
  const t = $('toast');
  t.textContent = message;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 3500);
}

function confirmDialog(title, text, okLabel = 'Confirm') {
  const d = $('confirm-dialog');
  $('confirm-title').textContent = title;
  $('confirm-text').textContent = text;
  $('confirm-ok').textContent = okLabel;
  return new Promise((resolve) => {
    d.addEventListener('close', () => resolve(d.returnValue === 'ok'), { once: true });
    d.showModal();
  });
}

function setBusy(button, busy, label) {
  if (busy) { button.dataset.label = button.textContent; button.textContent = label; }
  else if (button.dataset.label) button.textContent = button.dataset.label;
  button.disabled = busy;
}

const SCREENS = ['loading', 'setup', 'unlock', 'scan', 'product', 'history', 'profile'];

function show(name, { focus = true } = {}) {
  for (const s of SCREENS) $(`screen-${s}`).hidden = s !== name;
  const unlocked = !!state.keys;
  $('tabbar').hidden = !unlocked;
  $('btn-lock').hidden = !unlocked;
  document.querySelectorAll('#tabbar a').forEach((a) => {
    const active = a.dataset.tab === name || (name === 'product' && a.dataset.tab === 'scan');
    if (active) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  if (name !== 'scan') stopCamera();
  if (focus) {
    // Move focus to the new screen's heading so screen-reader users hear where they are.
    const h = $(`screen-${name}`).querySelector('h1:not([hidden])');
    if (h) requestAnimationFrame(() => h.focus({ preventScroll: true }));
    window.scrollTo(0, 0);
  }
}

/* ---------- Settings (not personal, stored in plain localStorage) ---------- */

function loadSettings() {
  let s = {};
  try { s = JSON.parse(localStorage.getItem('settings') || '{}'); } catch { /* ignore */ }
  $('opt-large-text').checked = !!s.largeText;
  $('opt-high-contrast').checked = !!s.highContrast;
  applySettings();
}

function applySettings() {
  const s = { largeText: $('opt-large-text').checked, highContrast: $('opt-high-contrast').checked };
  document.documentElement.classList.toggle('large-text', s.largeText);
  document.documentElement.classList.toggle('high-contrast', s.highContrast);
  try { localStorage.setItem('settings', JSON.stringify(s)); } catch { /* ignore */ }
}

/* ---------- PIN: setup, unlock, lock ---------- */

async function setupPin(e) {
  e.preventDefault();
  const pin = $('setup-pin').value;
  const err = validatePin(pin, $('setup-pin2').value)
    || (!$('setup-consent').checked ? 'Please tick the box to confirm you understand.' : null);
  $('setup-error').textContent = err || '';
  if (err) return;
  const btn = e.submitter || $('setup-form').querySelector('button');
  setBusy(btn, true, 'Setting up…');
  try {
    const salt = randomBytes(16);
    const keys = await deriveKeys(pin, salt);
    await store.setMeta('salt', salt);
    await store.setMeta('check', await makeCheck(keys));
    await store.saveProfile(keys, { allergies: [] });
    $('setup-form').reset();
    await onUnlocked(keys);
    toast('All set! Add your allergies in Profile.');
  } catch (ex) {
    console.error(ex);
    $('setup-error').textContent = 'Something went wrong while setting up. Please try again.';
  } finally {
    setBusy(btn, false);
  }
}

function getLockout() {
  try { return JSON.parse(localStorage.getItem('lockout') || '{"fails":0,"until":0}'); }
  catch { return { fails: 0, until: 0 }; }
}
function setLockout(v) { try { localStorage.setItem('lockout', JSON.stringify(v)); } catch { /* ignore */ } }

async function unlock(e) {
  e.preventDefault();
  const lock = getLockout();
  const wait = lock.until - Date.now();
  if (wait > 0) {
    $('unlock-error').textContent = `Too many wrong attempts. Try again in ${Math.ceil(wait / 1000)} seconds.`;
    return;
  }
  const pin = $('unlock-pin').value;
  if (!pin) { $('unlock-error').textContent = 'Please enter your PIN.'; return; }
  const btn = $('unlock-btn');
  setBusy(btn, true, 'Unlocking…');
  try {
    const salt = await store.getMeta('salt');
    const keys = await deriveKeys(pin, salt);
    if (await verifyCheck(keys, await store.getMeta('check'))) {
      setLockout({ fails: 0, until: 0 });
      $('unlock-form').reset();
      $('unlock-error').textContent = '';
      await onUnlocked(keys);
    } else {
      const fails = lock.fails + 1;
      const ms = lockoutDuration(fails);
      setLockout({ fails, until: ms ? Date.now() + ms : 0 });
      $('unlock-error').textContent = ms
        ? `Wrong PIN. For your security, wait ${Math.round(ms / 1000)} seconds before trying again.`
        : `Wrong PIN. ${5 - fails} ${5 - fails === 1 ? 'attempt' : 'attempts'} left before a short wait.`;
      $('unlock-pin').select();
    }
  } finally {
    setBusy(btn, false);
  }
}

async function onUnlocked(keys) {
  state.keys = keys;
  state.profile = await store.loadProfile(keys).catch(() => ({ allergies: [] }));
  renderAllergyOptions();
  if (!location.hash || location.hash === '#/' || location.hash === '#') location.hash = '#/scan';
  else route();
}

function lockApp(message) {
  stopCamera();
  state.keys = null;          // drop keys from memory
  state.history = [];
  state.current = null;
  show('unlock');
  if (message) toast(message);
}

async function forgotPin() {
  const ok = await confirmDialog(
    'Reset NutriSnap?',
    "Your data is encrypted with your PIN, so it can't be recovered without it. Resetting deletes your history and allergies and lets you create a new PIN.",
    'Reset app'
  );
  if (!ok) return;
  await store.deleteEverything();
  location.hash = '';
  await boot();
}

/* ---------- Camera ---------- */

async function startCamera() {
  const btn = $('btn-start-scan');
  setBusy(btn, true, 'Starting camera…');
  $('viewfinder').hidden = false;
  try {
    await scanner.start((code) => {
      if (navigator.vibrate) navigator.vibrate(60); // haptic confirmation (Android)
      stopCamera();
      lookup(code, { fromScanner: true });
    });
    btn.hidden = true;
    $('btn-stop-scan').hidden = false;
  } catch (err) {
    console.warn('Camera error', err);
    $('viewfinder').hidden = true;
    $('manual-error').textContent = cameraErrorMessage(err);
  } finally {
    setBusy(btn, false);
  }
}

function stopCamera() {
  scanner.stop();
  $('viewfinder').hidden = true;
  $('btn-start-scan').hidden = false;
  $('btn-stop-scan').hidden = true;
}

async function scanPhoto(e) {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!file) return;
  toast('Reading barcode from photo…');
  try {
    const code = await decodeImageFile(file);
    if (code) lookup(code, { fromScanner: true });
    else $('manual-error').textContent = "We couldn't find a barcode in that photo. Try a closer, sharper photo, or type the number.";
  } catch (err) {
    console.warn(err);
    $('manual-error').textContent = "That photo couldn't be read. Try another photo or type the number.";
  }
}

/* ---------- Lookup & product screen ---------- */

function lookup(input, { fromScanner = false } = {}) {
  const v = validateBarcode(input, { checksum: !fromScanner });
  if (!v.valid) {
    $('manual-error').textContent = v.error;
    $('manual-code').focus();
    return;
  }
  $('manual-error').textContent = '';
  $('manual-code').value = '';
  const target = `#/product/${v.code}`;
  if (location.hash === target) route(); else location.hash = target;
}

async function showProduct(code) {
  state.lastCode = code;
  show('product', { focus: false });
  $('p-content').hidden = true;
  $('p-error').hidden = true;
  $('p-loading').hidden = false;

  try {
    // 1. Already in history? Show it instantly. Works offline too.
    let product = await store.getHistoryItem(state.keys, code);
    let fromHistory = !!product;
    // 2. Otherwise ask Open Food Facts.
    if (!product) {
      const t0 = performance.now();
      product = await fetchProduct(code);
      console.info(`Lookup ${code} took ${Math.round(performance.now() - t0)} ms`);
      if (!product) {
        showLookupError('Product not found',
          `Barcode ${code} isn't in the Open Food Facts database yet. Check the number, or try another product.`, false);
        return;
      }
      await store.saveHistoryItem(state.keys, product);
      product.savedAt = Date.now();
    }
    if (state.lastCode !== code) return; // user moved on while we were loading
    renderProduct(product, fromHistory);
  } catch (err) {
    console.warn(err);
    showLookupError(err.kind === 'offline' ? "You're offline" : "Couldn't load product",
      err.kind ? err.message : 'Something went wrong. Please try again.', true);
  }
}

function showLookupError(title, text, canRetry) {
  $('p-loading').hidden = true;
  $('p-error').hidden = false;
  $('p-error-title').textContent = title;
  $('p-error-text').textContent = text;
  $('btn-retry').hidden = !canRetry;
  $('p-error-title').focus();
}

function renderProduct(p, fromHistory) {
  state.current = p;
  $('p-loading').hidden = true;
  $('p-content').hidden = false;

  $('p-name').textContent = p.name;
  $('p-brand').textContent = [p.brand, p.quantity].filter(Boolean).join(' · ');
  $('p-code').textContent = `Barcode ${p.code}`;

  const img = $('p-img');
  img.onerror = () => { img.removeAttribute('src'); img.classList.add('placeholder'); };
  img.classList.toggle('placeholder', !p.image);
  if (p.image) { img.src = p.image; img.alt = `Photo of ${p.name}`; } else { img.removeAttribute('src'); img.alt = ''; }

  // Allergy warning
  const m = findAllergenMatches(p, state.profile.allergies);
  const alert = $('allergy-alert');
  alert.replaceChildren();
  if (m.contains.length || m.mayContain.length) {
    alert.hidden = false;
    alert.className = m.contains.length ? 'alert danger' : 'alert warning';
    alert.append(el('strong', { text: m.contains.length ? '⚠ Contains your allergens' : '⚠ May contain your allergens' }));
    if (m.contains.length) alert.append(el('p', { text: `Contains: ${m.contains.join(', ')}` }));
    if (m.mayContain.length) alert.append(el('p', { text: `May contain: ${m.mayContain.join(', ')}` }));
    if (navigator.vibrate) navigator.vibrate([120, 80, 120]);
  } else {
    alert.hidden = true;
  }

  // Nutri-Score: letter + text, so colour is never the only signal
  const info = nutriScoreInfo(p.nutriScore);
  const ns = $('p-nutriscore');
  ns.replaceChildren();
  const scale = el('div', { class: 'ns-scale', 'aria-hidden': 'true' });
  for (const g of ['a', 'b', 'c', 'd', 'e']) {
    scale.append(el('span', { class: `ns ns-${g}${g === p.nutriScore ? ' active' : ''}`, text: g.toUpperCase() }));
  }
  ns.append(info.letter ? scale : '', el('p', { class: 'ns-label', text: info.label }));

  // Nutrients with FSA traffic-light levels
  const rows = [
    ['Energy', p.nutrients.energyKcal, 'kcal', null],
    ['Fat', p.nutrients.fat, 'g', 'fat'],
    ['Saturates', p.nutrients.saturates, 'g', 'saturates'],
    ['Sugars', p.nutrients.sugars, 'g', 'sugars'],
    ['Salt', p.nutrients.salt, 'g', 'salt'],
  ];
  $('p-nutrients').replaceChildren(...rows.map(([label, value, unit, key]) => {
    const level = key ? nutrientLevel(key, value) : null;
    return el('li', {},
      el('span', { class: 'n-label', text: label }),
      el('span', { class: 'n-value', text: formatAmount(value, unit) }),
      level ? el('span', { class: `level level-${level}`, text: level[0].toUpperCase() + level.slice(1) }) : el('span'));
  }));

  $('p-allergens').textContent = p.allergens.length
    ? `Contains: ${p.allergens.map(tagToLabel).join(', ')}`
    : 'No allergens listed.';
  $('p-traces').textContent = p.traces.length ? `May contain: ${p.traces.map(tagToLabel).join(', ')}` : '';
  $('p-ingredients').textContent = p.ingredients || 'No ingredients listed.';
  $('p-saved').textContent = fromHistory && p.savedAt
    ? `Saved in your history on ${new Date(p.savedAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}.`
    : 'Saved to your history.';
  $('p-name').focus();
}

async function deleteCurrent() {
  if (!state.current) return;
  await store.deleteHistoryItem(state.keys, state.current.code);
  toast('Removed from history');
  location.hash = '#/history';
}

/* ---------- History ---------- */

async function showHistory() {
  show('history');
  state.history = await store.listHistory(state.keys);
  renderHistory();
}

function renderHistory() {
  const items = searchHistory(state.history, $('history-search').value);
  const list = $('history-list');
  $('history-empty').hidden = state.history.length > 0;
  $('history-search').hidden = state.history.length === 0;
  $('history-count').textContent = state.history.length
    ? `${items.length} of ${state.history.length} products` : '';
  list.replaceChildren(...items.map((p) => {
    const m = findAllergenMatches(p, state.profile.allergies);
    const flag = m.contains.length ? 'Contains your allergens' : m.mayContain.length ? 'May contain your allergens' : '';
    const info = nutriScoreInfo(p.nutriScore);
    const btn = el('a', { class: 'history-item', href: `#/product/${p.code}` },
      el('span', { class: `ns-chip ns-${p.nutriScore || 'none'}`, text: info.letter || '?', 'aria-hidden': 'true' }),
      el('span', { class: 'h-text' },
        el('span', { class: 'h-name', text: p.name }),
        el('span', { class: 'h-meta', text: [p.brand, new Date(p.savedAt).toLocaleDateString('en-GB')].filter(Boolean).join(' · ') }),
        flag ? el('span', { class: 'h-flag', text: `⚠ ${flag}` }) : ''));
    btn.setAttribute('aria-label', [p.name, p.brand, info.label, flag].filter(Boolean).join('. '));
    return el('li', {}, btn);
  }));
}

/* ---------- Profile ---------- */

function renderAllergyOptions() {
  const box = $('allergy-options');
  box.replaceChildren(...ALLERGENS.map((a) => {
    const input = el('input', { type: 'checkbox', value: a.id, checked: state.profile.allergies.includes(a.id) });
    return el('label', { class: 'check' }, input, ` ${a.label}`);
  }));
}

async function saveAllergies() {
  const ids = [...$('allergy-options').querySelectorAll('input:checked')].map((i) => i.value);
  state.profile = { ...state.profile, allergies: ids };
  await store.saveProfile(state.keys, state.profile);
  toast('Allergies saved');
}

async function changePin(e) {
  e.preventDefault();
  const err = validatePin($('pin-new').value, $('pin-new2').value);
  if (err) { $('pin-error').textContent = err; return; }
  const btn = e.submitter || $('pin-form').querySelector('button');
  setBusy(btn, true, 'Changing…');
  try {
    const oldKeys = await deriveKeys($('pin-old').value, await store.getMeta('salt'));
    if (!(await verifyCheck(oldKeys, await store.getMeta('check')))) {
      $('pin-error').textContent = 'Your current PIN is wrong.';
      return;
    }
    const salt = randomBytes(16);
    const newKeys = await deriveKeys($('pin-new').value, salt);
    await store.reencryptAll(oldKeys, newKeys, salt, await makeCheck(newKeys));
    state.keys = newKeys;
    $('pin-form').reset();
    $('pin-error').textContent = '';
    $('pin-form').closest('details').open = false;
    toast('PIN changed');
  } catch (ex) {
    console.error(ex);
    $('pin-error').textContent = "Couldn't change your PIN. Nothing was changed. Please try again.";
  } finally {
    setBusy(btn, false);
  }
}

async function clearAllHistory() {
  if (await confirmDialog('Clear history?', 'This removes every product from your history. Your allergies and PIN stay.', 'Clear history')) {
    await store.clearHistory();
    state.history = [];
    toast('History cleared');
  }
}

async function deleteAll() {
  if (await confirmDialog('Delete all data?', 'This permanently deletes your history, allergies and PIN from this device.', 'Delete everything')) {
    await store.deleteEverything();
    state.keys = null;
    location.hash = '';
    await boot();
    toast('All your data was deleted');
  }
}

/* ---------- Routing ---------- */

function route() {
  if (!state.keys) return; // locked: stay on setup/unlock
  const hash = location.hash || '#/scan';
  const productMatch = hash.match(/^#\/product\/(\d{8,14})$/);
  if (productMatch) return showProduct(productMatch[1]);
  if (hash === '#/history') return showHistory();
  if (hash === '#/profile') return show('profile');
  if (hash !== '#/scan') { location.replace('#/scan'); return; }
  show('scan');
}

/* ---------- Start-up ---------- */

async function boot() {
  show('loading', { focus: false });
  loadSettings();
  const hasPin = !!(await store.getMeta('check').catch(() => null));
  show(hasPin ? 'unlock' : 'setup');
}

function wireEvents() {
  $('setup-form').addEventListener('submit', setupPin);
  $('unlock-form').addEventListener('submit', unlock);
  $('btn-forgot').addEventListener('click', forgotPin);
  $('btn-lock').addEventListener('click', () => lockApp('NutriSnap locked'));
  $('btn-lock-now').addEventListener('click', () => lockApp('NutriSnap locked'));

  $('btn-start-scan').addEventListener('click', startCamera);
  $('btn-stop-scan').addEventListener('click', stopCamera);
  $('btn-photo').addEventListener('click', () => $('photo-input').click());
  $('photo-input').addEventListener('change', scanPhoto);
  $('manual-form').addEventListener('submit', (e) => { e.preventDefault(); lookup($('manual-code').value); });
  $('btn-example').addEventListener('click', () => lookup(EXAMPLE_BARCODE));

  $('btn-back').addEventListener('click', () => history.length > 1 ? history.back() : (location.hash = '#/scan'));
  $('btn-retry').addEventListener('click', () => state.lastCode && showProduct(state.lastCode));
  $('btn-scan-another').addEventListener('click', () => { location.hash = '#/scan'; });
  $('btn-scan-next').addEventListener('click', () => { location.hash = '#/scan'; });
  $('btn-delete-item').addEventListener('click', deleteCurrent);

  let searchTimer;
  $('history-search').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(renderHistory, 150); });
  $('btn-history-scan').addEventListener('click', () => { location.hash = '#/scan'; });

  $('allergy-options').addEventListener('change', saveAllergies);
  $('opt-large-text').addEventListener('change', applySettings);
  $('opt-high-contrast').addEventListener('change', applySettings);
  $('pin-form').addEventListener('submit', changePin);
  $('btn-clear-history').addEventListener('click', clearAllHistory);
  $('btn-delete-all').addEventListener('click', deleteAll);

  window.addEventListener('hashchange', route);

  // Auto-lock and release the camera when the app goes to the background.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      state.hiddenAt = Date.now();
      stopCamera();
    } else if (state.keys && Date.now() - state.hiddenAt > AUTO_LOCK_MS) {
      lockApp('Locked after being in the background');
    }
  });

  const updateOnline = () => { $('offline-badge').hidden = navigator.onLine; };
  window.addEventListener('online', updateOnline);
  window.addEventListener('offline', updateOnline);
  updateOnline();
}

wireEvents();
boot().catch((err) => {
  console.error(err);
  $('screen-loading').replaceChildren(el('p', { class: 'card', text: "NutriSnap couldn't start. Private browsing can block storage. Try a normal window." }));
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch((err) => console.warn('Service worker failed', err));
    // Warm up the scanner engine after start-up so the first scan starts faster.
    setTimeout(() => getEngine().catch(() => {}), 3000);
  });
}
