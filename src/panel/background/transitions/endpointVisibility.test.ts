import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGlTransitionsAdapter } from './glTransitions';
import { createCurtainsAdapter } from './curtains';

vi.mock('three', async (importOriginal) => ({
  ...await importOriginal<typeof import('three')>(),
  WebGLRenderer: class {
    domElement = document.createElement('canvas');
    debug = { onShaderError: undefined };
    setPixelRatio() {} setSize() {} setClearColor() {} initTexture() {} compile() {}
    render() {} dispose() {} forceContextLoss() {}
  },
}));
vi.mock('curtainsjs', () => ({
  Curtains: class {
    gl = {};
    canvas = document.createElement('canvas');
    constructor({ container }: { container: HTMLElement }) { container.append(this.canvas); }
    render() {} resize() {} disableDrawing() {} dispose() {}
    onError() { return this; } onContextLost() { return this; }
  },
  Plane: class {
    uniforms = { progress: { value: 0 } };
    loadImage(_source: HTMLImageElement, _options: unknown, loaded: () => void) { loaded(); }
    onError() { return this; } remove() {}
  },
}));

let sourceCss: HTMLStyleElement;
beforeEach(() => {
  vi.useFakeTimers();
  sourceCss = document.createElement('style');
  // PanelBackgroundMedia gives its source this class; even a generic author
  // rule can override the browser's default [hidden] presentation.
  sourceCss.textContent = 'img,canvas,.backgroundMediaContent{display:block}';
  document.head.append(sourceCss);
});
afterEach(() => {
  sourceCss.remove(); document.body.replaceChildren(); vi.useRealTimers();
});

describe.each([
  ['GL', createGlTransitionsAdapter], ['Curtains', createCurtainsAdapter],
] as const)('%s source styles stay outside owned endpoint visibility', (_name, create) => {
  it('shows only the correct endpoint or canvas despite source display:block CSS', async () => {
    const stage = document.createElement('div');
    stage.getBoundingClientRect = () => ({ width: 640, height: 360 } as DOMRect);
    document.body.append(stage);
    const from = new Image(); const to = new Image();
    for (const [index, image] of [from, to].entries()) {
      image.className = 'backgroundMediaContent'; image.id = `source-${index}`;
      Object.defineProperties(image, { naturalWidth: { value: 640 }, naturalHeight: { value: 360 } });
    }
    const pending = Promise.resolve(create({ stage, from, to }));
    await vi.runAllTimersAsync();
    const adapter = await pending;
    const [outgoing, incoming] = [...stage.querySelectorAll('img')];
    const canvas = stage.querySelector('canvas')!;
    // jsdom's [hidden] cascade differs from Edge; require explicit ownership
    // instead of accepting the misleading computed-style-only result.
    expect(outgoing.style.display).toBe('block');
    expect(incoming.style.display).toBe('none');
    expect(canvas.style.display).toBe('none');
    expect(getComputedStyle(outgoing).display).toBe('block');
    expect(getComputedStyle(incoming).display).toBe('none');
    expect(getComputedStyle(canvas).display).toBe('none');
    adapter.seek(0.37);
    expect([outgoing.style.display, incoming.style.display, canvas.style.display]).toEqual(['none', 'none', 'block']);
    expect(getComputedStyle(outgoing).display).toBe('none');
    expect(getComputedStyle(incoming).display).toBe('none');
    expect(getComputedStyle(canvas).display).toBe('block');
    adapter.seek(1);
    expect([outgoing.style.display, incoming.style.display, canvas.style.display]).toEqual(['none', 'block', 'none']);
    expect(getComputedStyle(outgoing).display).toBe('none');
    expect(getComputedStyle(incoming).display).toBe('block');
    expect(getComputedStyle(canvas).display).toBe('none');
    expect(outgoing.className).toBe(''); expect(incoming.id).toBe('');
    expect(from.className).toBe('backgroundMediaContent'); expect(to.id).toBe('source-1');
    const cleanup = adapter.dispose();
    await vi.runAllTimersAsync();
    await cleanup;
    expect(stage.childElementCount).toBe(0);
  });
});
