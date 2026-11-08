import { describe, expect, it } from 'vitest';
import { readAudioTriggerPreview } from './panelAudioTriggerPreview';

const frame = { deviceId: 'one', sessionId: '812c024e-efbc-4d4f-8ef2-c862c8159370', sequence: 1,
  revision: 2, expiresAtUnixMs: Date.now() + 6000, background: { mode: 'solid', color: '#ff0000' } };

describe('Audio Trigger preview boundary', () => {
  it('accepts validated snapshots and explicit releases', () => {
    expect(readAudioTriggerPreview(frame)).toMatchObject(frame);
    expect(readAudioTriggerPreview({ ...frame, background: null })?.background).toBeNull();
  });
  it.each([null, [], {}, { ...frame, sequence: -1 }, { ...frame, sequence: 1.5 },
    { ...frame, sessionId: 'bad' }, { ...frame, expiresAtUnixMs: Infinity }, { ...frame, revision: -1 },
    { ...frame, background: undefined }, { ...frame, background: { mode: 'media', mediaId: '../file' } }])('rejects malformed preview frames: %j', raw => {
    expect(readAudioTriggerPreview(raw)).toBeNull();
  });
  it('sanitizes background values before they reach CSS, effects or media', () => {
    expect(readAudioTriggerPreview({ ...frame, background: { mode: 'shader', color: 'url(file)', frost: 1e10,
      effectState: { params: { good: 4, bad: Infinity, 'invalid uniform': 1 } } } })?.background).toMatchObject({
      color: undefined, frost: 100, effectState: { params: { good: 4 } },
    });
  });
});
