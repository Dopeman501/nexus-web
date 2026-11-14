import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Texture } from 'three';
import { createGlTransitionsAdapter } from './glTransitions';
import { createCurtainsAdapter } from './curtains';

const probe = vi.hoisted(() => ({ textures: [] as Texture[], canvasSources: [] as HTMLCanvasElement[], dirty: vi.fn() }));
vi.mock('three', async original => ({
  ...await original<typeof import('three')>(),
  WebGLRenderer: class {
    domElement = document.createElement('canvas'); debug = { onShaderError: undefined };
    setPixelRatio() {} setSize() {} setClearColor() {}
    initTexture(texture: Texture) { probe.textures.push(texture); }
    compile() {} render() {} dispose() {} forceContextLoss() {}
  },
}));
vi.mock('curtainsjs', () => ({
  Curtains: class {
    gl = {}; canvas = document.createElement('canvas');
    constructor({ container }: { container: HTMLElement }) { container.append(this.canvas); }
    render() {} resize() {} disableDrawing() {} dispose() {}
    onError() { return this; } onContextLost() { return this; }
  },
  Plane: class {
    uniforms = { progress: { value: 0 } };
    loadCanvas(source: HTMLCanvasElement, _options: unknown, loaded: (texture: object) => void) {
      probe.canvasSources.push(source); loaded({ shouldUpdate: true, needUpdate: probe.dirty });
    }
    onError() { return this; }
    remove() { probe.canvasSources.forEach(source => { source.width = 0; }); }
  },
}));

const draw = vi.fn();
beforeEach(() => {
  vi.useFakeTimers(); probe.textures = []; probe.canvasSources = []; probe.dirty.mockReset(); draw.mockReset();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: draw } as unknown as CanvasRenderingContext2D);
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); document.body.replaceChildren(); });

describe.each([['GL', createGlTransitionsAdapter], ['Curtains', createCurtainsAdapter]] as const)('%s live video borrowing', (_name, create) => {
  it('copies snapshots, refreshes live frames on seek including endpoint, and disposes only owned buffers', async () => {
    const stage = document.createElement('div'); document.body.append(stage);
    stage.getBoundingClientRect = () => ({ width: 640, height: 360 } as DOMRect);
    const from = document.createElement('canvas'); from.width = 640; from.height = 360;
    const to = document.createElement('video'); to.src = '/incoming.mp4'; to.loop = false; to.currentTime = 7.25;
    Object.defineProperties(to, { videoWidth: { value: 640 }, videoHeight: { value: 360 }, readyState: { value: 2 } });
    const pause = vi.spyOn(to, 'pause'); const play = vi.spyOn(to, 'play'); const load = vi.spyOn(to, 'load');
    const pending = Promise.resolve(create({ stage, from, to }));
    void pending.catch(() => {});
    await vi.runAllTimersAsync(); const adapter = await pending;
    const version = probe.textures[1]?.version ?? 0;
    draw.mockClear(); probe.dirty.mockClear();
    adapter.seek(0.37); adapter.seek(0.37); adapter.seek(1);
    expect(draw.mock.calls.map(([source]) => source)).toEqual([to, to, to]);
    expect(stage.querySelector('video')).toBeNull();
    expect(stage.querySelectorAll('canvas[data-picture-transition-renderer]')).toHaveLength(1);
    const canvasSources = probe.textures.map(texture => texture.image as HTMLCanvasElement).concat(probe.canvasSources);
    expect(canvasSources).toHaveLength(2); expect(canvasSources).not.toContain(from);
    if (probe.textures.length) expect(probe.textures[1].version).toBe(version + 3);
    else expect(probe.dirty).toHaveBeenCalledTimes(3);
    const incoming = canvasSources[1]; expect(incoming.style.display).toBe('block');
    const cleanup = adapter.dispose(); await vi.runAllTimersAsync(); await cleanup;
    expect(from.width).toBe(640); expect(from.height).toBe(360);
    expect(canvasSources.every(source => source.width === 0 && source.height === 0)).toBe(true);
    expect(to.src).toContain('/incoming.mp4'); expect(to.loop).toBe(false);
    expect(to.currentTime).toBe(7.25); expect(to.crossOrigin).toBeNull();
    expect(pause).not.toHaveBeenCalled(); expect(play).not.toHaveBeenCalled(); expect(load).not.toHaveBeenCalled();
    draw.mockClear(); adapter.seek(0.5); expect(draw).not.toHaveBeenCalled();
    expect(stage.childElementCount).toBe(0);
  });
});
