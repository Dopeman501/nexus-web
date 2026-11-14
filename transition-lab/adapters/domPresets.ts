/** Authored comparison presets, not an exhaustive catalogue of either engine. */
const metadata = [
  { id: 'fade', label: 'Crossfade', description: 'Blend the next full-frame picture over the current picture.' },
  { id: 'fade-black', label: 'Fade through black', description: 'Fade the current picture to black, then reveal the next picture.' },
  { id: 'fade-white', label: 'Fade through white', description: 'Fade the current picture to white, then reveal the next picture.' },
  { id: 'slide-left', label: 'Slide left', description: 'Push the current picture left as the next enters from the right.' },
  { id: 'slide-right', label: 'Slide right', description: 'Push the current picture right as the next enters from the left.' },
  { id: 'slide-up', label: 'Slide up', description: 'Push the current picture up as the next enters from below.' },
  { id: 'slide-down', label: 'Slide down', description: 'Push the current picture down as the next enters from above.' },
  { id: 'wipe-left', label: 'Wipe from left', description: 'Reveal the next picture from its left edge with a gentle zoom.' },
  { id: 'wipe-right', label: 'Wipe from right', description: 'Reveal the next picture from its right edge with a gentle zoom.' },
  { id: 'wipe-up', label: 'Wipe upward', description: 'Reveal the next picture from its lower edge with a gentle zoom.' },
  { id: 'wipe-down', label: 'Wipe downward', description: 'Reveal the next picture from its upper edge with a gentle zoom.' },
  { id: 'zoom-in', label: 'Zoom in', description: 'Grow and blend the next picture from a smaller central image.' },
  { id: 'zoom-out', label: 'Zoom out', description: 'Blend an enlarged next picture while it settles into the full frame.' },
  { id: 'rotate', label: 'Rotate into place', description: 'Turn and blend the next picture until it sits upright in the frame.' },
  { id: 'flip', label: '3D flip in', description: 'Tilt and blend the next picture around its vertical axis.' },
  { id: 'reveal-circle', label: 'Circle reveal', description: 'Expand a circular window in the centre to reveal the next picture.' },
] as const;

export const domPresetOptions = Object.freeze(metadata.map(option => Object.freeze(option)));
export type DomPresetId = typeof metadata[number]['id'];
type Keyframes<T> = readonly [T, T, T];
export interface DomLayerFrames {
  readonly opacity: Keyframes<number>;
  readonly transform: Keyframes<string>;
  readonly clipPath: Keyframes<string>;
}
export interface DomPreset {
  readonly background: string;
  readonly outgoing: DomLayerFrames;
  readonly incoming: DomLayerFrames;
}

const transform = (x = 0, y = 0, scale = 1, rotation = 0, flip = 0) =>
  `translate3d(${x}%, ${y}%, 0px) scale(${scale}) rotate(${rotation}deg) rotateY(${flip}deg)`;

function layer(frames: Partial<DomLayerFrames> = {}): DomLayerFrames {
  return {
    opacity: frames.opacity ?? [1, 1, 1],
    transform: frames.transform ?? [transform(), transform(), transform()],
    clipPath: frames.clipPath ?? ['inset(0 0% 0 0)', 'inset(0 0% 0 0)', 'inset(0 0% 0 0)'],
  };
}

function blended(transforms: Keyframes<string>): DomPreset {
  return { background: '#000', outgoing: layer(), incoming: layer({ opacity: [0, 0.5, 1], transform: transforms }) };
}

function solidFade(background: string): DomPreset {
  return { background, outgoing: layer({ opacity: [1, 0, 0] }), incoming: layer({ opacity: [0, 0, 1] }) };
}

function slide(x: number, y: number): DomPreset {
  return { background: '#000',
    outgoing: layer({ transform: [transform(), transform(-x / 2, -y / 2), transform(-x, -y)] }),
    incoming: layer({ transform: [transform(x, y), transform(x / 2, y / 2), transform()] }) };
}

function wipe(side: 'top' | 'right' | 'bottom' | 'left'): DomPreset {
  const inset = (amount: number) => `inset(${(['top', 'right', 'bottom', 'left'] as const)
    .map(candidate => candidate === side ? `${amount}%` : '0').join(' ')})`;
  return { background: '#000', outgoing: layer(), incoming: layer({
    clipPath: [inset(100), inset(50), inset(0)],
    transform: [transform(0, 0, 1.04), transform(0, 0, 1.02), transform()],
  }) };
}

const factories: Record<DomPresetId, () => DomPreset> = {
  fade: () => blended([transform(), transform(), transform()]),
  'fade-black': () => solidFade('#000'),
  'fade-white': () => solidFade('#fff'),
  'slide-left': () => slide(100, 0),
  'slide-right': () => slide(-100, 0),
  'slide-up': () => slide(0, 100),
  'slide-down': () => slide(0, -100),
  'wipe-left': () => wipe('right'),
  'wipe-right': () => wipe('left'),
  'wipe-up': () => wipe('top'),
  'wipe-down': () => wipe('bottom'),
  'zoom-in': () => blended([transform(0, 0, 0.65), transform(0, 0, 0.825), transform()]),
  'zoom-out': () => blended([transform(0, 0, 1.3), transform(0, 0, 1.15), transform()]),
  rotate: () => blended([transform(0, 0, 1.15, -12), transform(0, 0, 1.075, -6), transform()]),
  flip: () => blended([transform(0, 0, 1, 0, 75), transform(0, 0, 1, 0, 37.5), transform()]),
  'reveal-circle': () => ({ background: '#000', outgoing: layer(), incoming: layer({
    clipPath: ['circle(0% at 50% 50%)', 'circle(35% at 50% 50%)', 'circle(150% at 50% 50%)'],
  }) }),
};

/** Fresh frame arrays isolate each adapter from a library's internal state. */
export function getDomPreset(presetId: string): DomPreset {
  if (!Object.hasOwn(factories, presetId)) throw new Error(`Unknown authored DOM preset: ${presetId}`);
  return factories[presetId as DomPresetId]();
}
