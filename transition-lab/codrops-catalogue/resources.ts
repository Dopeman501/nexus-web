/** A disposable browser realm for upstream demos that were authored as standalone pages. */
export function ownFrameResources() {
  let disposed = false;
  const timeouts = new Set<number>();
  const frames = new Set<number>();
  const workers = new Set<Worker>();
  const listeners: [string, EventListenerOrEventListenerObject, boolean | AddEventListenerOptions | undefined][] = [];
  const nativeTimeout = window.setTimeout.bind(window);
  const nativeClearTimeout = window.clearTimeout.bind(window);
  const nativeFrame = window.requestAnimationFrame.bind(window);
  const nativeCancelFrame = window.cancelAnimationFrame.bind(window);
  const nativeAdd = window.addEventListener.bind(window);
  const nativeRemove = window.removeEventListener.bind(window);
  const NativeWorker = window.Worker;

  window.setTimeout = ((handler: TimerHandler, delay?: number, ...args: unknown[]) => {
    if (disposed) return 0;
    if (typeof handler !== 'function') throw new Error('Codrops preview only permits function timers.');
    const id = nativeTimeout(() => {
      timeouts.delete(id);
      if (!disposed) handler(...args);
    }, delay);
    timeouts.add(id);
    return id;
  }) as typeof window.setTimeout;
  window.clearTimeout = ((id?: number) => {
    if (id !== undefined) timeouts.delete(id);
    nativeClearTimeout(id);
  }) as typeof window.clearTimeout;
  window.requestAnimationFrame = callback => {
    if (disposed) return 0;
    const id = nativeFrame(now => { frames.delete(id); if (!disposed) callback(now); });
    frames.add(id);
    return id;
  };
  window.cancelAnimationFrame = id => { frames.delete(id); nativeCancelFrame(id); };
  window.addEventListener = ((type: string, listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions) => {
    if (disposed) return;
    listeners.push([type, listener, options]);
    nativeAdd(type, listener, options);
  }) as typeof window.addEventListener;
  if (NativeWorker) {
    window.Worker = class extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        if (disposed) throw new DOMException('Codrops preview retired.', 'AbortError');
        super(url, options);
        workers.add(this);
      }
      override terminate() { workers.delete(this); super.terminate(); }
    };
  }

  return {
    get disposed() { return disposed; },
    dispose() {
      if (disposed) return;
      disposed = true;
      timeouts.forEach(id => nativeClearTimeout(id));
      frames.forEach(id => nativeCancelFrame(id));
      workers.forEach(worker => worker.terminate());
      listeners.forEach(([type, listener, options]) => nativeRemove(type, listener, options));
      timeouts.clear(); frames.clear(); workers.clear(); listeners.length = 0;
      // Keep the retired realm guarded until its parent removes the iframe. An upstream
      // renderer.init() promise can settle later and attempt to add another listener/timer.
    },
  };
}
