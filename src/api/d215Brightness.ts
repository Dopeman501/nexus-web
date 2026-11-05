import { fetchService, postService } from './service';

export const D215_BRIGHTNESS_PRESETS = [20, 40, 60, 80, 100] as const;
export type D215BrightnessPreset = typeof D215_BRIGHTNESS_PRESETS[number];
export interface D215BrightnessResult {
  status: 'confirmed' | 'unavailable' | 'busy' | 'mismatch' | 'failed';
  value: number | null;
}

// The service has 22 seconds to produce a terminal result. Allow its reply to
// arrive before the desktop request times out.
const WRITE_TIMEOUT_MS = 25_000;

function brightnessPath(recordId: string): string {
  return `/panel/devices/${encodeURIComponent(recordId)}/d215-brightness`;
}

function parseBrightness(body: unknown): D215BrightnessResult | null {
  if (!body || typeof body !== 'object' || !('status' in body) || !('value' in body)) return null;
  const { status, value } = body;
  if (value !== null && (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 100)) {
    return null;
  }
  switch (status) {
    case 'confirmed':
    case 'unavailable':
    case 'busy':
    case 'mismatch':
    case 'failed':
      return { status, value };
    default:
      return null;
  }
}

async function readResult(response: Promise<unknown>, failure: 'unavailable' | 'failed'): Promise<D215BrightnessResult> {
  return parseBrightness(await response.catch(() => null)) ?? { status: failure, value: null };
}

export function fetchD215Brightness(recordId: string, signal: AbortSignal): Promise<D215BrightnessResult> {
  return readResult(fetchService<unknown>(brightnessPath(recordId), signal), 'unavailable');
}

export async function setD215Brightness(recordId: string, value: D215BrightnessPreset): Promise<D215BrightnessResult> {
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), WRITE_TIMEOUT_MS);
  try {
    return await readResult(postService<unknown>(brightnessPath(recordId), { value }, deadline.signal), 'failed');
  } finally {
    clearTimeout(timer);
  }
}
