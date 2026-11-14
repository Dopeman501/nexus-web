import { fetchService, postService } from './service';
import { isPictureTransitionEffect } from '../panel/background/transitions/catalogue';

export const BACKGROUND_TRANSITION_PREVIEW_TOPIC = 'panel/transition-preview';
export const BACKGROUND_TRANSITION_PREVIEW_MAX_LEASE_MS = 12_000;
export interface TransitionPreviewSelection { previewId: string; effect: string; durationMs: number }
export interface TransitionPreviewRequest { sessionId: string; sequence: number; preview: TransitionPreviewSelection | null }
export interface TransitionPreviewFrame extends TransitionPreviewRequest {
  deviceId: string; revision: number; startedAtUnixMs: number; expiresAtUnixMs: number;
}
const guid = (value: unknown): value is string => typeof value === 'string'
  && /^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i.test(value) && value !== '00000000-0000-0000-0000-000000000000';
const integer = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
export function readTransitionPreview(raw: unknown): TransitionPreviewFrame | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  if (typeof value.deviceId !== 'string' || !value.deviceId || value.deviceId.length > 256 || !guid(value.sessionId)
    || !integer(value.sequence) || !integer(value.revision) || !integer(value.startedAtUnixMs) || !integer(value.expiresAtUnixMs)) return null;
  let preview: TransitionPreviewSelection | null = null;
  if (value.preview !== null) {
    if (!value.preview || typeof value.preview !== 'object' || Array.isArray(value.preview)) return null;
    const candidate = value.preview as Record<string, unknown>;
    if (!guid(candidate.previewId) || !isPictureTransitionEffect(candidate.effect) || !integer(candidate.durationMs)
      || candidate.durationMs < 80 || candidate.durationMs > 5000) return null;
    preview = { previewId: candidate.previewId, effect: candidate.effect, durationMs: candidate.durationMs };
  }
  return { deviceId: value.deviceId, sessionId: value.sessionId, sequence: value.sequence, preview,
    revision: value.revision, startedAtUnixMs: value.startedAtUnixMs, expiresAtUnixMs: value.expiresAtUnixMs };
}
const path = (id: string) => `/panel/devices/${encodeURIComponent(id)}/transition-preview`;
export const fetchTransitionPreview = (id: string, signal?: AbortSignal) => fetchService<unknown>(path(id), signal);
export const postTransitionPreview = (id: string, body: TransitionPreviewRequest, signal?: AbortSignal) => postService<unknown>(path(id), body, signal);
