// Promoted from the verified selected sampler engine; see PROVENANCE.md.
import { Curtains, Plane } from 'curtainsjs';
import { clampProgress, type AdapterFactory, type AdapterInput, type TransitionAdapter } from './engine';
import { curtainsPresetOptions } from './catalogue';
import { createPictureSurface, sourceDimensions, type PictureSurface } from './source';
import type { Texture } from 'curtainsjs';

/** Authored image presets; Curtains itself has no finite transition catalogue. */
export { curtainsPresetOptions } from './catalogue';

const vertexShader = `precision mediump float;
attribute vec3 aVertexPosition;
attribute vec3 aTextureCoord;
uniform mat4 uMVMatrix;
uniform mat4 uPMatrix;
uniform mat4 uFromMatrix;
uniform mat4 uToMatrix;
varying vec2 vFrom;
varying vec2 vTo;
void main() {
  gl_Position = uPMatrix * uMVMatrix * vec4(aVertexPosition, 1.0);
  vFrom = (uFromMatrix * vec4(aTextureCoord, 1.0)).xy;
  vTo = (uToMatrix * vec4(aTextureCoord, 1.0)).xy;
}`;

const fragmentShader = `precision mediump float;
uniform sampler2D uFrom;
uniform sampler2D uTo;
uniform float uProgress;
uniform float uMode;
varying vec2 vFrom;
varying vec2 vTo;
void main() {
  float wave = sin(vFrom.y * 23.0 + vFrom.x * 8.0) * cos(vFrom.x * 17.0);
  float bend = sin(uProgress * 3.14159265) * 0.12;
  vec2 shift = vec2(wave * bend, sin(vFrom.x * 19.0) * bend * 0.3);
  vec2 centered = vFrom - 0.5;
  float distance = length(centered);
  if (uMode > 0.5 && uMode < 1.5) shift = vec2(sin(vFrom.y * 12.0 + wave * 3.0), cos(vFrom.x * 13.0 - wave * 2.0)) * bend;
  if (uMode > 1.5 && uMode < 2.5) shift = normalize(centered + 0.0001) * sin(distance * 65.0 - uProgress * 16.0) * bend * 0.4;
  if (uMode > 2.5 && uMode < 3.5) {
    float angle = bend * 12.0 * (1.0 - min(distance, 0.7));
    shift = mat2(cos(angle), -sin(angle), sin(angle), cos(angle)) * centered - centered;
  }
  if (uMode > 3.5 && uMode < 4.5) shift = centered * bend * 2.5;
  if (uMode > 6.5 && uMode < 7.5) shift = vec2(sin(vFrom.y * 45.0 + uProgress * 8.0) * bend, 0.0);
  if (uMode > 7.5 && uMode < 8.5) shift = vec2(0.0, sin(vFrom.x * 45.0 + uProgress * 8.0) * bend);
  if (uMode > 8.5 && uMode < 9.5) shift = vec2(sin((vFrom.x + vFrom.y) * 45.0) * bend);
  if (uMode > 9.5 && uMode < 10.5) shift = vec2(-centered.y, centered.x) * sin(distance * 12.0) * bend * 4.0;
  if (uMode > 10.5) shift = vec2(0.0, sin(vFrom.x * 19.0) * bend * 2.0);
  vec2 fromUv = vFrom + shift;
  vec2 toUv = vTo - shift;
  if (uMode > 5.5 && uMode < 6.5) {
    float grid = max(4.0, 180.0 * (1.0 - sin(uProgress * 3.14159265)));
    fromUv = (floor(fromUv * grid) + 0.5) / grid;
    toUv = (floor(toUv * grid) + 0.5) / grid;
  }
  vec4 outgoing = texture2D(uFrom, fromUv);
  vec4 incoming = texture2D(uTo, toUv);
  if (uMode > 4.5 && uMode < 5.5) {
    outgoing.r = texture2D(uFrom, fromUv + vec2(bend, 0.0)).r;
    incoming.b = texture2D(uTo, toUv - vec2(bend, 0.0)).b;
  }
  gl_FragColor = mix(outgoing, incoming, uProgress);
}`;

/** Actual Curtains Plane/textures, manually rendered only while loading or seeking. */
export const createCurtainsAdapter: AdapterFactory = input => createCurtainsSample(input, 0);

export function createCurtainsAdapterFor(id: string): AdapterFactory {
  const mode = curtainsPresetOptions.findIndex(preset => preset.id === id);
  if (mode < 0) throw new Error('Unknown Curtains preset');
  return input => createCurtainsSample(input, mode);
}

async function createCurtainsSample({ stage, from, to, signal }: AdapterInput, mode: number): Promise<TransitionAdapter> {
  if (signal?.aborted) throw new Error('Curtains setup canceled');
  [from, to].forEach(sourceDimensions);
  const planeElement = document.createElement('div');
  planeElement.style.cssText = 'position:absolute;inset:0';
  stage.append(planeElement);
  const surfaces: PictureSurface[] = [];
  const canvasTextures: Array<Texture | undefined> = [];
  let curtains: Curtains | undefined;
  let plane: Plane | undefined;
  let observer: ResizeObserver | undefined;
  let disposed = false;
  let cleanup: Promise<void> | null = null;
  let loadFrame = 0;
  let failure: Error | null = null;
  let progress = 0;
  const contextLost = () => { if (!disposed) failure = new Error('Curtains WebGL context was lost'); };
  const dispose = () => {
    if (cleanup) return cleanup;
    disposed = true;
    cancelAnimationFrame(loadFrame);
    observer?.disconnect();
    curtains?.canvas?.removeEventListener('webglcontextlost', contextLost);
    const detach = () => {
      curtains?.canvas?.remove();
      planeElement.remove();
      surfaces.forEach(surface => surface.dispose());
    };
    if (!curtains?.gl) {
      detach();
      cleanup = Promise.resolve();
      return cleanup;
    }
    plane?.remove();
    curtains?.disableDrawing();
    curtains?.dispose();
    // Curtains 8.1.6 enqueues deletion via a zero-delay task before nextRender.
    cleanup = new Promise<void>((resolve, reject) => window.setTimeout(() => {
      try { curtains?.render(); resolve(); } catch (error) { reject(error); } finally { detach(); }
    }, 0));
    return cleanup;
  };
  try {
    for (const source of [from, to]) surfaces.push(createPictureSurface(source));
    const endpoints = surfaces.map(surface => surface.element);
    stage.append(...endpoints);
    curtains = new Curtains({ container: stage, autoRender: false, watchScroll: false, pixelRatio: 1, production: true });
    const fail = () => { failure = new Error('Curtains WebGL renderer unavailable or lost'); };
    curtains.onError(fail).onContextLost(fail);
    if (!curtains.gl) throw new Error('Curtains WebGL renderer unavailable');
    curtains.canvas.addEventListener('webglcontextlost', contextLost);
    curtains.canvas.dataset.pictureTransitionRenderer = '';
    curtains.canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%';
    plane = new Plane(curtains, planeElement, { vertexShader, fragmentShader, autoloadSources: false,
      uniforms: { progress: { name: 'uProgress', type: '1f', value: 0 }, mode: { name: 'uMode', type: '1f', value: mode } } });
    plane.onError(fail);
    let loaded = 0;
    for (const [index, surface] of surfaces.entries()) {
      const sampler = index === 0 ? 'uFrom' : 'uTo';
      if (surface.textureSource instanceof HTMLImageElement) {
        plane.loadImage(surface.textureSource, { sampler }, () => loaded++, fail);
      } else {
        plane.loadCanvas(surface.textureSource, { sampler }, texture => {
          canvasTextures[index] = texture;
          texture.shouldUpdate = false;
          texture.needUpdate();
          loaded++;
        });
      }
    }
    await new Promise<void>((resolve, reject) => {
      let done = false;
      const finish = (error?: Error) => {
        if (done) return;
        done = true;
        cancelAnimationFrame(loadFrame);
        window.clearTimeout(deadline);
        signal?.removeEventListener('abort', canceled);
        if (error) reject(error); else resolve();
      };
      const canceled = () => finish(new Error('Curtains setup canceled'));
      const deadline = window.setTimeout(() => finish(new Error('Curtains texture readiness timed out')), 3000);
      signal?.addEventListener('abort', canceled, { once: true });
      const pump = () => {
        if (done) return;
        if (signal?.aborted) { canceled(); return; }
        if (failure) { finish(failure); return; }
        try { curtains!.render(); } catch (error) { finish(new Error(String(error))); return; }
        if (failure) { finish(failure); return; }
        if (loaded === 2) finish();
        else loadFrame = requestAnimationFrame(pump);
      };
      loadFrame = requestAnimationFrame(pump);
    });
    const seek = (value: number) => {
      if (disposed) return;
      if (failure) throw failure;
      if (surfaces[1].refresh()) canvasTextures[1]?.needUpdate();
      progress = clampProgress(value);
      endpoints[0].hidden = progress !== 0;
      endpoints[1].hidden = progress !== 1;
      curtains!.canvas.hidden = progress === 0 || progress === 1;
      endpoints[0].style.display = progress === 0 ? 'block' : 'none';
      endpoints[1].style.display = progress === 1 ? 'block' : 'none';
      curtains!.canvas.style.display = progress === 0 || progress === 1 ? 'none' : 'block';
      plane!.uniforms.progress.value = progress;
      curtains!.render();
      if (failure) throw failure;
    };
    observer = new ResizeObserver(() => {
      if (disposed) return;
      try { curtains!.resize(); seek(progress); } catch (error) {
        failure = error instanceof Error ? error : new Error(String(error));
      }
    });
    observer.observe(stage);
    seek(0);
    return { seek, dispose };
  } catch (error) {
    await dispose();
    throw error;
  }
}
