import type { AdapterFactory, LibraryId } from './adapter';

export const samples: ReadonlyArray<{ id: LibraryId; label: string; effect: string; note: string }> = [
  { id: 'gl-transitions', label: 'GL Transitions', effect: 'WaterDrop', note: 'The packaged GLSL shader, drawn with existing Three.js.' },
  { id: 'codrops', label: 'Codrops', effect: 'Unveil', note: 'Pinned MIT sheet-curl source adapted from TSL to WebGL.' },
  { id: 'curtains', label: 'Curtains.js', effect: 'Displacement', note: 'A real Curtains plane with a local wave-displacement shader.' },
  { id: 'motion', label: 'Motion for React', effect: 'Wipe + zoom', note: 'Actual motion.img components and Motion values.' },
  { id: 'anime', label: 'Anime.js', effect: 'Wipe + zoom', note: 'A paused Anime timeline driven by the comparison clock.' },
];

export async function loadAdapter(id: LibraryId): Promise<AdapterFactory> {
  switch (id) {
    case 'gl-transitions': return (await import('./adapters/glTransitions')).createGlTransitionsAdapter;
    case 'codrops': return (await import('./adapters/codrops')).createCodropsAdapter;
    case 'curtains': return (await import('./adapters/curtains')).createCurtainsAdapter;
    case 'motion': return (await import('./adapters/motion')).createMotionAdapter;
    case 'anime': return (await import('./adapters/anime')).createAnimeAdapter;
  }
}
