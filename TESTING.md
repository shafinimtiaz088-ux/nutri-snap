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
