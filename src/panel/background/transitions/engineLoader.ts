import { isPictureTransitionEffect } from './catalogue';
import type { AdapterFactory } from './engine';

/** Renderer libraries/shader sources stay behind this lazy production boundary. */
export async function loadPictureTransitionFactory(effect: string): Promise<AdapterFactory> {
  if (!isPictureTransitionEffect(effect)) throw new Error('Unsupported picture transition.');
  const separator = effect.indexOf(':');
  const name = effect.slice(separator + 1);
  return effect.startsWith('gl-transitions:')
    ? (await import('./glTransitions')).createGlTransitionsAdapterFor(name)
    : (await import('./curtains')).createCurtainsAdapterFor(name);
}
