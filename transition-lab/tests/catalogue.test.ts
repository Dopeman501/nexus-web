import { describe, expect, it } from 'vitest';
import { catalogue, defaultEffect, findEffect, readShortlist, shortlistKey } from '../catalogue';

describe('complete sampler catalogue', () => {
  it('contains every installed GL effect and all 32 official Codrops entries with stable identities', () => {
    expect(catalogue.filter(effect => effect.library === 'gl-transitions')).toHaveLength(214);
    expect(catalogue.filter(effect => effect.library === 'codrops')).toHaveLength(32);
    expect(new Set(catalogue.map(effect => effect.key)).size).toBe(catalogue.length);
    expect(findEffect('gl-transitions:WaterDrop')?.label).toContain('Water');
    expect(defaultEffect('gl-transitions').id).toBe('WaterDrop');
  });

  it('rejects untrusted shortlist entries and bounds saved selection size', () => {
    expect(shortlistKey).toContain('transition-lab');
    const valid = catalogue[0].key;
    expect(readShortlist(JSON.stringify([valid, 'https://invalid.example/script', valid, null, {}]))).toEqual([valid]);
    expect(readShortlist('{invalid')).toEqual([]);
    expect(readShortlist(JSON.stringify({ picks: [valid] }))).toEqual([]);
  });
});
