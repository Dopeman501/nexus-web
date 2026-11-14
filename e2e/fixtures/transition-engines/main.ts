import { transitionOptions } from '../../../src/panel/background/transitions/catalogue';
import { loadPictureTransitionFactory } from '../../../src/panel/background/transitions/engineLoader';
import type { TransitionAdapter } from '../../../src/panel/background/transitions/engine';
import dawn from '../../../public/background-transitions/demo-from.svg?url';
import night from '../../../public/background-transitions/demo-to.svg?url';

const stage = document.querySelector<HTMLDivElement>('#stage')!;
const images = [dawn, night].map((url, index) => {
  const image = new Image();
  image.className = 'backgroundMediaContent';
  image.id = `source-${index}`;
  image.src = url;
  return image;
});
const ready = Promise.all(images.map((image) => image.decode()));
let active: TransitionAdapter | null = null;
let signal: AbortController | null = null;
let reference: HTMLImageElement | null = null;
let key = '';
async function clear() {
  signal?.abort();
  signal = null;
  try { await active?.dispose(); } finally { active = null; reference?.remove(); reference = null; key = ''; }
  return { children: stage.childElementCount, canvases: stage.querySelectorAll('canvas').length };
}
const api = {
  effects: () => transitionOptions.map(({ key, library }) => ({ key, library })),
  async mount(effect: string) {
    const released = await clear();
    if (released.children !== 0) throw new Error('Previous production renderer left stage children.');
    await ready;
    signal = new AbortController();
    const factory = await loadPictureTransitionFactory(effect);
    active = await factory({ stage, from: images[0], to: images[1], signal: signal.signal });
    active.seek(0);
    key = effect;
    return api.backend();
  },
  seek(progress: number) {
    if (!active) throw new Error('No production renderer is mounted.');
    active.seek(progress);
  },
  async reference(which: number) {
    await clear(); await ready;
    reference = images[which].cloneNode(false) as HTMLImageElement;
    stage.append(reference);
  },
  clear,
  backend() {
    const canvas = stage.querySelector('canvas');
    if (!canvas) throw new Error('Production engine did not allocate its canvas.');
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    if (!gl) throw new Error('Existing production canvas has no WebGL context.');
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = String(gl.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
    return {
      key, backend: gl instanceof WebGL2RenderingContext ? 'WebGL2' : 'WebGL', renderer,
      version: String(gl.getParameter(gl.VERSION)), contextLost: gl.isContextLost(),
      software: /swiftshader|llvmpipe|software|basic render/i.test(renderer),
    };
  },
};
Object.assign(window, { productionTransitionFixture: api });
