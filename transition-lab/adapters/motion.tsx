import { type CSSProperties } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { motion, motionValue, useTransform, type MotionValue } from 'motion/react';
import { clampProgress, type AdapterFactory, type AdapterInput, type TransitionAdapter } from '../adapter';
import { getDomPreset, type DomLayerFrames, type DomPreset } from './domPresets';

const imageStyle: CSSProperties = {
  position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover',
  transformOrigin: '50% 50%', backfaceVisibility: 'hidden', pointerEvents: 'none',
};

function MotionLayer({ source, frames, progress }: {
  source: string;
  frames: DomLayerFrames;
  progress: MotionValue<number>;
}) {
  const opacity = useTransform(progress, [0, 0.5, 1], [...frames.opacity]);
  const transform = useTransform(progress, [0, 0.5, 1], [...frames.transform]);
  const clipPath = useTransform(progress, [0, 0.5, 1], [...frames.clipPath]);
  return <motion.img src={source} alt="" initial={false} style={{ ...imageStyle, opacity, transform, clipPath }} />;
}

function MotionScene({ from, to, progress, preset }: {
  from: string; to: string; progress: MotionValue<number>; preset: DomPreset;
}) {
  return <>
    <MotionLayer source={from} frames={preset.outgoing} progress={progress} />
    <MotionLayer source={to} frames={preset.incoming} progress={progress} />
  </>;
}

/** Real Motion React bindings; the comparison host supplies the shared clock. */
function createSample({ stage, from, to }: AdapterInput, preset: DomPreset): TransitionAdapter {
  const mount = document.createElement('div');
  mount.style.cssText = 'position:absolute;inset:0;overflow:hidden;perspective:1200px';
  mount.style.background = preset.background;
  stage.append(mount);
  const progress = motionValue(0);
  const root = createRoot(mount);
  let disposed = false;
  try {
    flushSync(() => root.render(<MotionScene from={from.currentSrc || from.src}
      to={to.currentSrc || to.src} progress={progress} preset={preset} />));
  } catch (error) {
    root.unmount();
    progress.destroy();
    mount.remove();
    throw error;
  }
  return {
    seek(value) {
      if (!disposed) progress.set(clampProgress(value));
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      flushSync(() => root.unmount());
      progress.destroy();
      mount.remove();
    },
  };
}

export function createMotionAdapterFor(presetId: string): AdapterFactory {
  getDomPreset(presetId);
  return input => createSample(input, getDomPreset(presetId));
}

export const createMotionAdapter = createMotionAdapterFor('wipe-left');
