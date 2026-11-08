import { expect, test } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseShaderParams, resolveParamUniforms } from '../src/lib/shaderParams';

interface RuntimeSources {
  raw: string;
  composed: string;
  led: string;
  fixtures: { name: string; original: string; composed: string }[];
}

test('actual custom runtime and LED shaders rotate and zoom with neutral legacy pixels', async ({ page }, testInfo) => {
  const sourcePath = resolve(process.env.D215_CUSTOM_SOURCES ?? '../builds/custom-animation-spatial-20261108/runtime-sources.json');
  test.skip(!existsSync(sourcePath), 'Set D215_CUSTOM_SOURCES to an isolated native runtime-source export.');
  const sources = JSON.parse(readFileSync(sourcePath, 'utf8')) as RuntimeSources;
  const specs = new Map(parseShaderParams(sources.composed).map(spec => [spec.name, spec]));
  expect(specs.get('u_background_rotation')).toMatchObject({ min: 0, max: 360, defaultValue: 0 });
  expect(specs.get('u_background_zoom')).toMatchObject({ min: 0.1, max: 3, step: 0.05, defaultValue: 1 });
  expect(resolveParamUniforms({ u_background_zoom: 0 }, specs).u_background_zoom).toBe(0.1);
  expect(resolveParamUniforms({ u_background_zoom: 8 }, specs).u_background_zoom).toBe(3);
  const shader = (frag: string) => ({ frag, defaults: Object.fromEntries(parseShaderParams(frag)
    .filter(spec => spec.declared).map(spec => [spec.name, spec.defaultValue])) });
  const result = await page.evaluate(input => {
    const width = 80, height = 40;
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const gl = canvas.getContext('webgl2', { antialias: false, preserveDrawingBuffer: true });
    if (!gl) throw new Error('WebGL2 unavailable');
    gl.disable(gl.DITHER);
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const programs: WebGLProgram[] = [];
    const compile = (type: number, source: string) => {
      const compiled = gl.createShader(type)!;
      gl.shaderSource(compiled, source); gl.compileShader(compiled);
      if (!gl.getShaderParameter(compiled, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(compiled)!);
      return compiled;
    };
    const build = (source: typeof input.raw) => {
      const program = gl.createProgram()!;
      const vertex = compile(gl.VERTEX_SHADER, '#version 300 es\nvoid main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.0-1.0,0,1);}');
      const fragment = compile(gl.FRAGMENT_SHADER, source.frag.replace('#version 330 core',
        '#version 300 es\nprecision highp float;\nprecision highp int;'));
      gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program);
      gl.deleteShader(vertex); gl.deleteShader(fragment);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program)!);
      programs.push(program);
      return { program, defaults: source.defaults };
    };
    const draw = (source: ReturnType<typeof build>, angle = 0, zoom = 1, drawWidth = width, drawHeight = height) => {
      gl.useProgram(source.program);
      gl.viewport(0, 0, drawWidth, drawHeight);
      gl.uniform2f(gl.getUniformLocation(source.program, 'u_resolution'), width, height);
      for (const [name, value] of Object.entries({ u_time: 17.25, u_speed: 1, u_saturation: 1, u_contrast: 1,
        u_intensity: 1, ...source.defaults, u_background_rotation: angle, u_background_zoom: zoom })) {
        gl.uniform1f(gl.getUniformLocation(source.program, name), value);
      }
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      const pixels = new Uint8Array(drawWidth * drawHeight * 4);
      gl.readPixels(0, 0, drawWidth, drawHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      if (gl.getError() !== gl.NO_ERROR) throw new Error('WebGL draw/readback failed');
      return pixels;
    };
    const sample = (pixels: Uint8Array, x: number, y: number, rowWidth = width) =>
      [...pixels.slice((y * rowWidth + x) * 4, (y * rowWidth + x) * 4 + 4)];
    const same = (left: Uint8Array, right: Uint8Array) => left.every((value, index) => value === right[index]);
    const raw = build(input.raw), composed = build(input.composed);
    const original = draw(raw), neutral = draw(composed);
    const ninety = draw(composed, 90), fullTurn = draw(composed, 360);
    const enlarged = draw(composed, 0, 2), enlargedRotated = draw(composed, 90, 2);
    const minimum = draw(composed, 0, 0.1), maximum = draw(composed, 0, 3), diagonal = draw(composed, 45);
    // Exercise the exact emitted helper with nondefault z/w, independently of
    // this diagnostic fragment's colour output and the default raster depth.
    const helper = input.composed.frag.match(/vec4\s+(nexusPatternCoord_*)\(vec4 coord, vec2 resolution\)/)?.[1];
    if (!helper) throw new Error('The exported runtime helper is missing');
    const zwSource = input.composed.frag.replace('fragColor=vec4(p/100.0+0.5,0.25,1.0);',
      `fragColor=vec4(${helper}(vec4(gl_FragCoord.xy,0.125,0.75),u_resolution).zw,0.25,1.0);`);
    if (zwSource === input.composed.frag) throw new Error('The runtime diagnostic output has changed');
    const zw = draw(build({ ...input.composed, frag: zwSource }), 90, 2);
    const led = build(input.led);
    const taps = [[10, 5], [50, 14], [40, 19], [60, 9], [0, 0], [79, 39]];
    const texture = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, taps.length, 1, 0, gl.RGBA, gl.FLOAT,
      new Float32Array(taps.flatMap(([x, y]) => [x + 0.5, y + 0.5, 0, 1])));
    gl.useProgram(led.program);
    gl.uniform1i(gl.getUniformLocation(led.program, 'u_ledTap'), 0);
    gl.uniform1fv(gl.getUniformLocation(led.program, 'u_ledT[0]'), new Float32Array(32).fill(17.25));
    const ledNeutral = draw(led, 0, 1, taps.length, 2);
    const ledTransformed = draw(led, 90, 2, taps.length, 2);
    const fixtures = input.fixtures.map(fixture => {
      const before = draw(build(fixture.original));
      const after = draw(build(fixture.composed));
      return { name: fixture.name, exactNeutral: same(before, after) };
    });
    const output = {
      exactNeutral: same(original, neutral), exactRawZero: same(original, draw(composed, 0, 0)),
      exactFullTurn: same(original, fullTurn), ninety: sample(ninety, 50, 14), ninetyExpected: sample(original, 45, 30),
      enlarged: sample(enlarged, 60, 9), enlargedRotated: sample(enlargedRotated, 60, 9),
      minimum: sample(minimum, 40, 19), maximum: sample(maximum, 60, 9), zw: sample(zw, 40, 19),
      corners: [[0, 0], [79, 0], [0, 39], [79, 39]].map(([x, y]) => sample(diagonal, x, y)),
      ledNeutral: taps.map((_, index) => sample(ledNeutral, index, 0, taps.length)),
      ledExpected: taps.map(([x, y]) => sample(original, x, y)),
      ledTransformed: taps.map((_, index) => sample(ledTransformed, index, 1, taps.length)),
      ledTransformedExpected: taps.map(([x, y]) => sample(enlargedRotated, x, y)), fixtures,
    };
    gl.deleteTexture(texture);
    for (const program of programs) gl.deleteProgram(program);
    gl.deleteVertexArray(vao);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return output;
  }, { raw: shader(sources.raw), composed: shader(sources.composed), led: shader(sources.led),
    fixtures: sources.fixtures.map(fixture => ({ name: fixture.name, original: shader(fixture.original), composed: shader(fixture.composed) })) });
  expect(result.exactNeutral).toBe(true);
  expect(result.exactRawZero).toBe(true);
  expect(result.exactFullTurn).toBe(true);
  expect(result.ninety).toEqual(result.ninetyExpected);
  // Non-square pixel-space coordinates distinguish direction and stretching.
  expect(result.ninety).toEqual([142, 154, 64, 255]);
  expect(result.enlarged).toEqual([154, 114, 64, 255]);
  expect(result.enlargedRotated).toEqual([141, 154, 64, 255]);
  expect(result.minimum).toEqual([140, 115, 64, 255]);
  expect(result.maximum).toEqual([145, 119, 64, 255]);
  expect(result.zw).toEqual([32, 191, 64, 255]);
  expect(result.corners.every(pixel => pixel[2] === 64 && pixel[3] === 255)).toBe(true);
  expect(result.ledNeutral).toEqual(result.ledExpected);
  expect(result.ledTransformed).toEqual(result.ledTransformedExpected);
  expect(result.fixtures).toHaveLength(6);
  expect(result.fixtures.filter(fixture => !fixture.exactNeutral)).toEqual([]);
  await testInfo.attach('custom-runtime-pixels.json', { body: JSON.stringify(result, null, 2), contentType: 'application/json' });
});
