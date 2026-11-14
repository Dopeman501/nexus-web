import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCodropsCatalogueAdapter } from '../codrops-catalogue/adapter';

function decodedImage(name: string) {
  const image = document.createElement('img');
  image.src = `/${name}.svg`;
  Object.defineProperties(image, { naturalWidth: { value: 1680 }, naturalHeight: { value: 756 } });
  return image;
}
function mount(signal?: AbortSignal) {
  const stage = document.createElement('div');
  document.body.append(stage);
  const startup = createCodropsCatalogueAdapter('codrops-01')({
    stage, from: decodedImage('dawn'), to: decodedImage('night'), signal,
  });
  const frame = stage.querySelector('iframe')!;
  const parameters = new URLSearchParams(new URL(frame.src).hash.slice(1));
  const envelope = { channel: 'nexus-codrops', id: 'codrops-01', nonce: parameters.get('nonce') };
  const send = (kind: string, extra: object = {}, source: MessageEventSource | null = frame.contentWindow,
    origin = window.location.origin) => window.dispatchEvent(new MessageEvent('message', {
    source, origin, data: { ...envelope, kind, ...extra },
  }));
  return { stage, startup, frame, send, envelope };
}

afterEach(() => { document.body.replaceChildren(); vi.useRealTimers(); });

describe('Codrops frame adapter lifecycle', () => {
  it('rejects cancelled, undecoded or nonlocal inputs before allocating an iframe', async () => {
    const stage = document.createElement('div');
    const factory = createCodropsCatalogueAdapter('codrops-01');
    const controller = new AbortController();
    controller.abort();
    await expect(factory({ stage, from: decodedImage('a'), to: decodedImage('b'), signal: controller.signal }))
      .rejects.toMatchObject({ name: 'AbortError' });
    await expect(factory({ stage, from: document.createElement('img'), to: decodedImage('b') })).rejects.toThrow(/decoded/);
    const external = decodedImage('a');
    external.src = 'https://example.com/remote.png';
    await expect(factory({ stage, from: external, to: decodedImage('b') })).rejects.toThrow(/local/);
    expect(stage.childElementCount).toBe(0);
  });

  it('waits for its own frame/session, clamps seek, and removes the entire stage on acknowledged disposal', async () => {
    const { stage, startup, frame, send, envelope } = mount();
    const post = vi.spyOn(frame.contentWindow!, 'postMessage');
    let mounted = false;
    void Promise.resolve(startup).then(() => { mounted = true; });
    send('ready', {}, window);
    send('ready', {}, frame.contentWindow, 'https://example.com');
    send('ready', { nonce: 'different-session' });
    await Promise.resolve();
    expect(mounted).toBe(false);
    send('boot');
    expect(post).toHaveBeenCalledWith({ ...envelope, kind: 'init',
      from: `${window.location.origin}/dawn.svg`, to: `${window.location.origin}/night.svg` }, window.location.origin);
    send('ready');
    const adapter = await startup;
    adapter.seek(0.4);
    expect(post).toHaveBeenLastCalledWith({ ...envelope, kind: 'seek', progress: 0.4 }, window.location.origin);
    expect([...stage.querySelectorAll('img')].every(image => image.hidden)).toBe(true);
    adapter.seek(Infinity);
    expect(stage.querySelectorAll('img')[0].hidden).toBe(false);
    expect(frame.style.visibility).toBe('hidden');
    adapter.seek(2);
    expect(stage.querySelectorAll('img')[1].hidden).toBe(false);
    const disposal = adapter.dispose();
    expect(post).toHaveBeenLastCalledWith({ ...envelope, kind: 'dispose' }, window.location.origin);
    send('disposed');
    await disposal;
    await adapter.dispose();
    expect(stage.childElementCount).toBe(0);
  });

  it('cancels an unfinished mount and ignores a late ready callback', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const { startup, stage, send } = mount(controller.signal);
    const cancelled = expect(startup).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    send('ready');
    await vi.advanceTimersByTimeAsync(300);
    await cancelled;
    expect(stage.childElementCount).toBe(0);
  });

  it('registers pending retirement and leaves the realm connected until cleanup acknowledgement', async () => {
    const stage = document.createElement('div');
    document.body.append(stage);
    let retire: (() => Promise<void>) | undefined;
    const startup = createCodropsCatalogueAdapter('codrops-01')({
      stage, from: decodedImage('dawn'), to: decodedImage('night'), onPendingDispose: dispose => { retire = dispose; },
    });
    const frame = stage.querySelector('iframe')!;
    const parameters = new URLSearchParams(new URL(frame.src).hash.slice(1));
    const cancelled = expect(startup).rejects.toMatchObject({ name: 'AbortError' });
    const retirement = retire!();
    expect(frame.isConnected).toBe(true);
    window.dispatchEvent(new MessageEvent('message', { source: frame.contentWindow, origin: window.location.origin,
      data: { channel: 'nexus-codrops', nonce: parameters.get('nonce'), id: 'codrops-01', kind: 'disposed' } }));
    await retirement;
    await cancelled;
    expect(frame.isConnected).toBe(false);
  });

  it('bounds startup and releases a frame that never acknowledges disposal', async () => {
    vi.useFakeTimers();
    const { startup, stage } = mount();
    const timedOut = expect(startup).rejects.toThrow(/took too long/);
    await vi.advanceTimersByTimeAsync(30_300);
    await timedOut;
    expect(stage.childElementCount).toBe(0);
  });

  it('reports genuine initialization failure and bounds the error text', async () => {
    vi.useFakeTimers();
    const { startup, stage, send } = mount();
    const failed = expect(startup).rejects.toThrow('GPU unavailable');
    send('error', { message: 'GPU unavailable' });
    await vi.advanceTimersByTimeAsync(300);
    await failed;
    expect(stage.childElementCount).toBe(0);
  });

  it('surfaces a late frame failure on playback, then disposes once', async () => {
    const { startup, stage, send } = mount();
    send('ready');
    const adapter = await startup;
    send('error', { message: `GPU lost: ${'x'.repeat(1000)}` });
    expect(() => adapter.seek(0.5)).toThrow(/^GPU lost:/);
    try { adapter.seek(0.7); } catch (error) { expect((error as Error).message).toHaveLength(400); }
    const retirement = adapter.dispose();
    send('disposed');
    await retirement;
    expect(() => adapter.seek(0.5)).not.toThrow();
    expect(stage.childElementCount).toBe(0);
  });
});
