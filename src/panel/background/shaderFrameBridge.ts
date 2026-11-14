import { freezePictureSource, sourceDimensions, type PictureSource } from './transitions/source';

type Ready = (source: PictureSource | null) => void;
type Retiring = (source: HTMLCanvasElement) => void;

/** Owns one bounded CPU mirror. Call draw synchronously after the shader's drawArrays:
 * its WebGL drawing buffer may already be cleared by the next animation frame. */
export function createShaderFrameBridge(initialReady: Ready, initialRetiring?: Retiring) {
  let ready = initialReady;
  let retiring = initialRetiring;
  let mirror: HTMLCanvasElement | null = null;
  let announced = false;
  let failed = false;
  let disposed = false;
  let warned = false;

  function report(error: unknown) {
    if (warned) return;
    warned = true;
    console.warn('Background transition shader frame capture unavailable.', error);
  }

  function release() {
    const outgoing = mirror;
    mirror = null;
    if (!outgoing) return;
    // The receiver freezes this source before its owned pixels are released.
    try { retiring?.(outgoing); } catch (error) { report(error); }
    finally { outgoing.width = 0; outgoing.height = 0; }
  }

  return {
    setCallbacks(nextReady: Ready, nextRetiring?: Retiring) {
      if (disposed || (nextReady === ready && nextRetiring === retiring)) return;
      const changedReady = nextReady !== ready;
      ready = nextReady; retiring = nextRetiring;
      if (changedReady) announced = false;
      // A changed receiver can recover a failed capture, without retrying every frame.
      failed = false; warned = false;
    },
    draw(source: HTMLCanvasElement) {
      if (disposed || failed) return;
      try {
        if (!mirror) mirror = freezePictureSource(source);
        else {
          const { width, height } = sourceDimensions(source);
          const scale = Math.min(1, 2048 / width, 2048 / height, Math.sqrt(4_000_000 / (width * height)));
          const targetWidth = Math.max(1, Math.floor(width * scale));
          const targetHeight = Math.max(1, Math.floor(height * scale));
          if (mirror.width !== targetWidth) mirror.width = targetWidth;
          if (mirror.height !== targetHeight) mirror.height = targetHeight;
          const context = mirror.getContext('2d');
          if (!context) throw new Error('Picture frame canvas is unavailable.');
          context.drawImage(source, 0, 0, mirror.width, mirror.height);
        }
        if (!announced) {
          announced = true;
          ready(mirror);
        }
      } catch (error) {
        failed = true;
        report(error);
        release();
        try { ready(null); } catch (callbackError) { report(callbackError); }
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      release();
    },
  };
}
