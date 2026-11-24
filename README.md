# NutriSnap 🥫📱

**Scan a food barcode → see its Nutri-Score, nutrition traffic lights and allergens, with a warning if it contains something you're allergic to.**

NutriSnap is a Progressive Web App (PWA). One set of code runs on **Android and iOS**: it installs to the home screen, opens full screen like a native app and works offline.

CS32005 Mobile Application Development, University of Dundee.

---

## Features

| Feature | How it's done | Marking criterion |
|---|---|---|
| Barcode scanning with the camera | Native `BarcodeDetector` on Android; **ZXing** fallback on iOS, loaded only when needed | Hardware / sensors |
| Scan from a photo | `<input type="file" capture>`, which works on every phone | Hardware, reliability |
| Product lookup | **Open Food Facts API v2** (free, no API key), with an 8 s timeout and clear error messages | API integration |
| Allergy warnings | The 14 UK legal allergens; "contains" vs "may contain"; vibration on Android | Core functionality |
| Nutrition traffic lights | UK Food Standards Agency low/medium/high thresholds | Core functionality |
| History with search | **IndexedDB**, encrypted; works offline | Local storage |
| PIN lock | PBKDF2 (310,000 rounds) → AES-GCM-256 keys; lockout after 5 wrong tries; auto-lock after 2 min in background | Security / authentication |
| Offline | Service worker caches the app; scanned products open offline | Performance, PWA |
| Accessibility | Screen-reader labels, focus management, colour + text (never colour alone), 48 px touch targets, larger text and high-contrast modes, dark mode, reduced motion | Accessibility |
| Responsive | Portrait, landscape, tablet; iPhone notch safe areas | UX |

---

## Run it on your computer

Camera and service workers only work on `localhost` or HTTPS.

```bash
cd nutrisnap
python3 -m http.server 8080      # or: npx serve .
```
Open http://localhost:8080. In Chrome DevTools, press Ctrl+Shift+M to see it as a phone.

## Run the unit tests

Needs Node.js 18 or later (no packages to install):

```bash
npm test
```
29 tests cover barcode validation, API parsing, error handling, allergy matching, traffic-light thresholds, PIN rules and encryption.

## Put it online (GitHub Pages, free, HTTPS)

1. Create a new GitHub repository and upload everything in this folder.
2. Repository → **Settings → Pages** → Source: *Deploy from a branch* → Branch: `main`, folder `/ (root)` → Save.
3. After about a minute your app is at `https://<your-username>.github.io/<repo-name>/`.

All paths are relative, so it works inside the repo sub-folder.

## Install on a phone

- **Android (Chrome):** open the URL → *Install app* prompt (or ⋮ menu → *Install app*) → open from the home screen.
- **iPhone (Safari):** open the URL → Share button → *Add to Home Screen* → open from the home screen. Camera scanning in an installed iOS app needs iOS 16.4 or later; *Scan from a photo* works on all versions.

---

## 5-minute demo plan

1. **(30 s) The problem:** reading labels for allergens and nutrition is slow and easy to get wrong.
2. **(30 s) Install:** open the URL on the phone → install → launch from the home screen (no browser bar).
3. **(30 s) Security:** create a PIN; show that a weak PIN like `123456` is rejected.
4. **(30 s) Profile:** tick *Milk* and *Peanuts* in My allergies.
5. **(60 s) Scan:** scan a real product → Nutri-Score, traffic lights, **red allergy warning**. Then *Try an example product* (Nutella, 3017620422003).
6. **(30 s) History:** search, open an item.
7. **(30 s) Offline:** turn on aeroplane mode → reopen a product from History → try a new barcode → friendly "You're offline" message.
8. **(30 s) Accessibility:** Profile → Larger text / High contrast; mention screen-reader labels.
9. **(30 s) Under the hood:** DevTools → Application → Service Workers / IndexedDB (data is encrypted bytes) → Lighthouse score; run `npm test`.

Backup if the camera fails: *Scan from a photo* or type the barcode.

---

## Project structure

```
index.html          all screens (single-page app)
css/style.css       mobile-first styles, dark mode, accessibility modes
js/app.js           screens, navigation, events
js/logic.js         pure functions (validation, parsing, allergens, thresholds); unit tested
js/api.js           Open Food Facts client (timeout, error types); unit tested
js/crypto.js        PBKDF2 / AES-GCM / HMAC with Web Crypto; unit tested
js/storage.js       IndexedDB, encrypted records
js/scanner.js       camera + BarcodeDetector / ZXing
sw.js               service worker (offline)
manifest.json       install settings and icons
vendor/zxing.min.js ZXing barcode library (MIT)
tests/              unit tests (node:test)
TESTING.md          manual test plan, user testing and bug log templates
```

## Security, privacy and ethics

- **No account and no server.** All personal data stays on the device (data minimisation, UK GDPR).
- **Encrypted at rest.** History and allergies (health data, a special category under UK GDPR) are encrypted with AES-GCM-256. The key is derived from the PIN with PBKDF2-SHA-256 (310,000 iterations, random salt) and kept only in memory while unlocked. Record IDs are HMACs, so even the stored keys don't reveal what was scanned. The PIN itself is never stored.
- **Brute-force protection:** 5 free attempts, then 30 s, doubling up to 15 minutes.
- **Only the barcode number** is sent to Open Food Facts, over HTTPS, with no cookies or referrer.
- **XSS protection:** API data is only inserted with `textContent`, never `innerHTML`; strict Content-Security-Policy; image URLs are checked to be HTTPS Open Food Facts URLs.
- **User control:** delete one item, clear history, or delete all data at any time.
- **Honesty about data quality:** the app says that Open Food Facts is crowd-sourced and tells allergy sufferers to check the packaging.

**Known limitations** (useful for the report's reflection):
- Someone with the phone and a lot of time could still try every PIN offline. A longer PIN or a passphrase would be stronger.
- Open Food Facts has gaps for some UK own-brand products.
- iOS PWAs can't vibrate, and iOS may clear storage for apps unused for weeks.
- The Nutri-Score colours were darkened from the official ones so white letters meet WCAG contrast.

## Credits and licences

- Product data: [Open Food Facts](https://world.openfoodfacts.org), Open Database License (ODbL).
- Barcode decoding: [ZXing for JavaScript](https://github.com/zxing-js/library) (`@zxing/library` 0.21.3, MIT licence).
- Traffic-light thresholds: UK Food Standards Agency / Department of Health front-of-pack guidance.
- PBKDF2 iteration guidance: OWASP Password Storage Cheat Sheet.
- AI use: *(write your own statement here, as required by the assessment brief. Say which parts were generated or assisted by AI, how you checked and changed them, and what you learned.)*
