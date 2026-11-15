import { beforeEach, describe, expect, it, vi } from 'vitest';

const svc = vi.hoisted(() => ({
  fetchService: vi.fn(),
  putService: vi.fn(),
  postService: vi.fn(),
}));
vi.mock('./service', () => svc);

import {
  DEFAULT_KEY_REACTION,
  fetchKeyReactionPreview,
  fetchKeyReactive,
  pressKeyReaction,
  putKeyReaction,
} from './keyReactive';

describe('key reactive api', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    svc.fetchService.mockResolvedValue(null);
    svc.putService.mockResolvedValue(null);
    svc.postService.mockResolvedValue(null);
  });

  it('lists the per-key keyboards with a GET', async () => {
    await fetchKeyReactive();
    expect(svc.fetchService).toHaveBeenCalledWith('/lighting/key-reactive');
  });

  it('saves a config with a PUT to the encoded device id', async () => {
    await putKeyReaction('hyte keeb/1', DEFAULT_KEY_REACTION);
    expect(svc.putService).toHaveBeenCalledWith('/lighting/key-reactive/hyte%20keeb%2F1', DEFAULT_KEY_REACTION);
  });

  it('posts a press body as given', async () => {
    await pressKeyReaction('k1', { led: 4 });
    expect(svc.postService).toHaveBeenCalledWith('/lighting/key-reactive/k1/press', { led: 4 });
    await pressKeyReaction('k1', {});
    expect(svc.postService).toHaveBeenLastCalledWith('/lighting/key-reactive/k1/press', {});
  });

  it('posts the config to preview and forwards the abort signal', async () => {
    const ctl = new AbortController();
    await fetchKeyReactionPreview('k1', DEFAULT_KEY_REACTION, ctl.signal);
    expect(svc.postService).toHaveBeenCalledWith('/lighting/key-reactive/k1/preview', DEFAULT_KEY_REACTION, ctl.signal);
  });

  it('preserves ordered custom colours in saves and preview requests', async () => {
    const config = { ...DEFAULT_KEY_REACTION, color: '#000000', colors: ['#000000', '#123456', '#ffffff'] };
    await putKeyReaction('core', config);
    expect(svc.putService).toHaveBeenCalledWith('/lighting/key-reactive/core', config);
    await fetchKeyReactionPreview('core', config);
    expect(svc.postService).toHaveBeenCalledWith('/lighting/key-reactive/core/preview', config, undefined);
  });

  it('binds scoped writes, previews and presses to the captured profile epoch and abort signal', async () => {
    const epoch = 'a'.repeat(32);
    const ctl = new AbortController();
    await putKeyReaction('core/1', DEFAULT_KEY_REACTION, epoch, ctl.signal);
    expect(svc.putService).toHaveBeenCalledWith(`/lighting/key-reactive/core%2F1?expectedEpoch=${epoch}`, DEFAULT_KEY_REACTION, ctl.signal);
    await fetchKeyReactionPreview('core/1', DEFAULT_KEY_REACTION, ctl.signal, epoch);
    expect(svc.postService).toHaveBeenCalledWith(`/lighting/key-reactive/core%2F1/preview?expectedEpoch=${epoch}`, DEFAULT_KEY_REACTION, ctl.signal);
    await pressKeyReaction('core/1', { led: 9 }, epoch, ctl.signal);
    expect(svc.postService).toHaveBeenLastCalledWith(`/lighting/key-reactive/core%2F1/press?expectedEpoch=${epoch}`, { led: 9 }, ctl.signal);
  });

  it('guards card-local saves, presses and previews with the captured layout projection', async () => {
    const epoch = 'a'.repeat(32), revision = 'c1:89:000';
    const ctl = new AbortController();
    await putKeyReaction('core', DEFAULT_KEY_REACTION, epoch, ctl.signal, revision);
    expect(svc.putService).toHaveBeenCalledWith(`/lighting/key-reactive/core?expectedEpoch=${epoch}&expectedLayoutRevision=c1%3A89%3A000`, DEFAULT_KEY_REACTION, ctl.signal);
    await fetchKeyReactionPreview('core', DEFAULT_KEY_REACTION, ctl.signal, epoch, revision);
    expect(svc.postService).toHaveBeenCalledWith(`/lighting/key-reactive/core/preview?expectedEpoch=${epoch}&expectedLayoutRevision=c1%3A89%3A000`, DEFAULT_KEY_REACTION, ctl.signal);
    await pressKeyReaction('core', { led: 1 }, epoch, ctl.signal, revision);
    expect(svc.postService).toHaveBeenLastCalledWith(`/lighting/key-reactive/core/press?expectedEpoch=${epoch}&expectedLayoutRevision=c1%3A89%3A000`, { led: 1 }, ctl.signal);
  });
});
