import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { codropsOptions } from '../codrops-catalogue/catalogue';
import { createCodropsCatalogueAdapter } from '../codrops-catalogue/adapter';
import { isFrameCommand, localImageUrl } from '../codrops-catalogue/protocol';
import manifest from '../codrops-catalogue/upstream-manifest.json';

describe('complete pinned Codrops catalogue', () => {
  it('offers every original numbered effect with source links and useful descriptions', () => {
    expect(codropsOptions).toHaveLength(32);
    expect(codropsOptions.map((effect) => effect.id)).toEqual(
      Array.from({ length: 32 }, (_, index) => `codrops-${String(index + 1).padStart(2, '0')}`),
    );
    expect(codropsOptions[0].label).toBe('Parallax');
    expect(codropsOptions[16].label).toBe('Unveil');
    expect(codropsOptions[31].label).toBe('Cube');
    for (const effect of codropsOptions) {
      expect(effect.description.length).toBeGreaterThan(30);
      expect(effect.sourceUrl).toMatch(/^https:\/\/tympanus.net\/Development\/SlideshowAnimations\/index\d*\.html$/);
      expect(createCodropsCatalogueAdapter(effect.id)).toBeTypeOf('function');
    }
  });

  it('rejects arbitrary demo paths before creating a frame', () => {
    for (const id of ['../index', 'codrops-00', 'codrops-33', '17']) {
      expect(() => createCodropsCatalogueAdapter(id)).toThrow(/Unknown Codrops/);
    }
  });

  it('keeps all vendored demo and runtime files byte-for-byte equal to their pinned Git blobs', () => {
    expect(manifest.commit).toBe('d05e45915cf947e85e651296f84ab2b5364056df');
    expect(manifest.files.filter(file => /demo\d+\/slideshow\.js$/.test(file.path))).toHaveLength(32);
    for (const file of manifest.files) {
      const bytes = readFileSync(resolve('transition-lab/codrops-catalogue/vendor', file.path));
      const hash = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
      expect(hash, file.path).toBe(file.sha);
    }
  });

  it('constrains the preview to local scripts/images and prevents network/API connections', () => {
    const html = readFileSync(resolve('transition-lab/codrops-catalogue/frame.html'), 'utf8');
    expect(html).toContain("default-src 'none'");
    expect(html).toContain("script-src 'self'");
    expect(html).toContain("connect-src 'none'");
    expect(html).toContain("worker-src 'self'");
    expect(html).not.toMatch(/https?:\/\//);
  });
});

describe('isolated Codrops frame protocol', () => {
  const base = { channel: 'nexus-codrops', nonce: 'test-session', id: 'codrops-17' };

  it('accepts only commands for the selected effect and exact session', () => {
    expect(isFrameCommand({ ...base, kind: 'seek', progress: 0.5 }, base.nonce, base.id)).toBe(true);
    expect(isFrameCommand({ ...base, kind: 'dispose' }, base.nonce, base.id)).toBe(true);
    expect(isFrameCommand({ ...base, kind: 'init', from: '/a.svg', to: '/b.svg' }, base.nonce, base.id)).toBe(true);
    for (const value of [null, {}, { ...base, kind: 'fetch' },
      { ...base, kind: 'seek', progress: NaN }, { ...base, kind: 'seek', progress: Infinity },
      { ...base, kind: 'seek', progress: -0.1 }, { ...base, kind: 'seek', progress: 1.1 },
      { ...base, nonce: 'another', kind: 'dispose' }, { ...base, id: 'codrops-01', kind: 'dispose' }]) {
      expect(isFrameCommand(value, base.nonce, base.id)).toBe(false);
    }
  });

  it('only accepts image resources from the sampler origin', () => {
    const origin = 'http://127.0.0.1:19431';
    expect(localImageUrl('/assets/dawn.svg', origin)).toBe(`${origin}/assets/dawn.svg`);
    expect(localImageUrl('blob:http://127.0.0.1:19431/image', origin)).toBe('blob:http://127.0.0.1:19431/image');
    expect(localImageUrl('data:image/png;base64,AA==', origin)).toBe('data:image/png;base64,AA==');
    for (const value of ['https://example.com/image.png', 'javascript:alert(1)', 'file:///C:/image.png']) {
      expect(() => localImageUrl(value, origin)).toThrow(/local/);
    }
  });
});
