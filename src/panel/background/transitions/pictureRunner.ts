import { createFramePacer, pageFrameCap } from '../../../lib/framePacer';
import { clampProgress } from './engine';
import type { AdapterFactory, TransitionAdapter } from './engine';
import { loadPictureTransitionFactory } from './engineLoader';
import { isPictureTransitionEffect } from './catalogue';
import { normalizeBackgroundTransition } from './settings';
import type { BackgroundTransitionSettings } from './settings';
import { sourceDimensions, type PictureSource } from './source';

export interface PictureTransitionRequest {
  from: PictureSource;
  to: PictureSource;
  settings: BackgroundTransitionSettings;
  onComplete(): void;
  onFailed?(message: string): void;
}
interface Runtime {
  loadFactory(effect: string): Promise<AdapterFactory>;
  now(): number;
  requestFrame(callback: FrameRequestCallback): number;
  cancelFrame(id: number): void;
  frameCap(): number | null;
}
interface Run {
  request: PictureTransitionRequest;
  layer: HTMLDivElement;
  abort: AbortController;
  live(): boolean;
  adapter?: TransitionAdapter;
  creating?: Promise<TransitionAdapter>;
  cleanup?: Promise<void>;
  frame: number;
  deadline?: ReturnType<typeof setTimeout>;
  stopped: boolean;
  terminal?: 'complete' | 'failed';
}
const runtimeDefaults: Runtime = {
  loadFactory: loadPictureTransitionFactory,
  now: () => performance.now(), requestFrame: (callback) => requestAnimationFrame(callback),
  cancelFrame: (id) => cancelAnimationFrame(id), frameCap: () => pageFrameCap(window.location.search),
};
const messageOf = (error: unknown) => error instanceof Error ? error.message : String(error);
const warnCleanup = (error: unknown) => console.warn('Picture transition cleanup failed.', error);
// React may replace the whole component between beats. A new owner must await
// previous owners' pending factory/disposal acknowledgements before allocating.
let pageRetirement: Promise<void> = Promise.resolve();
async function awaitPageRetirement() {
  let observed: Promise<void>;
  do { observed = pageRetirement; await observed; } while (observed !== pageRetirement);
}

function untilAborted<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const aborted = () => { signal.removeEventListener('abort', aborted); reject(signal.reason); };
    if (signal.aborted) { aborted(); return; }
    signal.addEventListener('abort', aborted, { once: true });
    operation.then((value) => {
      signal.removeEventListener('abort', aborted); resolve(value);
    }, (error) => { signal.removeEventListener('abort', aborted); reject(error); });
  });
}
function stop(run: Run, runtime: Runtime) {
  run.stopped = true;
  run.abort.abort(new Error('Picture transition superseded.'));
  if (run.frame) runtime.cancelFrame(run.frame);
  run.frame = 0;
  clearTimeout(run.deadline);
  run.layer.style.visibility = 'hidden';
}
function retire(run: Run, runtime: Runtime): Promise<void> {
  if (run.cleanup) return run.cleanup;
  stop(run, runtime);
  run.cleanup = (async () => {
    try {
      // A canceled asynchronous factory still owns its resources until it settles.
      // Selected factories honor abort and bound their own GPU readiness wait.
      if (!run.adapter && run.creating) {
        try { run.adapter = await run.creating; } catch { /* setup error is reported by its owner */ }
      }
      await run.adapter?.dispose();
    } finally { run.layer.remove(); }
  })();
  // Keep the page gate recoverable; the caller still receives and reports the
  // original cleanup error, so this shared acknowledgement does not log twice.
  pageRetirement = Promise.all([pageRetirement, run.cleanup]).then(() => {}, () => {});
  return run.cleanup;
}
function notify(run: Run, kind: 'complete' | 'failed', error?: unknown) {
  if (!run.live() || run.terminal) return;
  run.terminal = kind;
  try {
    if (kind === 'complete') run.request.onComplete();
    else run.request.onFailed?.(messageOf(error));
  } catch (failure) { console.warn('Picture transition callback failed.', failure); }
}
async function prepare(run: Run, runtime: Runtime) {
  const signal = run.abort.signal;
  run.deadline = setTimeout(() => run.abort.abort(new Error('Picture transition setup timed out.')), 4000);
  const decode = async (source: PictureSource) => {
    if (source instanceof HTMLImageElement && (!source.naturalWidth || !source.naturalHeight)) await source.decode();
    sourceDimensions(source);
  };
  await untilAborted(Promise.all([decode(run.request.from), decode(run.request.to)]), signal);
  const factory = await untilAborted(runtime.loadFactory(run.request.settings.effect), signal);
  if (!run.live() || signal.aborted) throw signal.reason;
  run.creating = Promise.resolve(factory({
    stage: run.layer, from: run.request.from, to: run.request.to, signal,
  }));
  run.adapter = await untilAborted(run.creating, signal);
  clearTimeout(run.deadline);
}
function play(run: Run, runtime: Runtime) {
  const start = runtime.now();
  let cap = runtime.frameCap();
  let due = createFramePacer(cap);
  run.adapter!.seek(0);
  const tick: FrameRequestCallback = (now) => {
    run.frame = 0;
    if (!run.live() || run.stopped) return;
    try {
      const currentCap = runtime.frameCap();
      if (currentCap !== cap) { cap = currentCap; due = createFramePacer(cap); }
      const progress = clampProgress((now - start) / run.request.settings.durationMs);
      if (progress === 1 || due(now)) run.adapter!.seek(progress);
      if (progress === 1) {
        notify(run, 'complete');
        void retire(run, runtime).catch(warnCleanup);
      } else run.frame = runtime.requestFrame(tick);
    } catch (error) {
      notify(run, 'failed', error);
      void retire(run, runtime).catch(warnCleanup);
    }
  };
  run.frame = runtime.requestFrame(tick);
}

/** One current renderer and one replaceable intent; no FIFO of audio attacks. */
export function createPictureTransitionRunner(stage: HTMLElement, overrides: Partial<Runtime> = {}) {
  const runtime = { ...runtimeDefaults, ...overrides };
  let generation = 0;
  let active: Run | null = null;
  let pending: { request: PictureTransitionRequest; epoch: number; resolve(value: boolean): void } | null = null;
  let draining: Promise<void> | null = null;
  const drain = async () => {
    while (pending) {
      const intent = pending;
      pending = null;
      if (active) {
        try { await retire(active, runtime); } catch (error) { warnCleanup(error); }
        active = null;
      }
      await awaitPageRetirement();
      if (intent.epoch !== generation) { intent.resolve(false); continue; }
      const layer = document.createElement('div');
      layer.style.cssText = 'position:absolute;inset:0;overflow:hidden;pointer-events:none';
      const run: Run = {
        request: intent.request, layer, abort: new AbortController(), frame: 0, stopped: false,
        live: () => intent.epoch === generation,
      };
      active = run;
      stage.append(layer);
      try {
        if (!isPictureTransitionEffect(run.request.settings.effect)) {
          notify(run, 'complete');
          await retire(run, runtime);
        } else {
          await prepare(run, runtime);
          if (!run.live()) { await retire(run, runtime); intent.resolve(false); continue; }
          play(run, runtime);
        }
        intent.resolve(true);
      } catch (error) {
        notify(run, 'failed', error);
        try { await retire(run, runtime); } catch (cleanup) { warnCleanup(cleanup); }
        intent.resolve(false);
      }
    }
  };
  const ensureDrain = () => {
    if (draining) return;
    draining = drain().finally(() => { draining = null; if (pending) ensureDrain(); });
  };
  return {
    replace(request: PictureTransitionRequest): Promise<boolean> {
      const epoch = ++generation;
      pending?.resolve(false);
      if (active) stop(active, runtime);
      const result = new Promise<boolean>((resolve) => {
        pending = { request: { ...request, settings: normalizeBackgroundTransition(request.settings) }, epoch, resolve };
      });
      ensureDrain();
      return result;
    },
    async cancel() {
      generation++;
      pending?.resolve(false);
      pending = null;
      const previous = active;
      // Register retirement before returning so another component's layout
      // effect cannot start allocation ahead of this owner's acknowledgement.
      const retiring = previous ? retire(previous, runtime) : null;
      if (draining) await draining;
      if (previous) {
        try { await retiring; } catch (error) { warnCleanup(error); }
        if (active === previous) active = null;
      }
    },
  };
}
