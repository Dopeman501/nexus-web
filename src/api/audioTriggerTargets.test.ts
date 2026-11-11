import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchService, postService } from './service';
import { fetchAudioTriggerTargets, setAudioTriggerTargets } from './audioTriggerTargets';

vi.mock('./service', () => ({ fetchService: vi.fn(), postService: vi.fn() }));
const target = { id: 'background:y70', kind: 'background', name: 'Y70 Touch', enabled: false, intensity: 50 };
const epoch = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
beforeEach(() => vi.resetAllMocks());
afterEach(() => vi.useRealTimers());

describe('Audio Trigger target boundary', () => {
  it('reads both configured target kinds and sends only narrow requested fields', async () => {
    const snapshot = { epoch, targets: [target, { ...target, id: 'lighting:fan', kind: 'lighting', name: 'Fan' }] };
    vi.mocked(fetchService).mockResolvedValue(snapshot);
    vi.mocked(postService).mockResolvedValue(snapshot);
    expect(await fetchAudioTriggerTargets()).toEqual(snapshot);
    await setAudioTriggerTargets({ targetIds: [target.id], intensity: 75 });
    expect(postService).toHaveBeenCalledWith('/audio-trigger/targets', { targetIds: [target.id], intensity: 75 }, expect.any(AbortSignal));
  });

  it.each([null, {}, { targets: null }, { targets: [{ ...target, intensity: 101 }] },
    { targets: [{ ...target, enabled: 'true' }] }, { targets: [{ ...target, kind: 'unknown' }] },
    { targets: [{ ...target, id: 'lighting:y70' }] }, { targets: [target, target] },
    { targets: Array.from({ length: 1025 }, (_, i) => ({ ...target, id: `background:${i}` })) },
  ])('rejects malformed snapshots rather than displaying fabricated controls: %j', async raw => {
    vi.mocked(fetchService).mockResolvedValue(raw && typeof raw === 'object' ? { epoch, ...raw } : raw);
    expect(await fetchAudioTriggerTargets()).toBeNull();
  });

  it('accepts an empty configured set', async () => {
    vi.mocked(fetchService).mockResolvedValue({ epoch, targets: [] });
    expect(await fetchAudioTriggerTargets()).toEqual({ epoch, targets: [] });
  });

  it.each([{}, { intensity: NaN }, { intensity: -1 }, { intensity: 101 }, { targetIds: [], enabled: true },
    { expectedEpoch: 'old', enabled: true }])('rejects invalid outgoing patches without making a request: %j', async patch => {
    expect(await setAudioTriggerTargets(patch)).toBeNull();
    expect(postService).not.toHaveBeenCalled();
  });

  it('settles a hung read on cancellation even when the transport ignores it', async () => {
    vi.mocked(fetchService).mockReturnValue(new Promise(() => {}));
    const owner = new AbortController();
    const result = fetchAudioTriggerTargets(owner.signal);
    owner.abort();
    expect(await result).toBeNull();
    expect(vi.mocked(fetchService).mock.calls[0][1]?.aborted).toBe(true);
  });

  it('times out an ambiguous save without resending it', async () => {
    vi.useFakeTimers();
    vi.mocked(postService).mockReturnValue(new Promise(() => {}));
    const result = setAudioTriggerTargets({ enabled: false });
    await vi.advanceTimersByTimeAsync(15000);
    expect(await result).toBeNull();
    expect(postService).toHaveBeenCalledTimes(1);
  });
});
