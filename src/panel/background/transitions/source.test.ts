import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createPictureSurface, freezePictureSource, getSourceKey, sourceDimensions } from './source';

const draw = vi.fn();
beforeEach(() => {
  draw.mockReset();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: draw } as unknown as CanvasRenderingContext2D);
});
afterEach(() => vi.restoreAllMocks());

function video(width = 1920, height = 1080, readyState = 2) {
  const source = document.createElement('video');
  Object.defineProperties(source, { videoWidth: { value: width }, videoHeight: { value: height }, readyState: { value: readyState } });
  return source;
}

it('reads intrinsic image, decoded video and canvas sizes', () => {
  const image = new Image();
  Object.defineProperties(image, { naturalWidth: { value: 640 }, naturalHeight: { value: 360 } });
  const canvas = document.createElement('canvas'); canvas.width = 756; canvas.height = 1680;
  expect(sourceDimensions(image)).toEqual({ width: 640, height: 360 });
  expect(sourceDimensions(video())).toEqual({ width: 1920, height: 1080 });
  expect(sourceDimensions(canvas)).toEqual({ width: 756, height: 1680 });
});

it.each([[0, 1080, 2], [1920, 0, 2], [1920, 1080, 1], [Infinity, 1080, 2]])(
  'rejects an unavailable video frame (%s × %s, ready %s) before capture', (width, height, ready) => {
    expect(() => freezePictureSource(video(width, height, ready))).toThrow(/decoded|ready/i);
    expect(draw).not.toHaveBeenCalled();
  },
);

it.each([[7680, 4320], [4096, 4096], [756, 1680]])('bounds a frozen %s × %s frame without changing its source', (width, height) => {
  const source = video(width, height);
  source.src = '/clip.mp4'; source.loop = false;
  const pause = vi.spyOn(source, 'pause'); const load = vi.spyOn(source, 'load'); const play = vi.spyOn(source, 'play');
  const snapshot = freezePictureSource(source);
  expect(snapshot).toBeInstanceOf(HTMLCanvasElement);
  expect(Math.max(snapshot.width, snapshot.height)).toBeLessThanOrEqual(2048);
  expect(snapshot.width * snapshot.height).toBeLessThanOrEqual(4_000_000);
  expect(snapshot.width / snapshot.height).toBeCloseTo(width / height, 2);
  expect(draw).toHaveBeenCalledExactlyOnceWith(source, 0, 0, snapshot.width, snapshot.height);
  expect(source.src).toContain('/clip.mp4'); expect(source.loop).toBe(false);
  expect(pause).not.toHaveBeenCalled(); expect(play).not.toHaveBeenCalled(); expect(load).not.toHaveBeenCalled();
});

it('reports capture failure and missing canvas support to the caller', () => {
  draw.mockImplementationOnce(() => { throw new Error('Frame not available'); });
  expect(() => freezePictureSource(video())).toThrow('Frame not available');
  vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValueOnce(null);
  expect(() => freezePictureSource(video())).toThrow(/canvas/i);
});

it('uses the rounded owned bitmap dimensions for GPU cover and endpoint geometry', () => {
  const source = video(8192, 33);
  const surface = createPictureSurface(source);
  const canvas = surface.textureSource as HTMLCanvasElement;
  expect([canvas.width, canvas.height]).toEqual([2048, 8]);
  expect([surface.width, surface.height]).toEqual([canvas.width, canvas.height]);
  surface.dispose(); surface.dispose();
  expect([canvas.width, canvas.height]).toEqual([0, 0]);
  expect(surface.refresh()).toBe(false);
});

it('identifies distinct retained canvases and stable source elements without serializing pixels', () => {
  const first = document.createElement('canvas'); const second = document.createElement('canvas');
  expect(getSourceKey(first)).toBe(getSourceKey(first));
  expect(getSourceKey(first)).not.toBe(getSourceKey(second));
  const clip = video(); clip.src = '/clip.mp4';
  expect(getSourceKey(clip)).toContain('/clip.mp4');
});

it('refreshes a live shader mirror into an owned buffer without changing the borrowed source', () => {
  const source = document.createElement('canvas'); source.width = 320; source.height = 180;
  const surface = createPictureSurface(source);
  draw.mockClear();
  expect(surface.refresh()).toBe(true);
  expect(draw).toHaveBeenCalledExactlyOnceWith(source, 0, 0, 320, 180);
  surface.dispose();
  expect([source.width, source.height]).toEqual([320, 180]);
  expect(surface.refresh()).toBe(false);
});
