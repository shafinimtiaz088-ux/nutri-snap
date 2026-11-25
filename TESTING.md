# NutriSnap: Testing

## 1. Automated unit tests

Run `npm test`. There are 29 tests in `tests/`:

| Area | What is checked |
|---|---|
| Barcode validation | EAN-13/EAN-8 check digits, letters, empty input, wrong lengths, UPC-A → EAN-13 |
| API parsing | Normal product, missing fields, negative numbers, not-found and broken responses |
| API errors | Offline (no request sent), timeout, server error 503, bad JSON, network failure |
| Security | Unsafe image URLs rejected, weak PINs rejected, lockout timing, encryption round-trip, wrong PIN fails, tampered data detected, record IDs hide the barcode |
| Features | Allergy matching ("contains" / "may contain"), FSA thresholds at the boundaries, Nutri-Score text, history search |

## 2. End-to-end browser test (already run during development)

The app was run in headless Chrome at iPhone size (390×844) with a fake camera showing a generated EAN-13 barcode and a mocked API. Results:

- Weak PIN `123456` was rejected; a valid PIN was set up in about 0.25 s.
- The camera scan decoded the barcode (ZXing path) and showed the product with a "Contains: Milk" warning.
- A wrong PIN gave "4 attempts left"; the right PIN unlocked.
- An unknown barcode showed "Product not found".
- The raw IndexedDB data did **not** contain the product name, so it is encrypted.
- Offline: the app reopened, the history item loaded, and a new lookup showed "You're offline".
- Portrait, landscape and dark mode were all checked. No JavaScript errors.

## 3. Manual tests on real devices (fill these in)

| # | Test | Expected | Android | iPhone |
|---|---|---|---|---|
| 1 | Install from browser | App icon on home screen, opens without browser bar | | |
| 2 | Create PIN `123456` | Rejected with a message | | |
| 3 | Create a valid PIN | Goes to Scan screen | | |
| 4 | Start camera, scan a real product | Product shown within ~2 s | | |
| 5 | Deny camera permission | Friendly message; photo/typing still work | | |
| 6 | Scan from a photo | Product shown | | |
| 7 | Type a wrong check digit | "Check the last digit" message | | |
| 8 | Tick Milk, scan a milk product | Red allergy warning (+ vibration on Android) | | |
| 9 | Unknown barcode | "Product not found" | | |
| 10 | Aeroplane mode → open History item | Opens normally | | |
| 11 | Aeroplane mode → new barcode | "You're offline" message | | |
| 12 | Background app for over 2 minutes | Locked when reopened | | |
| 13 | 5 wrong PINs | 30-second wait | | |
| 14 | Change PIN | History still readable with the new PIN | | |
| 15 | Rotate to landscape | Layout still usable | | |
| 16 | Larger text / High contrast | Text bigger / stronger contrast | | |
| 17 | Screen reader (TalkBack / VoiceOver) on product screen | Name, Nutri-Score text, allergy alert read out | | |
| 18 | Delete all data | Back to Welcome screen | | |
| 19 | Lighthouse (Chrome DevTools) | Record Performance / Accessibility / Best Practices scores | | |

## 4. User testing (aim for 3–5 people)

Tasks: (1) set up the app, (2) add an allergy, (3) scan a product and say whether it is safe for you, (4) find it again in History.

| User | Completed tasks | Time | Problems noticed | Changes made |
|---|---|---|---|---|
| 1 | | | | |
| 2 | | | | |
| 3 | | | | |

## 5. Cross-platform problems handled in the code

| Issue | Cause | Fix |
|---|---|---|
| Scanning didn't work on iPhone | Safari has no `BarcodeDetector` API | Added ZXing fallback, loaded only when needed |
| Camera opened full screen on iPhone | iOS plays video full screen by default | Added `playsinline` and `muted` to the video |
| 12-digit US barcodes not found | Open Food Facts stores them as 13 digits | Add a leading 0 (UPC-A → EAN-13) |
| Nutri-Score letters hard to read | Official B/C colours fail WCAG contrast with white text | Darker shades, plus a text label so colour isn't needed |
| Camera stayed on after leaving the Scan screen | Stream not stopped | Stop all tracks when the screen changes or the app is hidden |
| App could hang on slow mobile data | `fetch` has no timeout | 8 s timeout with `AbortController` and a retry button |

*Add your own bugs here as you test on your phone.*

## 6. Test results (25 November 2026)

Run in Chrome mobile emulation at iPhone 17 screen size (402×874, iOS user agent) with a fake camera showing a real EAN-13 barcode, against the same files deployed on GitHub Pages. Open Food Facts responses were mocked so the results are repeatable.

| # | Test | Result | Notes |
|---|---|---|---|
| 1 | App is installable (manifest, icons, service worker) | ✅ Pass | 0 installability errors, 0 manifest errors (Chrome, normal profile) |
| 2 | Weak PIN 123456 rejected | ✅ Pass | Don't use a simple sequence like 123456. |
| 3 | Valid PIN creates account and opens Scan screen | ✅ Pass | 0.23s |
| 4 | Camera scan finds product | ✅ Pass | decoded and displayed in 0.3s (fake camera) |
| 5 | Camera permission denied shows a helpful message | ✅ Pass | "Camera permission was refused…"; typing and photo still work |
| 6 | Scan from a photo | ✅ Pass | barcode read from PNG photo |
| 7 | Wrong check digit rejected | ✅ Pass | That barcode doesn't look right. Check the last digit. |
| 8 | Allergy warning for a milk product | ✅ Pass | ⚠ Contains your allergensContains: Milk |
| 9 | Unknown barcode shows "Product not found" | ✅ Pass |  |
| 10 | Offline: app reloads and opens a saved product | ✅ Pass | app shell served by service worker; product from encrypted IndexedDB |
| 11 | Offline: new barcode shows offline message | ✅ Pass | Couldn't load product / Couldn't reach the food database. Check your connection and try again. |
| 12 | Auto-lock after over 2 minutes in background | ✅ Pass | background time simulated (3 min) |
| 13 | 5 wrong PINs trigger a wait | ✅ Pass | Wrong PIN. For your security, wait 30 seconds before trying again. |
| 14 | Change PIN keeps history readable | ✅ Pass | unlocked with new PIN, history decrypted |
| 15 | Landscape layout usable | ✅ Pass | no horizontal scrolling; main buttons visible |
| 16 | Larger text and high contrast | ✅ Pass | body text 16px → 20px; no horizontal scroll |
| 17 | Screen reader: product info exposed in accessibility tree | ✅ Pass | heading, alert role and Nutri-Score text present; focus on "p-name" |
| 18 | Delete all data returns to Welcome screen | ✅ Pass | all data deleted; only an empty database is recreated when the app restarts |
| 19 | Lighthouse mobile audit | ✅ Pass | Performance 100, Accessibility 100, Best Practices 100, SEO 100; FCP 0.8 s, LCP 1.4 s, CLS 0 |

**19 / 19 passed.** Two steps failed on the first run because of the test setup, not the app: Chrome never offers installation in incognito profiles, and the mocked API kept answering while the browser was “offline”. Both were re-run with a correct setup.

### Accessibility audit (axe-core, WCAG 2.0/2.1/2.2 A and AA rules)

| Screen | First run | After fix |
|---|---|---|
| Welcome / setup | 0 violations | 0 |
| Unlock | 0 | 0 |
| Scan | 0 | 0 |
| Product | 0 | 0 |
| History | **1 serious: label-content-name-mismatch (WCAG 2.5.3)** | 0 |
| Profile | 0 | 0 |
| Profile (large text + high contrast) | 0 | 0 |

**Fix:** history items had an `aria-label` that left out the date shown on screen. They now take their name from the visible text, plus visually hidden Nutri-Score text.

**Not yet done:** testing on a physical phone, user testing with real people, and a live screen-reader (VoiceOver/TalkBack) test.
