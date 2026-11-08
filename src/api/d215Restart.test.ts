import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { postService } from './service';
import { restartD215Screen } from './d215Restart';

vi.mock('./service', () => ({ postService: vi.fn() }));

beforeEach(() => { vi.mocked(postService).mockReset(); });
afterEach(() => { vi.useRealTimers(); });

describe('D215 screen restart API', () => {
  it.each(['restarted', 'busy', 'unavailable', 'failed', 'uncertain'] as const)('accepts the service %s result without retrying', async status => {
    vi.mocked(postService).mockResolvedValue({ status });
    expect(await restartD215Screen('screen / one')).toEqual({ status });
    expect(postService).toHaveBeenCalledExactlyOnceWith('/panel/devices/screen%20%2F%20one/d215-restart', {}, expect.any(AbortSignal));
  });

  it.each([null, {}, { status: 'ok' }, { status: 1 }, 'restarted'])('treats malformed or missing responses as an uncertain restart', async response => {
    vi.mocked(postService).mockResolvedValue(response);
    expect(await restartD215Screen('one')).toEqual({ status: 'uncertain' });
    expect(postService).toHaveBeenCalledTimes(1);
  });

  it('does not retry when the connection fails after dispatch', async () => {
    vi.mocked(postService).mockRejectedValue(new Error('offline'));
    expect(await restartD215Screen('one')).toEqual({ status: 'uncertain' });
    expect(postService).toHaveBeenCalledTimes(1);
  });

  it('bounds the wait to 40 seconds even if the underlying request does not settle', async () => {
    vi.useFakeTimers();
    vi.mocked(postService).mockReturnValue(new Promise(() => {}));
    const result = restartD215Screen('one');
    const signal = vi.mocked(postService).mock.calls[0][2]!;
    await vi.advanceTimersByTimeAsync(40_000);
    expect(await result).toEqual({ status: 'uncertain' });
    expect(signal.aborted).toBe(true);
    expect(postService).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('stops waiting on owner cancellation and never sends an already-cancelled request', async () => {
    const owner = new AbortController();
    vi.mocked(postService).mockReturnValue(new Promise(() => {}));
    const result = restartD215Screen('one', owner.signal);
    owner.abort();
    expect(await result).toEqual({ status: 'uncertain' });
    expect(vi.mocked(postService).mock.calls[0][2]!.aborted).toBe(true);
    expect(await restartD215Screen('one', owner.signal)).toEqual({ status: 'unavailable' });
    expect(postService).toHaveBeenCalledTimes(1);
  });
});
