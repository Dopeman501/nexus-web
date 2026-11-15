// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { MAX_REACTION_COLORS, selectedReactionColors, toggleReactionColor } from './reactionPaletteUtils';

describe('custom reaction palette contract', () => {
  it.each([undefined, [], ['bad'], ['#000'], [' #000000'], [null as unknown as string]])('falls back to the legacy colour for %j', colors => {
    expect(selectedReactionColors({ color: '#ABCDEF', colors })).toEqual(['#abcdef']);
  });

  it('uses the default when both the list and legacy value are invalid', () => {
    expect(selectedReactionColors({ color: 'bad', colors: ['bad'] })).toEqual(['#ff2d55']);
  });

  it('preserves first-selection order, exact black and unique normalized values without mutating input', () => {
    const colors = Object.freeze(['#FF2D55', '#000000', '#ff2d55', 'bad', '#123456']);
    expect(selectedReactionColors({ color: '#ffffff', colors: colors as unknown as string[] }))
      .toEqual(['#ff2d55', '#000000', '#123456']);
    expect(colors).toEqual(['#FF2D55', '#000000', '#ff2d55', 'bad', '#123456']);
  });

  it('examines only the first sixteen list positions, matching the service', () => {
    const colors = [...Array(MAX_REACTION_COLORS).fill('bad'), '#000000'];
    expect(selectedReactionColors({ color: '#123456', colors })).toEqual(['#123456']);
  });

  it('appends a new choice and removes an existing one without reordering survivors', () => {
    const selected = Object.freeze(['#000000', '#123456', '#ffffff']);
    expect(toggleReactionColor(selected, '#ABCDEF')).toEqual([...selected, '#abcdef']);
    expect(toggleReactionColor(selected, '#123456')).toEqual(['#000000', '#ffffff']);
    expect(selected).toHaveLength(3);
  });

  it('does nothing for the only selected colour, invalid input or a seventeenth choice', () => {
    expect(toggleReactionColor(['#000000'], '#000000')).toBeNull();
    expect(toggleReactionColor(['#000000'], 'bad')).toBeNull();
    const full = Array.from({ length: MAX_REACTION_COLORS }, (_, i) => `#${i.toString(16).padStart(6, '0')}`);
    expect(toggleReactionColor(full, '#ffffff')).toBeNull();
    expect(toggleReactionColor(full, '#000000')).toHaveLength(MAX_REACTION_COLORS - 1);
  });
});
