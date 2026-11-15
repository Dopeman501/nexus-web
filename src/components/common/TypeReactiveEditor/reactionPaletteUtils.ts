import type { KeyReaction } from '../../../api/keyReactive';

export const MAX_REACTION_COLORS = 16;

const normalize = (color: string): string | null =>
  typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color) ? color.toLowerCase() : null;

/** Match the service's bounded palette contract without rewriting legacy settings on read. */
export function selectedReactionColors(config: Pick<KeyReaction, 'color' | 'colors'>): string[] {
  const colors = Array.isArray(config.colors)
    ? config.colors.slice(0, MAX_REACTION_COLORS).map(normalize).filter((color): color is string => color !== null)
    : [];
  const unique = [...new Set(colors)];
  return unique.length ? unique : [normalize(config.color) ?? '#ff2d55'];
}

/** A palette always has at least one colour. Null means the click changes nothing. */
export function toggleReactionColor(selected: readonly string[], color: string): string[] | null {
  const normalized = normalize(color);
  if (!normalized) return null;
  if (selected.includes(normalized)) {
    return selected.length > 1 ? selected.filter(value => value !== normalized) : null;
  }
  return selected.length < MAX_REACTION_COLORS ? [...selected, normalized] : null;
}
