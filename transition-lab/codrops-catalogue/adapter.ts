import { clampProgress } from '../adapter';
import type { AdapterFactory, TransitionAdapter } from '../adapter';
import { codropsOptions } from './catalogue';
import { channel, isEnvelope, localImageUrl } from './protocol';

const startupTimeoutMs = 30_000;
const disposalTimeoutMs = 300;

export function createCodropsCatalogueAdapter(id: string): AdapterFactory {
  const option = codropsOptions.find(effect => effect.id === id);
  if (!option) throw new Error(`Unknown Codrops transition: ${id}`);
  return async ({ stage, from, to, signal, onPendingDispose }) => {
    if (signal?.aborted) throw new DOMException('Codrops preview cancelled.', 'AbortError');
    if ([from, to].some(image => !image.naturalWidth || !image.naturalHeight)) {
      throw new Error('Transition images must be decoded before creating a Codrops sample.');
    }
    const origin = window.location.origin;
    const sources = [from, to].map(image => localImageUrl(image.currentSrc || image.src, origin));
    const nonce = crypto.randomUUID();
    const frame = document.createElement('iframe');
    frame.title = `Original Codrops ${option.label} transition`;
    frame.setAttribute('sandbox', 'allow-scripts allow-same-origin');
    frame.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;border:0;pointer-events:none';
    const url = new URL('./codrops-catalogue/frame.html', document.baseURI);
    url.hash = new URLSearchParams({ id, nonce }).toString();
    frame.src = url.href;
    const endpoints = [from, to].map(source => {
      const image = source.cloneNode(false) as HTMLImageElement;
      image.alt = '';
      image.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;pointer-events:none';
      return image;
    });
    let disposed = false;
    let ready = false;
    let failure: Error | undefined;
    let resolveReady: (adapter: TransitionAdapter) => void;
    let rejectReady: (error: Error) => void;
    let disposal: Promise<void> | undefined;
    let acknowledgeDisposal: (() => void) | undefined;
    const startup = new Promise<TransitionAdapter>((resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    });
    const send = (command: Record<string, unknown>) => {
      frame.contentWindow?.postMessage({ channel, nonce, id, ...command }, origin);
    };
    const cleanup = () => {
      window.removeEventListener('message', onMessage);
      signal?.removeEventListener('abort', onAbort);
      frame.removeEventListener('error', onFrameError);
      frame.remove();
      endpoints.forEach(image => image.remove());
    };
    const dispose = (): Promise<void> => {
      if (disposal) return disposal;
      disposed = true;
      window.clearTimeout(startupTimer);
      disposal = new Promise<void>(resolve => {
        const finish = () => {
          window.clearTimeout(timeout);
          cleanup();
          resolve();
          if (!ready) rejectReady(failure ?? new DOMException('Codrops preview cancelled.', 'AbortError'));
        };
        const timeout = window.setTimeout(finish, disposalTimeoutMs);
        acknowledgeDisposal = finish;
        send({ kind: 'dispose' });
      });
      return disposal;
    };
    const fail = (error: Error) => {
      if (disposed) return;
      failure = error;
      if (!ready) void dispose();
    };
    const adapter: TransitionAdapter = {
      seek(progress) {
        if (disposed) return;
        if (failure) throw failure;
        const value = clampProgress(progress);
        endpoints[0].hidden = value !== 0;
        endpoints[1].hidden = value !== 1;
        frame.style.visibility = value === 0 || value === 1 ? 'hidden' : 'visible';
        send({ kind: 'seek', progress: value });
      },
      dispose,
    };
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frame.contentWindow || event.origin !== origin
        || !isEnvelope(event.data, nonce, id)) return;
      if (event.data.kind === 'disposed') { acknowledgeDisposal?.(); return; }
      if (disposed) return;
      switch (event.data.kind) {
        case 'boot': send({ kind: 'init', from: sources[0], to: sources[1] }); break;
        case 'ready':
          if (ready) return;
          ready = true;
          window.clearTimeout(startupTimer);
          adapter.seek(0);
          resolveReady(adapter);
          break;
        case 'error':
          fail(new Error(typeof event.data.message === 'string'
            ? event.data.message.slice(0, 400) : 'Codrops preview failed.'));
          break;
      }
    };
    const onAbort = () => { void dispose(); };
    const onFrameError = () => fail(new Error('The local Codrops preview could not load.'));
    const startupTimer = window.setTimeout(() => fail(new Error('Codrops preview took too long to become ready.')), startupTimeoutMs);
    window.addEventListener('message', onMessage);
    signal?.addEventListener('abort', onAbort, { once: true });
    frame.addEventListener('error', onFrameError);
    onPendingDispose?.(dispose);
    endpoints[1].hidden = true;
    stage.append(frame, ...endpoints);
    return startup;
  };
}
