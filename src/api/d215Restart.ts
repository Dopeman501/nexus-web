import { postService } from './service';

export interface D215RestartResult {
  status: 'restarted' | 'busy' | 'unavailable' | 'failed' | 'uncertain';
}

// Leave room for the service's bounded restart and re-identification result.
const RESTART_TIMEOUT_MS = 40_000;

function parseResult(body: unknown): D215RestartResult {
  if (body && typeof body === 'object' && 'status' in body) {
    switch (body.status) {
      case 'restarted':
      case 'busy':
      case 'unavailable':
      case 'failed':
      case 'uncertain':
        return { status: body.status };
    }
  }
  // A lost reply cannot tell us whether the screen received the restart.
  return { status: 'uncertain' };
}

export async function restartD215Screen(recordId: string, signal?: AbortSignal): Promise<D215RestartResult> {
  if (!recordId || signal?.aborted) return { status: 'unavailable' };
  const request = new AbortController();
  const cancel = () => request.abort();
  signal?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(cancel, RESTART_TIMEOUT_MS);
  let finishCancellation!: () => void;
  const cancelled = new Promise<D215RestartResult>(resolve => {
    finishCancellation = () => resolve({ status: 'uncertain' });
    request.signal.addEventListener('abort', finishCancellation, { once: true });
  });
  try {
    const response = postService<unknown>(`/panel/devices/${encodeURIComponent(recordId)}/d215-restart`, {}, request.signal)
      .catch(() => null).then(parseResult);
    return await Promise.race([response, cancelled]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
    request.signal.removeEventListener('abort', finishCancellation);
  }
}
