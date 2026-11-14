import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createShaderFrameBridge } from './shaderFrameBridge';

describe('shader transition frame bridge', () => {
  let copies: { target: HTMLCanvasElement; source: CanvasImageSource }[];
  let cleared: boolean;

  beforeEach(() => {
    copies = []; cleared = false;
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
      return { drawImage: (source: CanvasImageSource) => {
        if (cleared) throw new Error('WebGL frame already cleared');
        copies.push({ target: this, source });
      } } as unknown as CanvasRenderingContext2D;
    });
  });
  afterEach(() => vi.restoreAllMocks());

  function source(width = 4000, height = 4000) {
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    return canvas;
  }

  it('publishes only after a real draw, with a bounded mirror surviving the cleared GPU frame', () => {
    const ready = vi.fn();
    const bridge = createShaderFrameBridge(ready);
    expect(ready).not.toHaveBeenCalled();
    const gpu = source();
    bridge.draw(gpu);
    const mirror = ready.mock.calls[0][0] as HTMLCanvasElement;
    expect(mirror).not.toBe(gpu);
    expect(mirror.width * mirror.height).toBeLessThanOrEqual(4_000_000);
    expect(Math.max(mirror.width, mirror.height)).toBeLessThanOrEqual(2048);
    expect(copies).toEqual([{ target: mirror, source: gpu }]);
    cleared = true;
    expect(mirror.width).toBeGreaterThan(0);
    expect(ready).toHaveBeenCalledTimes(1);
  });

  it('refreshes the same mirror without React publications and reannounces a changed callback', () => {
    const ready = vi.fn(); const next = vi.fn();
    const bridge = createShaderFrameBridge(ready);
    const gpu = source(1200, 800);
    bridge.draw(gpu); bridge.draw(gpu);
    const mirror = ready.mock.calls[0][0];
    expect(ready).toHaveBeenCalledTimes(1);
    expect(copies.every(copy => copy.target === mirror)).toBe(true);
    bridge.setCallbacks(next);
    expect(next).not.toHaveBeenCalled();
    bridge.draw(gpu);
    expect(next).toHaveBeenCalledWith(mirror);
  });

  it('retires the outgoing mirror synchronously before releasing its pixels; late draws do nothing', () => {
    const ready = vi.fn(); const dimensions: number[] = [];
    const retire = vi.fn((canvas: HTMLCanvasElement) => dimensions.push(canvas.width));
    const bridge = createShaderFrameBridge(ready, retire);
    const gpu = source(); bridge.draw(gpu);
    const old = ready.mock.calls[0][0] as HTMLCanvasElement;
    bridge.dispose(); bridge.dispose(); bridge.draw(gpu);
    expect(dimensions[0]).toBeGreaterThan(0);
    expect(retire).toHaveBeenCalledOnce();
    expect(old.width).toBe(0);
    expect(ready).toHaveBeenCalledTimes(1);
    const replacement = vi.fn();
    const next = createShaderFrameBridge(replacement);
    next.draw(gpu);
    expect(replacement.mock.calls[0][0]).not.toBe(old);
  });

  it('disables a failed capture without a per-frame error flood and retries after callback change', () => {
    const ready = vi.fn(); const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const bridge = createShaderFrameBridge(ready);
    const gpu = source(); cleared = true;
    bridge.draw(gpu); bridge.draw(gpu);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(ready).toHaveBeenCalledWith(null);
    cleared = false;
    const next = vi.fn(); bridge.setCallbacks(next); bridge.draw(gpu);
    expect(next.mock.calls[0][0]).toBeInstanceOf(HTMLCanvasElement);
  });

  it('isolates failing consumer callbacks and still releases owned buffers', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    let published: HTMLCanvasElement | undefined;
    const bridge = createShaderFrameBridge(frame => {
      if (frame) { published = frame as HTMLCanvasElement; throw new Error('consumer failed'); }
    }, () => { throw new Error('retirement failed'); });
    expect(() => bridge.draw(source())).not.toThrow();
    expect(published?.width).toBe(0);
    expect(() => bridge.dispose()).not.toThrow();
  });

  it('keeps resized mirrors bounded and supports cancellation before the first source frame', () => {
    const ready = vi.fn(); const retire = vi.fn();
    const bridge = createShaderFrameBridge(ready, retire);
    const gpu = source(1200, 800); bridge.draw(gpu);
    const mirror = ready.mock.calls[0][0] as HTMLCanvasElement;
    gpu.width = 8000; gpu.height = 4000;
    bridge.draw(gpu);
    expect(mirror.width).toBe(2048);
    expect(mirror.width * mirror.height).toBeLessThanOrEqual(4_000_000);
    bridge.setCallbacks(ready, retire);
    expect(ready).toHaveBeenCalledTimes(1);
    const cancelled = createShaderFrameBridge(ready, retire);
    cancelled.dispose(); cancelled.setCallbacks(vi.fn()); cancelled.draw(gpu);
    expect(ready).toHaveBeenCalledTimes(1);
    expect(retire).not.toHaveBeenCalled();
  });
});
