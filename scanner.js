// scanner.js — barcode scanning that works on both Android and iOS.
//   Android Chrome: uses the fast built-in BarcodeDetector API.
//   iOS Safari (no BarcodeDetector): loads the ZXing library only when needed.
// Both engines share one loop that reads a frame every 150 ms.

const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e'];
let enginePromise = null;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Could not load the barcode reader.'));
    document.head.appendChild(s);
  });
}

async function createNativeEngine() {
  if (!('BarcodeDetector' in globalThis)) return null;
  try {
    const supported = await globalThis.BarcodeDetector.getSupportedFormats();
    const formats = FORMATS.filter((f) => supported.includes(f));
    if (!formats.length) return null;
    const detector = new globalThis.BarcodeDetector({ formats });
    return {
      name: 'native',
      async decode(source) {
        const codes = await detector.detect(source);
        return codes.length ? codes[0].rawValue : null;
      },
    };
  } catch {
    return null;
  }
}

async function createZxingEngine() {
  if (!globalThis.ZXing) await loadScript('vendor/zxing.min.js');
  const Z = globalThis.ZXing;
  const hints = new Map();
  hints.set(Z.DecodeHintType.POSSIBLE_FORMATS, [
    Z.BarcodeFormat.EAN_13, Z.BarcodeFormat.EAN_8, Z.BarcodeFormat.UPC_A, Z.BarcodeFormat.UPC_E,
  ]);
  hints.set(Z.DecodeHintType.TRY_HARDER, true);
  const reader = new Z.MultiFormatReader();
  reader.setHints(hints);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  return {
    name: 'zxing',
    async decode(source) {
      const w = source.videoWidth || source.naturalWidth || source.width;
      const h = source.videoHeight || source.naturalHeight || source.height;
      if (!w || !h) return null;
      // Scale big frames down: much faster to decode and still accurate.
      const scale = Math.min(1, 960 / Math.max(w, h));
      canvas.width = Math.round(w * scale);
      canvas.height = Math.round(h * scale);
      ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
      try {
        const lum = new Z.HTMLCanvasElementLuminanceSource(canvas);
        const bitmap = new Z.BinaryBitmap(new Z.HybridBinarizer(lum));
        return reader.decode(bitmap, hints).getText();
      } catch {
        return null; // NotFoundException: no barcode in this frame
      }
    },
  };
}

export function getEngine() {
  if (!enginePromise) {
    enginePromise = (async () => (await createNativeEngine()) || createZxingEngine())();
    enginePromise.catch(() => { enginePromise = null; });
  }
  return enginePromise;
}

export function cameraErrorMessage(err) {
  switch (err && err.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Camera permission was refused. You can allow it in your browser settings, type the barcode, or scan from a photo.';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'No camera was found on this device. Type the barcode or scan from a photo instead.';
    case 'NotReadableError':
      return 'The camera is being used by another app. Close it and try again.';
    default:
      return 'The camera could not be started. Type the barcode or scan from a photo instead.';
  }
}

export class Scanner {
  constructor(video) {
    this.video = video;
    this.stream = null;
    this.timer = null;
    this.busy = false;
  }

  get running() {
    return !!this.stream;
  }

  async start(onCode) {
    if (this.running) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      const e = new Error('No camera API'); e.name = 'NotFoundError'; throw e;
    }
    const engine = await getEngine();
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
    });
    const v = this.video;
    v.setAttribute('playsinline', ''); // required on iOS, or the video opens full screen
    v.muted = true;
    v.srcObject = this.stream;
    await v.play();

    this.timer = setInterval(async () => {
      if (this.busy || v.readyState < 2) return;
      this.busy = true;
      try {
        const code = await engine.decode(v);
        if (code && this.running) {
          this.stop();
          onCode(code, engine.name);
        }
      } catch { /* ignore a bad frame */ }
      this.busy = false;
    }, 150);
  }

  /** Always releases the camera so the light turns off and battery isn't wasted. */
  stop() {
    clearInterval(this.timer);
    this.timer = null;
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video.srcObject = null;
    this.busy = false;
  }
}

/** Reads a barcode from a photo (the fallback that works everywhere, including old iPhones). */
export async function decodeImageFile(file) {
  const engine = await getEngine();
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return await engine.decode(img);
  } finally {
    URL.revokeObjectURL(url);
  }
}
