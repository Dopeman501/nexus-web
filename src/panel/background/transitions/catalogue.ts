import { glCatalogueData } from './glCatalogueData';

export const curtainsPresetOptions = [
  { id: 'wave', label: 'Wave displacement' }, { id: 'liquid', label: 'Liquid distortion' },
  { id: 'ripple', label: 'Water ripple' }, { id: 'swirl', label: 'Swirl' },
  { id: 'zoom', label: 'Zoom dissolve' }, { id: 'chromatic', label: 'Chromatic split' },
  { id: 'pixelate', label: 'Pixel dissolve' }, { id: 'horizontal', label: 'Horizontal waves' },
  { id: 'vertical', label: 'Vertical waves' }, { id: 'diagonal', label: 'Diagonal waves' },
  { id: 'twist', label: 'Twist' }, { id: 'melt', label: 'Melt' },
] as const;
export const curtainsNames = Object.freeze(curtainsPresetOptions.map((option) => option.id));
export interface BackgroundTransitionOption {
  readonly key: string;
  readonly label: string;
  readonly library: 'gl-transitions' | 'curtains';
  readonly description: string;
  readonly author: string;
  readonly license: string;
}
export const transitionOptions: readonly BackgroundTransitionOption[] = Object.freeze([
  ...glCatalogueData.map((effect) => Object.freeze({
    key: `gl-transitions:${effect.name}`, label: effect.label, library: 'gl-transitions' as const,
    description: effect.description, author: effect.author, license: effect.license,
  })),
  ...curtainsPresetOptions.map((effect) => Object.freeze({
    key: `curtains:${effect.id}`, label: effect.label, library: 'curtains' as const,
    description: 'Authored image shader preset rendered by Curtains.js.', author: 'Jungle Nexus', license: 'MIT',
  })),
]);
const selectedKeys = new Set(transitionOptions.map((option) => option.key));
export const isPictureTransitionEffect = (value: unknown): value is string =>
  typeof value === 'string' && selectedKeys.has(value);
export const isBackgroundTransitionEffect = (value: unknown): value is string =>
  value === 'default' || value === 'none' || isPictureTransitionEffect(value);
