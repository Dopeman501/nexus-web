import { afterEach, describe, expect, it } from 'vitest';
import { waitFor } from '@testing-library/dom';
import { createMotionAdapterFor } from '../adapters/motion';
import { createAnimeAdapterFor } from '../adapters/anime';
import { domPresetOptions } from '../adapters/domPresets';
import type { AdapterFactory, TransitionAdapter } from '../adapter';

const presetIds = ['fade', 'fade-black', 'fade-white', 'slide-left', 'slide-right', 'slide-up', 'slide-down',
  'wipe-left', 'wipe-right', 'wipe-up', 'wipe-down', 'zoom-in', 'zoom-out', 'rotate', 'flip', 'reveal-circle'];
const engines: Array<[string, (preset: string) => AdapterFactory]> = [
  ['Motion for React', createMotionAdapterFor], ['Anime.js', createAnimeAdapterFor],
];
let owned: TransitionAdapter | undefined;
afterEach(async () => { await owned?.dispose(); owned = undefined; document.body.replaceChildren(); });

function fixture() {
  const stage = document.createElement('div');
  const sentinel = document.createElement('span');
  stage.append(sentinel);
  document.body.append(stage);
  const from = new Image(); from.src = '/dawn.svg';
  const to = new Image(); to.src = '/night.svg';
  return { stage, from, to, sentinel };
}

function fingerprint(stage: HTMLElement) {
  const mount = stage.querySelector('div')!;
  return JSON.stringify({ background: mount.style.background,
    layers: Array.from(stage.querySelectorAll('img'), image => ({
      opacity: image.style.opacity || '1', transform: image.style.transform.replace(/\s+/g, ''),
      clip: image.style.clipPath.replace(/\s+/g, ''),
    })) });
}

async function seek(adapter: TransitionAdapter, stage: HTMLElement, progress: number) {
  adapter.seek(progress);
  // Motion's actual React renderer commits motion values on its frame pass.
  await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  return fingerprint(stage);
}

it('publishes one immutable, named 16-preset collection for both engines', () => {
  expect(domPresetOptions.map(option => option.id)).toEqual(presetIds);
  expect(Object.isFrozen(domPresetOptions)).toBe(true);
  for (const option of domPresetOptions) {
    expect(option.label.length).toBeGreaterThan(3);
    expect(option.description.length).toBeGreaterThan(15);
    expect(Object.isFrozen(option)).toBe(true);
  }
});

describe.each(engines)('%s authored preset collection', (_name, createFor) => {
  it('rejects unknown preset IDs before allocating any stage resources', () => {
    expect(() => createFor('not-an-authored-preset')).toThrow(/preset/i);
  });

  it.each(presetIds)('%s preserves exact visible endpoints and releases its owned layers', async preset => {
    const input = fixture();
    owned = await createFor(preset)(input);
    const [outgoing, incoming] = Array.from(input.stage.querySelectorAll('img'));
    expect(outgoing.src).toBe(input.from.src);
    expect(incoming.src).toBe(input.to.src);
    const start = await seek(owned, input.stage, 0);
    expect(outgoing.style.opacity || '1').toBe('1');
    const middle = await seek(owned, input.stage, 0.5);
    const end = await seek(owned, input.stage, 1);
    expect(incoming.style.opacity || '1').toBe('1');
    expect(middle).not.toBe(start);
    expect(middle).not.toBe(end);
    expect(end).not.toBe(start);
    expect(end).not.toContain('NaN');
    await seek(owned, input.stage, -1);
    expect(fingerprint(input.stage)).toBe(start);
    await seek(owned, input.stage, 2);
    expect(fingerprint(input.stage)).toBe(end);
    await owned.dispose();
    await owned.dispose();
    owned.seek(0.5);
    await waitFor(() => expect(Array.from(input.stage.children)).toEqual([input.sentinel]));
    expect(input.from.parentElement).toBeNull();
    expect(input.to.parentElement).toBeNull();
  });

  it('renders a distinct middle-state composition for every authored preset', async () => {
    const middleStates: string[] = [];
    for (const preset of presetIds) {
      const input = fixture();
      owned = await createFor(preset)(input);
      middleStates.push(await seek(owned, input.stage, 0.5));
      await owned.dispose();
      input.stage.remove();
    }
    expect(new Set(middleStates).size).toBe(presetIds.length);
  });
});

it('uses equivalent observable midpoint styles in the two real engines', async () => {
  for (const preset of presetIds) {
    const motionInput = fixture();
    owned = await createMotionAdapterFor(preset)(motionInput);
    const motionState = await seek(owned, motionInput.stage, 0.5);
    await owned.dispose();
    const animeInput = fixture();
    owned = await createAnimeAdapterFor(preset)(animeInput);
    const animeState = await seek(owned, animeInput.stage, 0.5);
    expect(animeState).toBe(motionState);
    await owned.dispose();
  }
});
