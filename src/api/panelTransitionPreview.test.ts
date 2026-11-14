import { describe, expect, it } from 'vitest';
import { readTransitionPreview } from './panelTransitionPreview';
const guid = '12345678-1234-1234-1234-123456789abc';
const valid = () => ({ deviceId: 'device', sessionId: guid, sequence: 1, revision: 4,
  startedAtUnixMs: 1000, expiresAtUnixMs: 8000, preview: { previewId: guid, effect: 'curtains:wave', durationMs: 1000 } });
describe('untrusted transition-preview frames', () => {
  it('accepts owned copies of a bounded custom preview and null release', () => {
    const value = valid(); const result = readTransitionPreview(value);
    expect(result).toEqual(value); expect(result?.preview).not.toBe(value.preview);
    expect(readTransitionPreview({ ...value, preview: null })?.preview).toBeNull();
  });
  it.each([null, [], 1, { ...valid(), revision: 1.5 }, { ...valid(), sequence: -1 }, { ...valid(), deviceId: '' },
    { ...valid(), sessionId: '00000000-0000-0000-0000-000000000000' }, { ...valid(), startedAtUnixMs: Infinity },
    { ...valid(), preview: { ...valid().preview, effect: 'motion:fade' } },
    { ...valid(), preview: { ...valid().preview, effect: 'none' } },
    { ...valid(), preview: { ...valid().preview, durationMs: 5001 } },
    { ...valid(), preview: { ...valid().preview, previewId: 'wrong' } }])('rejects malformed preview %j', input => {
    expect(readTransitionPreview(input)).toBeNull();
  });
});
