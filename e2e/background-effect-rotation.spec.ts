import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseShaderParams, resolveParamUniforms } from '../src/lib/shaderParams';

test('background shader rotates and zooms about its centre without stretching or leaving holes', async ({ page }) => {
  const prelude = readFileSync(resolve('../nexus-service/src/Lighting/Engine/Gpu/Shaders/_prelude.frag'), 'utf8');
  expect(parseShaderParams(prelude).find(spec => spec.name === 'u_background_zoom'))
    .toMatchObject({ min: 0.1, max: 3, step: 0.05, defaultValue: 1 });
  const specs = new Map(parseShaderParams(prelude).map(spec => [spec.name, spec]));
  expect(resolveParamUniforms({ u_background_zoom: 4 }, specs).u_background_zoom).toBe(3);
  const result = await page.evaluate(source => {
    const canvas = document.createElement('canvas');
    canvas.width = 80; canvas.height = 40;
    const gl = canvas.getContext('webgl2')!;
    if (!gl) throw new Error('WebGL2 unavailable');
    const shader = (type: number, source: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, source); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)!);
      return s;
    };
    const program = gl.createProgram()!;
    gl.attachShader(program, shader(gl.VERTEX_SHADER, '#version 300 es\nvoid main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.0-1.0,0,1);}'));
    gl.attachShader(program, shader(gl.FRAGMENT_SHADER, source.replace('#version 330 core', '#version 300 es\nprecision highp float;') + `
      float outGain(){return 1.0;}
      void main(){vec2 p=(uv01()-0.5)*u_resolution;fragColor=vec4(p/100.0+0.5,0.25,1.0);}
    `));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program)!);
    gl.useProgram(program);
    gl.uniform2f(gl.getUniformLocation(program, 'u_resolution'), 80, 40);
    const angle = gl.getUniformLocation(program, 'u_background_rotation');
    const zoom = gl.getUniformLocation(program, 'u_background_zoom');
    const draw = (degrees?: number) => {
      if (degrees !== undefined) gl.uniform1f(angle, degrees);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      const pixels = new Uint8Array(80 * 40 * 4);
      gl.readPixels(0, 0, 80, 40, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      return pixels;
    };
    const sample = (pixels: Uint8Array, x: number, y: number) => Array.from(pixels.slice((y * 80 + x) * 4, (y * 80 + x) * 4 + 4));
    const legacy = draw();
    const zero = draw(0);
    const ninety = draw(90);
    const half = draw(180);
    const diagonal = draw(45);
    const full = draw(360);
    gl.uniform1f(zoom, 1);
    const neutralZoom = draw(0);
    gl.uniform1f(zoom, 2);
    const enlarged = draw(0);
    const enlargedRotated = draw(90);
    gl.uniform1f(zoom, 0.5);
    const reduced = draw(0);
    gl.uniform1f(zoom, 0.1);
    const minimum = draw(0);
    gl.uniform1f(zoom, 3);
    const maximum = draw(0);
    return {
      uniform: angle !== null,
      zoomUniform: zoom !== null,
      exactLegacy: legacy.every((v, i) => v === zero[i]),
      exactFullTurn: zero.every((v, i) => v === full[i]),
      exactNeutralZoom: zero.every((v, i) => v === neutralZoom[i]),
      enlarged: sample(enlarged, 60, 9), enlargedRotated: sample(enlargedRotated, 60, 9), reduced: sample(reduced, 60, 9),
      minimum: sample(minimum, 40, 19), maximum: sample(maximum, 60, 9),
      half: sample(half, 50, 14), halfExpected: sample(zero, 29, 25),
      ninety: sample(ninety, 50, 14), ninetyExpected: sample(zero, 45, 30),
      corners: [[0, 0], [79, 0], [0, 39], [79, 39]].map(([x, y]) => sample(diagonal, x, y)),
    };
  }, prelude);
  expect(result.uniform).toBe(true);
  expect(result.zoomUniform).toBe(true);
  expect(result.exactLegacy).toBe(true);
  expect(result.exactFullTurn).toBe(true);
  expect(result.exactNeutralZoom).toBe(true);
  expect(result.enlarged).toEqual([154, 141, 64, 255]);
  expect(result.enlargedRotated).toEqual([141, 101, 64, 255]);
  expect(result.reduced).toEqual([232, 181, 64, 255]);
  expect(result.minimum).toEqual([140, 140, 64, 255]);
  expect(result.maximum).toEqual([145, 136, 64, 255]);
  expect(result.half).toEqual(result.halfExpected);
  expect(result.ninety).toEqual(result.ninetyExpected);
  expect(result.corners.every(pixel => pixel[2] === 64 && pixel[3] === 255)).toBe(true);
});
