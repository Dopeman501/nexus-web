import { fetchService, postService } from './service';
import { readD215PanelBackground, type D215PanelBackground } from '../panel/d215/d215PanelBackground';

export const AUDIO_TRIGGER_PREVIEW_TOPIC = 'panel/audio-trigger-preview';
export const AUDIO_TRIGGER_PREVIEW_LEASE_MS = 6000;

export interface AudioTriggerPreviewRequest {
  sessionId: string;
  sequence: number;
  background: D215PanelBackground | null;
}

export interface AudioTriggerPreviewFrame extends AudioTriggerPreviewRequest {
  deviceId: string;
  expiresAtUnixMs: number;
  revision: number;
}

const path = (id: string) => `/panel/devices/${encodeURIComponent(id)}/audio-trigger-preview`;
export const fetchAudioTriggerPreview = (id: string, signal?: AbortSignal) => fetchService<unknown>(path(id), signal);
export const postAudioTriggerPreview = (id: string, body: AudioTriggerPreviewRequest, signal?: AbortSignal) => postService<unknown>(path(id), body, signal);

/** Preview pushes are untrusted input, just like imported background snapshots. */
export function readAudioTriggerPreview(raw: unknown): AudioTriggerPreviewFrame | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  if (typeof value.deviceId !== 'string' || !value.deviceId || value.deviceId.length > 256
    || typeof value.sessionId !== 'string' || !/^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i.test(value.sessionId)
    || !Number.isSafeInteger(value.sequence) || (value.sequence as number) < 0
    || !Number.isSafeInteger(value.revision) || (value.revision as number) < 0
    || !Number.isSafeInteger(value.expiresAtUnixMs)) return null;
  const background = value.background === null ? null : readD215PanelBackground(value.background);
  if (background === undefined || (background?.mode === 'media' && (!background.mediaId || !background.mediaType))) return null;
  return { deviceId: value.deviceId, sessionId: value.sessionId, sequence: value.sequence as number,
    revision: value.revision as number, expiresAtUnixMs: value.expiresAtUnixMs as number, background };
}
