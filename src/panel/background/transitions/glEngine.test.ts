import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { Mesh, ShaderMaterial, Texture } from 'three';
import type { BufferGeometry, Camera, Scene } from 'three';
import { createGlTransitionsAdapter } from './glTransitions';

interface RendererProbe {
  compile: Mock<(scene: Scene, camera: Camera) => void>;
  render: Mock;
  setSize: Mock;
  dispose: Mock;
  forceContextLoss: Mock;
}
const gpu = vi.hoisted(() => ({ instances: [] as RendererProbe[], failCompile: false }));
vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three')>();
  return {
    ...actual,
    WebGLRenderer: class {
      domElement = document.createElement('canvas');
      debug = { checkShaderErrors: true, onShaderError: undefined };
      setPixelRatio = vi.fn();
      setSize = vi.fn();
      setClearColor = vi.fn();
      initTexture = vi.fn();
      compile = vi.fn<(scene: Scene, camera: Camera) => void>(() => {
        if (gpu.failCompile) throw new Error('Shader rejected');
      });
      render = vi.fn();
      dispose = vi.fn();
      forceContextLoss = vi.fn();
      constructor() { gpu.instances.push(this); }
    },
  };
});

const observers: Array<{ notify: () => void; disconnect: ReturnType<typeof vi.fn> }> = [];
let width = 640;
let height = 360;
const makeInput = () => {
  const stage = document.createElement('div');
  stage.getBoundingClientRect = () => ({ width, height } as DOMRect);
  const from = document.createElement('img');
  const to = document.createElement('img');
  from.src = '/from.png';
  to.src = '/to.png';
  for (const image of [from, to]) {
    Object.defineProperties(image, { naturalWidth: { value: 640 }, naturalHeight: { value: 360 } });
  }
  document.body.append(stage);
  return { stage, from, to };
};

beforeEach(() => {
  width = 640;
  height = 360;
  gpu.instances = [];
  gpu.failCompile = false;
  observers.length = 0;
  vi.stubGlobal('ResizeObserver', class {
    disconnect = vi.fn();
    constructor(notify: () => void) { observers.push({ notify, disconnect: this.disconnect }); }
    observe() {}
  });
});
afterEach(() => { document.body.replaceChildren(); vi.unstubAllGlobals(); });

describe.each([
  ['WaterDrop', createGlTransitionsAdapter],
] as const)('%s adapter ownership', (_name, create) => {
  it('shows exact source images at endpoints and GPU rendering between them', async () => {
    const input = makeInput();
    const adapter = await create(input);
    const canvas = input.stage.querySelector('canvas')!;
    const endpoints = [...input.stage.querySelectorAll('img')];
    expect(endpoints.map((image) => image.src)).toEqual([input.from.src, input.to.src]);
    expect(endpoints[0].hidden).toBe(false);
    expect(endpoints[1].hidden).toBe(true);
    expect(canvas.hidden).toBe(true);
    adapter.seek(0.5);
    expect(endpoints.every((image) => image.hidden)).toBe(true);
    expect(canvas.hidden).toBe(false);
    expect(gpu.instances[0].render).toHaveBeenCalled();
    adapter.seek(1);
    expect(endpoints[0].hidden).toBe(true);
    expect(endpoints[1].hidden).toBe(false);
    adapter.dispose();
  });

  it('redraws a mid-transition resize and releases every GPU resource exactly once', async () => {
    const input = makeInput();
    const sibling = document.createElement('span');
    input.stage.append(sibling);
    const adapter = await create(input);
    const renderer = gpu.instances[0];
    const scene = renderer.compile.mock.calls[0][0] as Scene;
    const disposal = vi.fn();
    const resources = new Set<object>();
    scene.traverse((object) => {
      if (!(object instanceof Mesh)) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const resource of [object.geometry, ...materials]) {
        resources.add(resource);
        resource.addEventListener('dispose', disposal);
      }
      for (const material of materials) {
        if (!(material instanceof ShaderMaterial)) continue;
        for (const uniform of Object.values(material.uniforms)) {
          const value: unknown = uniform.value;
          if (value instanceof Texture && !resources.has(value)) {
            resources.add(value);
            value.addEventListener('dispose', disposal);
          }
        }
      }
    });
    adapter.seek(0.4);
    width = 800;
    height = 800;
    observers[0].notify();
    expect(renderer.setSize).toHaveBeenLastCalledWith(800, 800, false);
    adapter.dispose();
    adapter.dispose();
    expect(disposal).toHaveBeenCalledTimes(resources.size);
    expect(renderer.dispose).toHaveBeenCalledTimes(1);
    expect(renderer.forceContextLoss).toHaveBeenCalledTimes(1);
    expect(observers[0].disconnect).toHaveBeenCalledTimes(1);
    expect([...input.stage.children]).toEqual([sibling]);
    const draws = renderer.render.mock.calls.length;
    adapter.seek(0.8);
    observers[0].notify();
    expect(renderer.render).toHaveBeenCalledTimes(draws);
  });

  it('cleans partial startup and surfaces shader compilation errors', async () => {
    const input = makeInput();
    gpu.failCompile = true;
    await expect(Promise.resolve().then(() => create(input))).rejects.toThrow('Shader rejected');
    expect(input.stage.children).toHaveLength(0);
    expect(gpu.instances[0].dispose).toHaveBeenCalledTimes(1);
    expect(gpu.instances[0].forceContextLoss).toHaveBeenCalledTimes(1);
  });

  it('rejects undecoded inputs without acquiring a GPU context', async () => {
    const input = makeInput();
    input.to = document.createElement('img');
    await expect(Promise.resolve().then(() => create(input))).rejects.toThrow('decoded');
    expect(gpu.instances).toHaveLength(0);
    expect(input.stage.children).toHaveLength(0);
  });

  it('surfaces resize-render errors on the next seek so the host can fall back', async () => {
    const adapter = await create(makeInput());
    adapter.seek(0.5);
    gpu.instances[0].render.mockImplementationOnce(() => { throw new Error('GPU draw failed'); });
    observers[0].notify();
    expect(() => adapter.seek(0.6)).toThrow('GPU draw failed');
    adapter.dispose();
  });

  it('reports context loss on the next seek and removes its listener before intentional loss', async () => {
    const input = makeInput();
    const adapter = await create(input);
    const canvas = input.stage.querySelector('canvas')!;
    const removeListener = vi.spyOn(canvas, 'removeEventListener');
    adapter.seek(0.5);
    canvas.dispatchEvent(new Event('webglcontextlost'));
    expect(() => adapter.seek(0.6)).toThrow('Transition WebGL context was lost.');
    gpu.instances[0].forceContextLoss.mockImplementation(() => {
      expect(removeListener).toHaveBeenCalledWith('webglcontextlost', expect.any(Function));
    });
    adapter.dispose();
    expect(() => adapter.seek(0.7)).not.toThrow();
  });
});

it('uses the selected upstream WaterDrop shader and defaults with live viewport dimensions', async () => {
  const adapter = await createGlTransitionsAdapter(makeInput());
  const scene = gpu.instances[0].compile.mock.calls[0][0] as Scene;
  const material = (scene.children[0] as Mesh<BufferGeometry, ShaderMaterial>).material;
  expect(material.fragmentShader).toContain('Author: Paweł Płóciennik');
  expect(material.uniforms.refraction.value).toBe(0.015);
  expect(material.uniforms.ratio.value).toBeCloseTo(640 / 360);
  adapter.seek(0.37);
  expect(material.uniforms.progress.value).toBe(0.37);
  adapter.seek(Number.NaN);
  expect(material.uniforms.progress.value).toBe(0);
  adapter.dispose();
});
