// Promoted from the verified selected sampler engine; see PROVENANCE.md.
import GLTransitions from 'gl-transitions';
import { GLSL3, Mesh, PlaneGeometry, ShaderMaterial } from 'three';
import type { IUniform } from 'three';
import type { AdapterFactory } from './engine';
import { createGlMask } from './glTransitionMasks';
import { createGlParameterUniforms } from './glTransitionParams';
import { createShaderStage, imageShader, screenVertexShader } from './shaderStage';

// These are the package's generated and upstream-compiled WebGL2 sources. Do not
// rewrite arbitrary tokens: built-in functions and identifier scopes must survive.
const glsl3Sources = import.meta.glob<string>('../../../../node_modules/gl-transitions/glsl3/*.glsl', {
  query: '?raw', import: 'default', eager: true,
});

export const glTransitionOptions = Object.freeze(GLTransitions.map((effect) => Object.freeze({
  name: effect.name,
  label: effect.name.replace(/([a-z0-9])([A-Z])/g, '$1 $2'),
  description: effect.description ?? '',
  author: effect.author,
  license: effect.license,
  tags: Object.freeze([...effect.tags]),
})));

/** Each entry retains its upstream source, defaults and MIT/BSD licence metadata. */
export function createGlTransitionsAdapterFor(name: string): AdapterFactory {
  const effect = GLTransitions.find((transition) => transition.name === name);
  if (!effect) throw new Error(`Unknown GL transition: ${name}`);
  const source = glsl3Sources[`../../../../node_modules/gl-transitions/glsl3/${name}.glsl`];
  if (!source) throw new Error(`The installed GLSL3 source is missing for ${name}.`);
  return (input) => createShaderStage(input, ({ uniforms, add, own }) => {
    const auxiliary: Record<string, IUniform> = {};
    for (const sampler of effect.textures) {
      const mask = createGlMask(sampler);
      own(mask);
      auxiliary[sampler] = { value: mask };
    }
    const material = new ShaderMaterial({
      uniforms: { ...uniforms, ...createGlParameterUniforms(effect), ...auxiliary },
      glslVersion: GLSL3,
      vertexShader: screenVertexShader,
      fragmentShader: `out highp vec4 labFragmentColor;
        #define gl_FragColor labFragmentColor
        ${imageShader}\n${source}\nvoid main() {
        gl_FragColor = transition(vUv);
        #include <colorspace_fragment>
      }`,
      depthTest: false,
      depthWrite: false,
      transparent: true,
    });
    add(new Mesh(new PlaneGeometry(1, 1), material));
  });
}

/** Compatibility entry point for the original five-sample comparison. */
export const createGlTransitionsAdapter: AdapterFactory = createGlTransitionsAdapterFor('WaterDrop');
