/** Elements are borrowed. Playback, decoder release and retained snapshots belong to callers. */
export type PictureSource = HTMLImageElement | HTMLCanvasElement | HTMLVideoElement;
const MAX_SIDE = 2048;
const MAX_PIXELS = 4_000_000;
const identities = new WeakMap<PictureSource, number>();
let sequence = 0;

export function sourceDimensions(source: PictureSource): { width: number; height: number } {
  const width = source instanceof HTMLImageElement ? source.naturalWidth
    : source instanceof HTMLVideoElement ? source.videoWidth : source.width;
  const height = source instanceof HTMLImageElement ? source.naturalHeight
    : source instanceof HTMLVideoElement ? source.videoHeight : source.height;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0
    || (source instanceof HTMLVideoElement && source.readyState < 2)) {
    throw new Error('Picture source must have a decoded, ready frame before capture.');
  }
  return { width, height };
}

/** Capture synchronously before retiring an outgoing decoder. No media state is changed. */
export function freezePictureSource(source: PictureSource): HTMLCanvasElement {
  const { width, height } = sourceDimensions(source);
  const scale = Math.min(1, MAX_SIDE / width, MAX_SIDE / height, Math.sqrt(MAX_PIXELS / (width * height)));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.floor(width * scale));
  canvas.height = Math.max(1, Math.floor(height * scale));
  try {
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Picture frame canvas is unavailable.');
    context.drawImage(source, 0, 0, canvas.width, canvas.height);
    return canvas;
  } catch (error) {
    canvas.width = 0; canvas.height = 0;
    throw error;
  }
}

/** Canvas keys use identity because serializing pixels is costly and may be disallowed. */
export function getSourceKey(source: PictureSource): string {
  if (source instanceof HTMLImageElement || source instanceof HTMLVideoElement) {
    return source.currentSrc || source.src;
  }
  if (!identities.has(source)) identities.set(source, ++sequence);
  return `canvas:${identities.get(source)}`;
}

export interface PictureSurface {
  element: HTMLImageElement | HTMLCanvasElement;
  textureSource: HTMLImageElement | HTMLCanvasElement;
  width: number;
  height: number;
  refresh(): boolean;
  dispose(): void;
}

/** Canvas/video frames always get owned buffers: Curtains clears its canvas on disposal. */
export function createPictureSurface(source: PictureSource): PictureSurface {
  const size = sourceDimensions(source);
  const image = source instanceof HTMLImageElement;
  const element = image ? source.cloneNode(false) as HTMLImageElement : freezePictureSource(source);
  element.className = ''; element.removeAttribute('id');
  element.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;pointer-events:none';
  if (element instanceof HTMLImageElement) element.alt = '';
  let disposed = false;
  return {
    element, textureSource: image ? source : element,
    // GPU cover must use the exact bitmap ratio also used by endpoint object-fit.
    width: element instanceof HTMLCanvasElement ? element.width : size.width,
    height: element instanceof HTMLCanvasElement ? element.height : size.height,
    refresh() {
      if (disposed || !(source instanceof HTMLVideoElement || source instanceof HTMLCanvasElement)) return false;
      sourceDimensions(source);
      const canvas = element as HTMLCanvasElement;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Picture frame canvas is unavailable.');
      context.drawImage(source, 0, 0, canvas.width, canvas.height);
      return true;
    },
    dispose() {
      if (disposed) return;
      disposed = true; element.remove();
      if (element instanceof HTMLCanvasElement) { element.width = 0; element.height = 0; }
    },
  };
}
