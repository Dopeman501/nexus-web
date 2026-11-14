import { describe, expect, it, vi } from 'vitest';
import { ownFrameResources } from '../codrops-catalogue/resources';

describe('retiring an original demo browser realm', () => {
  it('cancels owned work and blocks late asynchronous code from recreating it', async () => {
    vi.useFakeTimers();
    const originals = {
      setTimeout: window.setTimeout, clearTimeout: window.clearTimeout,
      requestAnimationFrame: window.requestAnimationFrame, cancelAnimationFrame: window.cancelAnimationFrame,
      addEventListener: window.addEventListener, Worker: window.Worker,
    };
    const terminate = vi.fn();
    const NativeWorker = class { terminate = terminate; };
    window.Worker = NativeWorker as unknown as typeof Worker;
    try {
      const resources = ownFrameResources();
      const callback = vi.fn();
      window.setTimeout(callback, 10);
      window.requestAnimationFrame(callback);
      window.addEventListener('resize', callback);
      new window.Worker('/local-stir.worker.js');
      resources.dispose();
      resources.dispose();
      window.dispatchEvent(new Event('resize'));
      expect(window.setTimeout(callback, 1)).toBe(0);
      expect(window.requestAnimationFrame(callback)).toBe(0);
      window.addEventListener('resize', callback);
      window.dispatchEvent(new Event('resize'));
      expect(() => new window.Worker('/late.worker.js')).toThrow(/retired/);
      await vi.advanceTimersByTimeAsync(50);
      expect(callback).not.toHaveBeenCalled();
      expect(terminate).toHaveBeenCalledTimes(1);
      expect(resources.disposed).toBe(true);
    } finally {
      Object.assign(window, originals);
      vi.useRealTimers();
    }
  });
});
