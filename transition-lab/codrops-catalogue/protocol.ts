export const channel = 'nexus-codrops';

interface Envelope { channel: typeof channel; nonce: string; id: string }
export type FrameCommand = Envelope & (
  | { kind: 'init'; from: string; to: string }
  | { kind: 'seek'; progress: number }
  | { kind: 'dispose' }
);
export type FrameReply = Envelope & (
  | { kind: 'boot' | 'ready' | 'disposed' }
  | { kind: 'error'; message: string }
);

export function isEnvelope(value: unknown, nonce: string, id: string): value is Envelope & Record<string, unknown> {
  return typeof value === 'object' && value !== null
    && 'channel' in value && value.channel === channel
    && 'nonce' in value && value.nonce === nonce
    && 'id' in value && value.id === id;
}

export function isFrameCommand(value: unknown, nonce: string, id: string): value is FrameCommand {
  if (!isEnvelope(value, nonce, id)) return false;
  switch (value.kind) {
    case 'dispose': return true;
    case 'init': return typeof value.from === 'string' && typeof value.to === 'string';
    case 'seek': return typeof value.progress === 'number' && Number.isFinite(value.progress)
      && value.progress >= 0 && value.progress <= 1;
    default: return false;
  }
}

/** The sampler never fetches another origin or passes a file-system URL into a demo. */
export function localImageUrl(value: string, origin: string): string {
  if (/^data:image\/(?:svg\+xml|png|jpeg|webp|gif|avif)[;,]/i.test(value)) return value;
  const url = new URL(value, origin);
  if (url.origin !== origin || !['http:', 'https:', 'blob:'].includes(url.protocol)) {
    throw new Error('Codrops preview images must be local to this sampler.');
  }
  return url.href;
}
