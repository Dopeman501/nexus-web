import { describe, expect, it } from 'vitest';
import { normalizeBackgroundTransition } from './settings';
import { isBackgroundTransitionEffect, transitionOptions } from './catalogue';

it('exposes exactly the selected 214 GL and 12 Curtains stable IDs', () => {
  expect(transitionOptions).toHaveLength(226);
  expect(new Set(transitionOptions.map((option) => option.key)).size).toBe(226);
  expect(transitionOptions.filter((option) => option.library === 'gl-transitions')).toHaveLength(214);
  expect(transitionOptions.filter((option) => option.library === 'curtains')).toHaveLength(12);
  expect(isBackgroundTransitionEffect('gl-transitions:WaterDrop')).toBe(true);
  expect(isBackgroundTransitionEffect('curtains:wave')).toBe(true);
  expect(isBackgroundTransitionEffect('default')).toBe(true);
  expect(isBackgroundTransitionEffect('none')).toBe(true);
  expect(isBackgroundTransitionEffect('gl-transitions:waterdrop')).toBe(false);
  expect(isBackgroundTransitionEffect('codrops:codrops-17')).toBe(false);
});

describe('background transition receiving boundary', () => {
  it.each([undefined, null, false, [], 'none', { effect: '__proto__', durationMs: '800' }])('safely defaults malformed input %j', (value) => {
    expect(normalizeBackgroundTransition(value)).toEqual({ effect: 'default', durationMs: 800 });
  });
  it.each([79, 5001, 100.5, Number.NaN, Infinity, null])('rejects invalid duration %j', (durationMs) => {
    expect(normalizeBackgroundTransition({ effect: 'curtains:wave', durationMs })).toEqual({ effect: 'curtains:wave', durationMs: 800 });
  });
  it.each([80, 800, 5000])('retains valid bounded integer duration %i', (durationMs) => {
    expect(normalizeBackgroundTransition({ effect: 'gl-transitions:WaterDrop', durationMs })).toEqual({ effect: 'gl-transitions:WaterDrop', durationMs });
  });
  it('does not retain or mutate the supplied record', () => {
    const record = Object.freeze({ effect: 'none', durationMs: 90, unrelated: true });
    expect(normalizeBackgroundTransition(record)).toEqual({ effect: 'none', durationMs: 90 });
    expect(normalizeBackgroundTransition(record)).not.toBe(record);
  });
});
