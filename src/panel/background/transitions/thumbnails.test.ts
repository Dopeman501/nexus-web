// @vitest-environment node
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { transitionOptions } from './catalogue';
import { transitionThumbnailUrl } from './thumbnails';

describe('packaged transition stills', () => {
  it('covers every selected effect with its bounded actual-renderer JPEG', () => {
    const root = new URL('../../../../public/background-transitions/', import.meta.url);
    const manifest = JSON.parse(readFileSync(new URL('thumbnails.json', root), 'utf8')) as {
      entries: { key: string; file: string; sha256: string; width: number; height: number; progress: number }[];
    };
    expect(manifest.entries.map(entry => entry.key)).toEqual(transitionOptions.map(option => option.key));
    expect(readdirSync(root).filter(file => file.endsWith('.jpg'))).toHaveLength(226);
    for (const entry of manifest.entries) {
      expect(transitionThumbnailUrl(entry.key)).toBe(`/background-transitions/${entry.file}`);
      expect(entry.width).toBe(240); expect(entry.height).toBe(135); expect(entry.progress).toBe(0.5);
      const bytes = readFileSync(new URL(entry.file, root));
      expect(bytes.subarray(0, 2)).toEqual(Buffer.from([255, 216]));
      expect(bytes.subarray(-2)).toEqual(Buffer.from([255, 217]));
      expect(bytes.length).toBeLessThan(60_000);
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(entry.sha256);
    }
  });
  it('has no thumbnail URL for unselected or invented engines', () => {
    expect(transitionThumbnailUrl('motion:fade')).toBeUndefined();
    expect(transitionThumbnailUrl('gl-transitions:unknown')).toBeUndefined();
  });
});
