import { afterEach, expect, it, vi } from 'vitest';
import { createPictureTransitionRunner } from './pictureRunner';
import type { AdapterFactory, TransitionAdapter } from './engine';

const image = () => {
  const value = new Image();
  Object.defineProperties(value, { naturalWidth: { value: 640 }, naturalHeight: { value: 360 } });
  return value;
};
const request = (effect = 'gl-transitions:WaterDrop') => ({
  from: image(), to: image(), settings: { effect, durationMs: 200 }, onComplete: vi.fn(), onFailed: vi.fn(),
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function harness(factory: AdapterFactory, frameCap: () => number | null = () => 10) {
  const stage = document.createElement('div');
  document.body.append(stage);
  const frames = new Map<number, FrameRequestCallback>();
  let sequence = 0;
  const loadFactory = vi.fn(async () => factory);
  const runner = createPictureTransitionRunner(stage, {
    loadFactory, now: () => 0, frameCap,
    requestFrame: (callback) => { frames.set(++sequence, callback); return sequence; },
    cancelFrame: (id) => { frames.delete(id); },
  });
  const tick = (time: number) => {
    const queued = [...frames.values()];
    frames.clear();
    queued.forEach((callback) => callback(time));
  };
  return { runner, stage, frames, tick, loadFactory };
}
afterEach(() => { document.body.replaceChildren(); vi.useRealTimers(); vi.restoreAllMocks(); });

it('holds the completed incoming endpoint until the caller commits the handoff', async () => {
  const adapter = { seek: vi.fn(), dispose: vi.fn() };
  const { runner, tick, frames, stage } = harness(() => adapter);
  const input = request();
  expect(await runner.replace(input)).toBe(true);
  const layer = stage.firstElementChild as HTMLElement;
  expect(frames.size).toBe(1);
  [0, 50, 100, 150, 200, 250].forEach(tick);
  await flush();
  expect(adapter.seek.mock.calls.map(([value]) => value)).toEqual([0, 0, 0.5, 1]);
  expect(input.onComplete).toHaveBeenCalledTimes(1);
  expect(input.onFailed).not.toHaveBeenCalled();
  expect(frames.size).toBe(0);
  expect(stage.firstElementChild).toBe(layer);
  expect(layer.style.visibility).not.toBe('hidden');
  expect(adapter.dispose).not.toHaveBeenCalled();

  await runner.cancel();
  expect(adapter.dispose).toHaveBeenCalledTimes(1);
  expect(stage.children).toHaveLength(0);
});

it('coalesces replacements and waits for pending creation and asynchronous disposal', async () => {
  const created = deferred<TransitionAdapter>();
  const released = deferred<void>();
  const first = { seek: vi.fn(), dispose: vi.fn(() => released.promise) };
  const next = { seek: vi.fn(), dispose: vi.fn() };
  const factory = vi.fn<AdapterFactory>().mockImplementationOnce(() => created.promise).mockImplementation(() => next);
  const { runner, stage } = harness(factory);
  const a = request(); const b = request(); const c = request('curtains:wave');
  const pendingA = runner.replace(a);
  await flush();
  const pendingB = runner.replace(b);
  const pendingC = runner.replace(c);
  expect(factory).toHaveBeenCalledTimes(1);
  expect(factory.mock.calls[0][0].signal?.aborted).toBe(true);
  created.resolve(first);
  await flush();
  expect(first.dispose).toHaveBeenCalledTimes(1);
  expect(factory).toHaveBeenCalledTimes(1);
  released.resolve();
  expect(await pendingA).toBe(false);
  expect(await pendingB).toBe(false);
  expect(await pendingC).toBe(true);
  expect(factory).toHaveBeenCalledTimes(2);
  expect(factory.mock.calls[1][0].to).toBe(c.to);
  expect(a.onComplete).not.toHaveBeenCalled();
  expect(a.onFailed).not.toHaveBeenCalled();
  expect(stage.children).toHaveLength(1);
  await runner.cancel();
});

it('reports a rendering failure once and allows a later independent transition', async () => {
  const bad = { seek: vi.fn(() => { throw new Error('Lost context'); }), dispose: vi.fn() };
  const good = { seek: vi.fn(), dispose: vi.fn() };
  const factory = vi.fn<AdapterFactory>().mockReturnValueOnce(bad).mockReturnValue(good);
  const { runner, frames } = harness(factory);
  const input = request();
  expect(await runner.replace(input)).toBe(false);
  expect(input.onFailed).toHaveBeenCalledExactlyOnceWith('Lost context');
  expect(input.onComplete).not.toHaveBeenCalled();
  expect(frames.size).toBe(0);
  expect(bad.dispose).toHaveBeenCalledTimes(1);
  expect(await runner.replace(request())).toBe(true);
  await runner.cancel();
});

it('bounds undecoded image readiness without creating a GPU instance', async () => {
  vi.useFakeTimers();
  const { runner, loadFactory } = harness(() => ({ seek() {}, dispose() {} }));
  const input = request();
  input.from = new Image();
  input.from.decode = () => new Promise<void>(() => {});
  const pending = runner.replace(input);
  await vi.advanceTimersByTimeAsync(4000);
  expect(await pending).toBe(false);
  expect(input.onFailed).toHaveBeenCalledTimes(1);
  expect(input.onFailed.mock.calls[0][0]).toContain('timed out');
  expect(loadFactory).not.toHaveBeenCalled();
  await runner.cancel();
});

it('accepts ready canvas/video frames without asking a video decoder to load or play', async () => {
  const adapter = { seek: vi.fn(), dispose: vi.fn() };
  const factory = vi.fn<AdapterFactory>(() => adapter);
  const { runner, tick } = harness(factory);
  const from = document.createElement('canvas'); from.width = 640; from.height = 360;
  const to = document.createElement('video');
  Object.defineProperties(to, { videoWidth: { value: 640 }, videoHeight: { value: 360 }, readyState: { value: 2 } });
  const load = vi.spyOn(to, 'load'); const play = vi.spyOn(to, 'play'); const pause = vi.spyOn(to, 'pause');
  const input = { ...request(), from, to };
  expect(await runner.replace(input)).toBe(true);
  expect(factory.mock.calls[0][0].to).toBe(to);
  tick(200); await flush();
  expect(input.onComplete).toHaveBeenCalledTimes(1);
  expect(load).not.toHaveBeenCalled(); expect(play).not.toHaveBeenCalled(); expect(pause).not.toHaveBeenCalled();
  await runner.cancel();
});

it('rejects a video without current frame data before loading an engine', async () => {
  const { runner, loadFactory } = harness(() => ({ seek() {}, dispose() {} }));
  const to = document.createElement('video');
  Object.defineProperties(to, { videoWidth: { value: 640 }, videoHeight: { value: 360 }, readyState: { value: 1 } });
  const input = { ...request(), to };
  expect(await runner.replace(input)).toBe(false);
  expect(input.onFailed).toHaveBeenCalledExactlyOnceWith('Picture source must have a decoded, ready frame before capture.');
  expect(loadFactory).not.toHaveBeenCalled();
  await runner.cancel();
});

it('disposes a late adapter after cancellation without callbacks or detached output', async () => {
  const created = deferred<TransitionAdapter>();
  const adapter = { seek: vi.fn(), dispose: vi.fn() };
  const { runner, stage, frames } = harness(() => created.promise);
  const input = request();
  const mounted = runner.replace(input);
  await flush();
  const canceled = runner.cancel();
  created.resolve(adapter);
  await canceled;
  expect(await mounted).toBe(false);
  expect(adapter.dispose).toHaveBeenCalledTimes(1);
  expect(adapter.seek).not.toHaveBeenCalled();
  expect(input.onComplete).not.toHaveBeenCalled();
  expect(input.onFailed).not.toHaveBeenCalled();
  expect(stage.children).toHaveLength(0);
  expect(frames.size).toBe(0);
});

it('waits for pending creation and disposal across component owners on the same page', async () => {
  const created = deferred<TransitionAdapter>();
  const disposed = deferred<void>();
  const oldAdapter = { seek: vi.fn(), dispose: vi.fn(() => disposed.promise) };
  const oldOwner = harness(() => created.promise);
  const oldReady = oldOwner.runner.replace(request());
  await flush();
  const retiring = oldOwner.runner.cancel();
  const newFactory = vi.fn(() => ({ seek: vi.fn(), dispose: vi.fn() }));
  const newOwner = harness(newFactory);
  const newReady = newOwner.runner.replace(request());
  await flush();
  expect(newFactory).not.toHaveBeenCalled();
  created.resolve(oldAdapter);
  await flush();
  expect(oldAdapter.dispose).toHaveBeenCalledTimes(1);
  expect(newFactory).not.toHaveBeenCalled();
  disposed.resolve();
  await retiring;
  expect(await oldReady).toBe(false);
  expect(await newReady).toBe(true);
  await newOwner.runner.cancel();
});

it('follows a changed frame cap without restarting elapsed transition time', async () => {
  const cap = vi.fn(() => 10);
  const adapter = { seek: vi.fn(), dispose: vi.fn() };
  const { runner, tick } = harness(() => adapter, cap);
  await runner.replace(request());
  tick(0); tick(50);
  cap.mockReturnValue(5);
  tick(60); tick(100); tick(200);
  expect(adapter.seek.mock.calls.map(([value]) => value)).toEqual([0, 0, 0.3, 1]);
  await runner.cancel();
});

it('keeps later requests usable after an acknowledged cleanup error', async () => {
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const bad = { seek: vi.fn(), dispose: vi.fn().mockRejectedValue(new Error('Cleanup rejected')) };
  const good = { seek: vi.fn(), dispose: vi.fn() };
  const factory = vi.fn<AdapterFactory>().mockReturnValueOnce(bad).mockReturnValue(good);
  const { runner } = harness(factory);
  await runner.replace(request());
  expect(await runner.replace(request('curtains:wave'))).toBe(true);
  expect(warning).toHaveBeenCalledExactlyOnceWith('Picture transition cleanup failed.', expect.any(Error));
  expect(good.seek).toHaveBeenCalledWith(0);
  await runner.cancel();
});

it('retires an actual playback failure once and leaves no scheduled frame', async () => {
  const adapter = { seek: vi.fn((value: number) => { if (value > 0.3) throw new Error('GPU lost'); }), dispose: vi.fn() };
  const { runner, tick, frames } = harness(() => adapter);
  const input = request();
  await runner.replace(input);
  tick(100); tick(200);
  await flush();
  expect(input.onFailed).toHaveBeenCalledExactlyOnceWith('GPU lost');
  expect(input.onComplete).not.toHaveBeenCalled();
  expect(adapter.dispose).toHaveBeenCalledTimes(1);
  expect(frames.size).toBe(0);
  await runner.cancel();
});
