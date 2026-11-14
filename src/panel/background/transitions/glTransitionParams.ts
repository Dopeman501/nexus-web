// Promoted from the verified selected sampler engine; see PROVENANCE.md.
import { Vector2, Vector3, Vector4 } from 'three';
import type { ParamType, ParamValue, Transition } from 'gl-transitions';

type UniformValue = number | boolean | Vector2 | Vector3 | Vector4 | Int32Array | Float32Array;

/** Preserve every component and scalar type from the installed shader contract. */
export function bindGlParameter(type: ParamType, value: ParamValue | undefined): UniformValue {
  if (type === 'bool') {
    if (typeof value !== 'boolean') throw new Error('GL boolean default must be a boolean.');
    return value;
  }
  if (type === 'int' || type === 'float') {
    if (typeof value !== 'number' || !Number.isFinite(value) || (type === 'int' && !Number.isInteger(value))) {
      throw new Error(`Invalid GL ${type} default.`);
    }
    return value;
  }
  const components: Record<string, number> = {
    vec2: 2, vec3: 3, vec4: 4, ivec2: 2, ivec3: 3, ivec4: 4, mat2: 4, mat3: 9, mat4: 16,
  };
  const count = components[type];
  if (!Array.isArray(value) || !count || value.length !== count || value.some((part) => !Number.isFinite(part))) {
    throw new Error(`Invalid GL ${type} default components.`);
  }
  if (type.startsWith('ivec')) {
    if (value.some((part) => !Number.isInteger(part))) throw new Error(`Invalid GL ${type} integer component.`);
    return new Int32Array(value);
  }
  if (type.startsWith('mat')) return new Float32Array(value);
  if (type === 'vec2') return new Vector2(value[0], value[1]);
  if (type === 'vec3') return new Vector3(value[0], value[1], value[2]);
  return new Vector4(value[0], value[1], value[2], value[3]);
}

export const createGlParameterUniforms = (effect: Transition): Record<string, { value: UniformValue }> =>
  Object.fromEntries(Object.entries(effect.paramsTypes).map(([name, type]) => [
    name, { value: bindGlParameter(type, effect.defaultParams[name]) },
  ]));
