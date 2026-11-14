import { libraryIds, type AdapterFactory, type LibraryId } from './adapter';
import { glTransitionOptions } from './adapters/glTransitions';
import { curtainsPresetOptions } from './adapters/curtains';
import { domPresetOptions } from './adapters/domPresets';
import { codropsOptions } from './codrops-catalogue/catalogue';

export interface CatalogueEffect {
  key: string;
  id: string;
  library: LibraryId;
  label: string;
  description: string;
  origin: 'Packaged effect' | 'Original Codrops demo' | 'Authored engine preset';
  sourceUrl?: string;
  tags: readonly string[];
}

export const catalogue: readonly CatalogueEffect[] = [
  ...glTransitionOptions.map(effect => ({ id: effect.name, library: 'gl-transitions' as const,
    label: effect.label, description: effect.description, origin: 'Packaged effect' as const,
    tags: effect.tags, sourceUrl: `https://gl-transitions.com/gallery` })),
  ...codropsOptions.map(effect => ({ ...effect, library: 'codrops' as const,
    origin: 'Original Codrops demo' as const, tags: ['fullscreen', 'Codrops'] })),
  ...curtainsPresetOptions.map(effect => ({ ...effect, library: 'curtains' as const,
    description: 'Authored full-frame shader preset rendered with the actual Curtains engine.',
    origin: 'Authored engine preset' as const, tags: ['displacement', 'shader'] })),
  ...(['motion', 'anime'] as const).flatMap(library => domPresetOptions.map(effect => ({ ...effect, library,
    description: `Authored full-frame preset using the actual ${library === 'motion' ? 'Motion React' : 'Anime.js'} engine.`,
    origin: 'Authored engine preset' as const, tags: ['fullscreen', 'DOM'] }))),
].map(effect => ({ ...effect, key: `${effect.library}:${effect.id}` }));

export const libraryLabels: Readonly<Record<LibraryId, string>> = {
  'gl-transitions': 'GL Transitions', codrops: 'Codrops', curtains: 'Curtains.js', motion: 'Motion for React', anime: 'Anime.js',
};
const defaults: Readonly<Record<LibraryId, string>> = {
  'gl-transitions': 'WaterDrop', codrops: 'codrops-17', curtains: 'wave', motion: 'wipe-left', anime: 'wipe-left',
};
export const findEffect = (key: string): CatalogueEffect | undefined => catalogue.find(effect => effect.key === key);
export function defaultEffect(library: LibraryId): CatalogueEffect {
  return catalogue.find(effect => effect.library === library && effect.id === defaults[library])
    ?? catalogue.find(effect => effect.library === library)!;
}
export const shortlistKey = 'nexus.transition-lab.shortlist.v1';
export function readShortlist(raw: string | null): string[] {
  if (!raw || raw.length > 100_000) return [];
  try {
    const values: unknown = JSON.parse(raw);
    if (!Array.isArray(values)) return [];
    return [...new Set(values.slice(0, 512).filter((value): value is string => typeof value === 'string' && !!findEffect(value)))];
  } catch { return []; }
}

export async function loadEffectAdapter(key: string): Promise<AdapterFactory> {
  const effect = findEffect(key);
  if (!effect || !libraryIds.includes(effect.library)) throw new Error('Unknown catalogue transition');
  switch (effect.library) {
    case 'gl-transitions': return (await import('./adapters/glTransitions')).createGlTransitionsAdapterFor(effect.id);
    case 'codrops': return (await import('./codrops-catalogue/adapter')).createCodropsCatalogueAdapter(effect.id);
    case 'curtains': return (await import('./adapters/curtains')).createCurtainsAdapterFor(effect.id);
    case 'motion': return (await import('./adapters/motion')).createMotionAdapterFor(effect.id);
    case 'anime': return (await import('./adapters/anime')).createAnimeAdapterFor(effect.id);
  }
}
