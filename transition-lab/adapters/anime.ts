import { animate } from 'animejs';
import { clampProgress, type AdapterFactory, type AdapterInput, type TransitionAdapter } from '../adapter';
import { getDomPreset, type DomLayerFrames, type DomPreset } from './domPresets';

const SAMPLE_DURATION_MS = 1_000;

function imageLayer(source: HTMLImageElement): HTMLImageElement {
  const image = document.createElement('img');
  image.src = source.currentSrc || source.src;
  image.alt = '';
  image.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;transform-origin:50% 50%;backface-visibility:hidden;pointer-events:none';
  return image;
}

/** A paused Anime timeline can be scrubbed without creating a second play loop. */
function timeline(image: HTMLImageElement, frames: DomLayerFrames) {
  return animate(image, { opacity: [...frames.opacity], transform: [...frames.transform], clipPath: [...frames.clipPath],
    duration: SAMPLE_DURATION_MS, ease: 'linear', autoplay: false });
}

function createSample({ stage, from, to }: AdapterInput, preset: DomPreset): TransitionAdapter {
  const mount = document.createElement('div');
  mount.style.cssText = 'position:absolute;inset:0;overflow:hidden;perspective:1200px';
  mount.style.background = preset.background;
  const outgoing = imageLayer(from);
  const incoming = imageLayer(to);
  mount.append(outgoing, incoming);
  stage.append(mount);
  let disposed = false;
  let first: ReturnType<typeof animate> | null = null;
  try {
    const outgoingAnimation = timeline(outgoing, preset.outgoing);
    first = outgoingAnimation;
    const incomingAnimation = timeline(incoming, preset.incoming);
    outgoingAnimation.seek(0);
    incomingAnimation.seek(0);
    return {
      seek(progress) {
        if (disposed) return;
        const time = clampProgress(progress) * SAMPLE_DURATION_MS;
        outgoingAnimation.seek(time);
        incomingAnimation.seek(time);
      },
      dispose() {
        if (disposed) return;
        disposed = true;
        outgoingAnimation.revert();
        incomingAnimation.revert();
        mount.remove();
      },
    };
  } catch (error) {
    first?.revert();
    mount.remove();
    throw error;
  }
}

export function createAnimeAdapterFor(presetId: string): AdapterFactory {
  getDomPreset(presetId);
  return input => createSample(input, getDomPreset(presetId));
}

export const createAnimeAdapter = createAnimeAdapterFor('wipe-left');
