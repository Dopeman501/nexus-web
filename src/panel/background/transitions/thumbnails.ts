import { transitionOptions } from './catalogue';

/** Stable snapshot names are generated and checked against this exact catalogue order. */
const paths = new Map(transitionOptions.map((option, index) => [option.key,
  `/background-transitions/thumb-${String(index).padStart(3, '0')}.jpg`]));

export function transitionThumbnailUrl(effect: string): string | undefined {
  return paths.get(effect);
}
