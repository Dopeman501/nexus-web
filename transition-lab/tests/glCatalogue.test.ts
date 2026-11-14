import { afterEach, describe, expect, it, vi } from 'vitest';
import GLTransitions from 'gl-transitions';
import { DataTexture, GLSL3, Texture, Vector2, Vector3, Vector4 } from 'three';
import type { Mesh, ShaderMaterial } from 'three';
import type { AdapterInput } from '../adapter';
import type { ShaderStage } from '../adapters/shaderStage';
import {
  createGlTransitionsAdapter, createGlTransitionsAdapterFor, glTransitionOptions,
} from '../adapters/glTransitions';

const captured = vi.hoisted(() => ({ meshes: [] as Mesh[], owned: [] as Array<{ dispose(): void }> }));
vi.mock('../adapters/shaderStage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../adapters/shaderStage')>();
  return {
    ...actual,
    createShaderStage: (_input: AdapterInput, build: (stage: ShaderStage) => void) => {
      const viewport = new Vector2(640, 360);
      build({
        viewport,
        uniforms: {
          progress: { value: 0 }, viewport: { value: viewport }, ratio: { value: 640 / 360 },
          fromTexture: { value: new Texture() }, toTexture: { value: new Texture() },
          imageFrom: { value: new Vector2(640, 360) }, imageTo: { value: new Vector2(640, 360) },
        },
        add(mesh) { captured.meshes.push(mesh); },
        own(resource) { captured.owned.push(resource); },
      });
      return {
        seek() {},
        dispose() {
          captured.meshes.forEach((mesh) => {
            mesh.geometry.dispose();
            const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
            materials.forEach((material) => material.dispose());
          });
          captured.owned.forEach((resource) => resource.dispose());
        },
      };
    },
  };
});

const input = () => ({ stage: document.createElement('div'), from: new Image(), to: new Image() });
afterEach(() => { captured.meshes = []; captured.owned = []; });
const uniformComponents = (value: unknown): unknown => {
  if (value instanceof Vector2 || value instanceof Vector3 || value instanceof Vector4) return value.toArray();
  if (value instanceof Int32Array || value instanceof Float32Array) return Array.from(value);
  return value;
};

it('exposes all 214 installed names and their own licence/author metadata without mutable arrays', () => {
  expect(glTransitionOptions).toHaveLength(214);
  expect(glTransitionOptions.map((entry) => entry.name)).toEqual(GLTransitions.map((entry) => entry.name));
  for (const entry of glTransitionOptions) {
    const upstream = GLTransitions.find((transition) => transition.name === entry.name)!;
    expect(entry.author).toBe(upstream.author);
    expect(entry.license).toBe(upstream.license);
    expect(entry.description).toBe(upstream.description ?? '');
    expect(entry.tags).toEqual(upstream.tags);
    expect(Object.isFrozen(entry.tags)).toBe(true);
  }
  expect(Object.isFrozen(glTransitionOptions)).toBe(true);
});

it('rejects unknown names before allocating any drawing resources', () => {
  expect(() => createGlTransitionsAdapterFor('MissingShader')).toThrow('Unknown GL transition');
  expect(captured.meshes).toHaveLength(0);
});

describe.each(GLTransitions)('$name installed defaults', (effect) => {
  it('uses the generated GLSL3 source and binds every declared parameter with all components', async () => {
    const original = JSON.stringify(effect.defaultParams);
    const adapter = await createGlTransitionsAdapterFor(effect.name)(input());
    const material = captured.meshes[0].material as ShaderMaterial;
    expect(material.glslVersion).toBe(GLSL3);
    expect(material.fragmentShader).toContain(`// ${effect.name} — GLSL ES 3.00`);
    expect(material.fragmentShader).toContain('gl_FragColor = transition(vUv)');
    for (const [name, expected] of Object.entries(effect.defaultParams)) {
      expect(uniformComponents(material.uniforms[name].value)).toEqual(expected);
    }
    expect(JSON.stringify(effect.defaultParams)).toBe(original);
    adapter.dispose();
  });
});

it.each([
  ['DisplacementMap', 'displacementMap'], ['LumaWipe', 'luma'],
])('%s supplies a deterministic local mask owned by the adapter', async (name, sampler) => {
  const adapter = await createGlTransitionsAdapterFor(name)(input());
  const material = captured.meshes[0].material as ShaderMaterial;
  const texture = material.uniforms[sampler].value as DataTexture;
  expect(texture).toBeInstanceOf(DataTexture);
  expect(texture.image.width).toBe(64);
  expect(texture.image.height).toBe(64);
  expect(captured.owned).toContain(texture);
  expect(new Set(texture.image.data).size).toBeGreaterThan(20);
  const bytes = new Uint8Array(texture.image.data!);
  const dispose = vi.fn();
  texture.addEventListener('dispose', dispose);
  adapter.dispose();
  expect(dispose).toHaveBeenCalledTimes(1);
  captured.meshes = [];
  captured.owned = [];
  const again = await createGlTransitionsAdapterFor(name)(input());
  const other = (captured.meshes[0].material as ShaderMaterial).uniforms[sampler].value as DataTexture;
  expect(other.image.data).toEqual(bytes);
  again.dispose();
});

it('retains the original WaterDrop factory entry point', async () => {
  const adapter = await createGlTransitionsAdapter(input());
  expect((captured.meshes[0].material as ShaderMaterial).fragmentShader).toContain('Author: Paweł Płóciennik');
  adapter.dispose();
});
