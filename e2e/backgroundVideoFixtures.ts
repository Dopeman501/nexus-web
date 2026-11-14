import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BackgroundMediaItem } from '../src/api/panelBackgroundMedia';

export const videoEvidence = fileURLToPath(new URL('../../builds/video-transitions-20261114/', import.meta.url));
export const videoDirectory = fileURLToPath(new URL('../.playwright/video-media/', import.meta.url));
const specs = [
  { id: 'mp4-a', ext: 'mp4', seconds: 8, hue: 0 },
  { id: 'mp4-b', ext: 'mp4', seconds: 8, hue: 85 },
  { id: 'mp4-short', ext: 'mp4', seconds: 2, hue: 140 },
  { id: 'webm', ext: 'webm', seconds: 8, hue: 210 },
] as const;

/** Reject stale or differently encoded cached inputs before any browser claims. */
export function validateVideoFixtureProbe(value: unknown, spec: { id: string; ext: 'mp4' | 'webm'; seconds: number }) {
  const probe = value as { streams?: Record<string, unknown>[]; format?: { duration?: unknown } } | null;
  const stream = probe?.streams?.[0];
  const duration = Number(probe?.format?.duration);
  if (!stream || probe?.streams?.length !== 1 || stream.width !== 320 || stream.height !== 144
    || stream.pix_fmt !== 'yuv420p' || stream.r_frame_rate !== '15/1'
    || stream.codec_name !== (spec.ext === 'mp4' ? 'h264' : 'vp8')
    || (spec.ext === 'mp4' && (stream.profile !== 'Main' || stream.level !== 30))
    || !Number.isFinite(duration) || Math.abs(duration - spec.seconds) > 0.1) {
    throw new Error(`Video fixture ${spec.id} differs from its pinned codec/profile/format/size/rate/duration contract.`);
  }
}

function fixtureTool(environment: string, fallback: string) {
  const explicit = process.env[environment];
  if (explicit !== undefined && !explicit.trim()) throw new Error(`${environment} must name an existing local executable.`);
  return explicit ?? fallback;
}

export function ensureVideoFixtures() {
  mkdirSync(videoDirectory, { recursive: true });
  mkdirSync(videoEvidence, { recursive: true });
  const rid = process.platform === 'win32' ? 'win-x64' : process.platform === 'darwin' ? 'osx-arm64' : 'linux-x64';
  const executable = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  const bundled = fileURLToPath(new URL(`../../nexus-service/Bundled/${rid}/ffmpeg/${executable}`, import.meta.url));
  const mp4Encoder = fixtureTool('NEXUS_TEST_FFMPEG', existsSync(bundled) ? bundled : 'ffmpeg');
  const generator = fixtureTool('NEXUS_TEST_FFMPEG_GENERATOR', 'ffmpeg');
  const probeTool = fixtureTool('NEXUS_TEST_FFPROBE', 'ffprobe');
  const version = (tool: string) => {
    try { return execFileSync(tool, ['-version'], { encoding: 'utf8', windowsHide: true }).split(/\r?\n/)[0]; }
    catch { throw new Error(`Local video fixture tool unavailable: ${tool}. See e2e/fixtures/README.md; no tools are downloaded.`); }
  };
  const versions = { mp4Encoder: version(mp4Encoder), generator: version(generator), probe: version(probeTool) };
  const records = specs.map(spec => {
    const path = resolve(videoDirectory, `${spec.id}.${spec.ext}`);
    const encoder = spec.ext === 'mp4' ? mp4Encoder : generator;
    const input = resolve(videoDirectory, `${spec.id}-synthetic-input.mp4`);
    // The packaged ffmpeg intentionally omits lavfi. Existing PATH ffmpeg creates
    // synthetic input; the actual packaged encoder produces the acceptance MP4.
    if (spec.ext === 'mp4' && !existsSync(input)) execFileSync(generator, ['-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', `testsrc2=size=320x144:rate=15:duration=${spec.seconds}`, '-vf', `hue=h=${spec.hue}`,
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-an', input], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const argumentsList = ['-hide_banner', '-loglevel', 'error', '-y',
      ...(spec.ext === 'mp4' ? ['-i', input] : ['-f', 'lavfi', '-i', `testsrc2=size=320x144:rate=15:duration=${spec.seconds}`, '-vf', `hue=h=${spec.hue}`]), '-an',
      ...(spec.ext === 'mp4' ? ['-c:v', 'libx264', '-profile:v', 'main', '-level:v', '3.0', '-pix_fmt', 'yuv420p', '-preset', 'veryfast', '-crf', '18', '-movflags', '+faststart']
        : ['-c:v', 'libvpx', '-deadline', 'realtime', '-cpu-used', '8', '-b:v', '500k']), path];
    if (!existsSync(path)) execFileSync(encoder, argumentsList, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const probe = JSON.parse(execFileSync(probeTool, ['-v', 'error', '-show_entries', 'stream=codec_name,profile,level,pix_fmt,width,height,r_frame_rate:format=duration', '-of', 'json', path], { encoding: 'utf8', windowsHide: true }));
    validateVideoFixtureProbe(probe, spec);
    return { ...spec, path, sha256: createHash('sha256').update(readFileSync(path)).digest('hex'), probe,
      selectedTools: versions, encoder: spec.ext === 'mp4' ? versions.mp4Encoder : versions.generator };
  });
  writeFileSync(resolve(videoEvidence, 'media-metadata.json'), JSON.stringify(records, null, 2));
  return records;
}
export function videoMedia(id: string): { body: Buffer; contentType: string } {
  const spec = specs.find(value => value.id === id);
  if (!spec) throw new Error(`Unknown generated clip ${id}`);
  return { body: readFileSync(resolve(videoDirectory, `${id}.${spec.ext}`)), contentType: `video/${spec.ext}` };
}
export function videoItem(id: string, importedAtUnixMs = 1): BackgroundMediaItem {
  const spec = specs.find(value => value.id === id)!;
  return { id, name: `${id}.${spec.ext}`, sourceExt: `.${spec.ext}`, type: 'animated', width: 320, height: 144,
    durationSec: spec.seconds, alpha: false, importedAtUnixMs };
}
export function stillItem(id: string, importedAtUnixMs = 0): BackgroundMediaItem {
  return { id, name: `${id}.svg`, sourceExt: '.svg', type: 'static', width: 1200, height: 540,
    durationSec: 0, alpha: false, importedAtUnixMs };
}
export function writeVideoFile(path: string, contents: string) {
  mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, contents);
}
