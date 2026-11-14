import { describe, expect, it, vi } from 'vitest';
import { createTransitionController } from '../controller';
import type { AdapterFactory, TransitionAdapter } from '../adapter';

const image = () => new Image();
const adapter = () => ({ seek: vi.fn(), dispose: vi.fn() });

describe('transition lab controller ownership', () => {
  it('keeps an aborted pending iframe connected but invisible until its explicit cleanup settles', async () => {
    const stage = document.createElement('div');
    document.body.append(stage);
    const controller = createTransitionController(stage);
    let finishCleanup!: () => void;
    let layer!: HTMLElement;
    let cleanupPromise: Promise<void> | undefined;
    const cleanup = vi.fn(() => cleanupPromise ??= new Promise<void>(resolve => { finishCleanup = resolve; }));
    const mounting = controller.mount(({ stage: pendingStage, signal, onPendingDispose }) => {
      layer = pendingStage;
      layer.append(document.createElement('iframe'));
      onPendingDispose?.(cleanup);
      return new Promise((_resolve, reject) => {
        signal?.addEventListener('abort', () => { void cleanup().then(() => reject(new Error('canceled'))); });
      });
    }, image(), image());
    await Promise.resolve();
    const clearing = controller.clear();
    await Promise.resolve();
    expect(layer.isConnected).toBe(true);
    expect(layer.style.visibility).toBe('hidden');
    finishCleanup();
    await clearing;
    expect(await mounting).toBe(false);
    expect(stage.children).toHaveLength(0);
    stage.remove();
  });

  it('releases a stale asynchronously loaded adapter and keeps only the latest selection', async () => {
    let finish!: (value: TransitionAdapter) => void;
    const stale = adapter();
    const latest = adapter();
    const pending: AdapterFactory = () => new Promise(resolve => { finish = resolve; });
    const controller = createTransitionController(document.createElement('div'));
    const first = controller.mount(pending, image(), image());
    await Promise.resolve();
    await controller.mount(() => latest, image(), image());
    finish(stale);
    await first;
    controller.seek(0.5);
    expect(stale.dispose).toHaveBeenCalledOnce();
    expect(latest.seek).toHaveBeenLastCalledWith(0.5);
    expect(controller.snapshot().activeAdapters).toBe(1);
    await controller.clear();
    expect(latest.dispose).toHaveBeenCalledOnce();
    expect(controller.snapshot().activeAdapters).toBe(0);
  });

  it('bounds progress and invalid duration, replaces a running frame and clears idempotently', async () => {
    const callbacks = new Map<number, FrameRequestCallback>();
    let serial = 0;
    const request = vi.fn((callback: FrameRequestCallback) => { callbacks.set(++serial, callback); return serial; });
    const cancel = vi.fn((id: number) => { callbacks.delete(id); });
    const controller = createTransitionController(document.createElement('div'), { request, cancel, now: () => 0 });
    const first = adapter();
    await controller.mount(() => first, image(), image());
    controller.seek(2);
    expect(first.seek).toHaveBeenLastCalledWith(1);
    controller.seek(Number.NaN);
    expect(first.seek).toHaveBeenLastCalledWith(0);
    controller.play(Number.NaN);
    controller.play(100);
    expect(callbacks.size).toBe(1);
    callbacks.get(serial)?.(100);
    expect(first.seek).toHaveBeenLastCalledWith(1);
    await controller.clear();
    await controller.clear();
    expect(first.dispose).toHaveBeenCalledOnce();
    expect(controller.snapshot().pendingFrames).toBe(0);
  });

  it('cleans failed factory containers and rejects mounting after disposal', async () => {
    const stage = document.createElement('div');
    const controller = createTransitionController(stage);
    await expect(controller.mount(() => { throw new Error('No renderer'); }, image(), image())).rejects.toThrow('No renderer');
    expect(stage.children).toHaveLength(0);
    await controller.dispose();
    await expect(controller.mount(() => adapter(), image(), image())).rejects.toThrow('disposed');
  });

  it('reports one disposal failure without permanently poisoning later mounts', async () => {
    const stage = document.createElement('div');
    const controller = createTransitionController(stage);
    await controller.mount(() => ({ seek() {}, dispose() { throw new Error('cleanup failed'); } }), image(), image());
    await expect(controller.clear()).rejects.toThrow('cleanup failed');
    const recovered = adapter();
    await expect(controller.mount(() => recovered, image(), image())).resolves.toBe(true);
    expect(controller.snapshot().activeAdapters).toBe(1);
    await controller.dispose();
  });

  it('detaches pending factory output immediately on clear and retires its late result', async () => {
    const stage = document.createElement('div');
    const controller = createTransitionController(stage);
    let finish!: (value: TransitionAdapter) => void;
    const late = adapter();
    const mounting = controller.mount(({ stage: layer }) => {
      layer.append(document.createElement('canvas'));
      return new Promise(resolve => { finish = resolve; });
    }, image(), image());
    await Promise.resolve();
    expect(stage.querySelector('canvas')).not.toBeNull();
    await controller.clear();
    expect(stage.children).toHaveLength(0);
    finish(late);
    await mounting;
    expect(late.dispose).toHaveBeenCalledOnce();
  });

  it('retains a draw failure for feedback, then clears the error when explicitly cleared', async () => {
    const controller = createTransitionController(document.createElement('div'));
    let fail = false;
    await controller.mount(() => ({ seek() { if (fail) throw new Error('context lost'); }, dispose() {} }), image(), image());
    fail = true;
    controller.seek(0.5);
    expect(controller.snapshot().error).toBe('context lost');
    expect(controller.snapshot().activeAdapters).toBe(0);
    await controller.clear();
    expect(controller.snapshot().error).toBe('');
  });

  it('does not publish a retired renderers late cleanup failure over a newer mount', async () => {
    const controller = createTransitionController(document.createElement('div'));
    let rejectCleanup!: (error: Error) => void;
    let fail = false;
    await controller.mount(() => ({
      seek() { if (fail) throw new Error('old render failed'); },
      dispose: () => new Promise<void>((_resolve, reject) => { rejectCleanup = reject; }),
    }), image(), image());
    fail = true;
    controller.seek(0.5);
    await Promise.resolve();
    const recovered = controller.mount(() => adapter(), image(), image());
    rejectCleanup(new Error('old cleanup failed'));
    await expect(recovered).resolves.toBe(true);
    expect(controller.snapshot().error).toBe('');
    await controller.dispose();
  });
});
