import { describe, expect, it } from 'vitest';
import { validateVideoFixtureProbe } from './backgroundVideoFixtures';

const mp4 = { id: 'mp4-a', ext: 'mp4', seconds: 8, hue: 0 } as const;
const probe = { streams: [{ codec_name: 'h264', profile: 'Main', level: 30, pix_fmt: 'yuv420p',
  width: 320, height: 144, r_frame_rate: '15/1' }], format: { duration: '8.000000' } };

describe('synthetic video fixture acceptance boundary', () => {
  it('accepts the pinned MP4 encoding and the corresponding VP8 WebM', () => {
    expect(() => validateVideoFixtureProbe(probe, mp4)).not.toThrow();
    expect(() => validateVideoFixtureProbe({ ...probe, streams: [{ ...probe.streams[0], codec_name: 'vp8' }] },
      { ...mp4, ext: 'webm' })).not.toThrow();
  });
  it.each([
    { codec_name: 'hevc' }, { profile: 'High' }, { level: 31 }, { pix_fmt: 'yuv444p' },
    { width: 640 }, { height: 288 }, { r_frame_rate: '30/1' },
  ])('rejects a changed encoding contract %j', patch => {
    expect(() => validateVideoFixtureProbe({ ...probe, streams: [{ ...probe.streams[0], ...patch }] }, mp4)).toThrow();
  });
  it.each(['1', '9', 'NaN'])('rejects truncated, overlong or invalid duration %s', duration => {
    expect(() => validateVideoFixtureProbe({ ...probe, format: { duration } }, mp4)).toThrow();
  });
  it('rejects missing metadata and additional audio/video streams', () => {
    expect(() => validateVideoFixtureProbe(null, mp4)).toThrow();
    expect(() => validateVideoFixtureProbe({ ...probe, streams: [...probe.streams, { codec_name: 'aac' }] }, mp4)).toThrow();
  });
});
