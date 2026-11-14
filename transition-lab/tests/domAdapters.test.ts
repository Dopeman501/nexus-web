import { afterEach, describe, expect, it } from 'vitest';
import { waitFor } from '@testing-library/dom';
import { createAnimeAdapter } from '../adapters/anime';
import { createMotionAdapter } from '../adapters/motion';
import type { AdapterFactory, TransitionAdapter } from '../adapter';

const adapters: Array<[string, AdapterFactory]> = [
  ['Motion for React', createMotionAdapter],
  ['Anime.js', createAnimeAdapter],
];

let current: TransitionAdapter | undefined;
afterEach(async () => {
  await current?.dispose();
  current = undefined;
  document.body.replaceChildren();
});

function fixture() {
  const stage = document.createElement('div');
  const untouched = document.createElement('span');
  untouched.textContent = 'Existing stage content';
  stage.append(untouched);
  document.body.append(stage);
  const from = document.createElement('img');
  from.src = '/from.svg';
  const to = document.createElement('img');
  to.src = '/to.svg';
  return { input: { stage, from, to }, untouched };
}

describe.each(adapters)('%s sample adapter', (_name, create) => {
  it('mounts separate full-frame media without moving or modifying the input elements', async () => {
    const { input, untouched } = fixture();
    current = await create(input);
    const layers = Array.from(input.stage.querySelectorAll('img'));
    expect(layers).toHaveLength(2);
    expect(layers.map(image => image.src)).toEqual([input.from.src, input.to.src]);
    expect(layers.every(image => image.style.position === 'absolute' && image.style.objectFit === 'cover')).toBe(true);
    expect(input.from.parentElement).toBeNull();
    expect(input.to.parentElement).toBeNull();
    expect(input.from.style.cssText).toBe('');
    expect(input.to.style.cssText).toBe('');
    expect(untouched.parentElement).toBe(input.stage);
  });

  it('can seek forwards and backwards with recognizable start, intermediate and end states', async () => {
    const { input } = fixture();
    current = await create(input);
    const incoming = input.stage.querySelectorAll('img')[1];
    current.seek(0);
    await waitFor(() => expect(incoming.style.clipPath).toBe('inset(0 100% 0 0)'));
    current.seek(0.5);
    await waitFor(() => expect(incoming.style.clipPath).toBe('inset(0 50% 0 0)'));
    current.seek(1);
    await waitFor(() => expect(incoming.style.clipPath).toBe('inset(0 0% 0 0)'));
    current.seek(0.25);
    await waitFor(() => expect(incoming.style.clipPath).toBe('inset(0 75% 0 0)'));
  });

  it('bounds out-of-range and invalid progress', async () => {
    const { input } = fixture();
    current = await create(input);
    const incoming = input.stage.querySelectorAll('img')[1];
    current.seek(2);
    await waitFor(() => expect(incoming.style.clipPath).toBe('inset(0 0% 0 0)'));
    current.seek(-1);
    await waitFor(() => expect(incoming.style.clipPath).toBe('inset(0 100% 0 0)'));
    current.seek(Number.NaN);
    await waitFor(() => expect(incoming.style.clipPath).toBe('inset(0 100% 0 0)'));
  });

  it('releases only owned children and ignores seeks after repeated disposal', async () => {
    const { input, untouched } = fixture();
    current = await create(input);
    current.seek(0.5);
    await current.dispose();
    await current.dispose();
    current.seek(1);
    expect(input.stage.querySelectorAll('img')).toHaveLength(0);
    expect(Array.from(input.stage.children)).toEqual([untouched]);
  });
});
