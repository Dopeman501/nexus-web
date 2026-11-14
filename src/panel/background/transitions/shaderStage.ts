// Promoted from the verified selected sampler engine; see PROVENANCE.md.
import {
  LinearFilter, Mesh, PerspectiveCamera, Scene, SRGBColorSpace, Texture, Vector2, WebGLRenderer,
} from 'three';
import type { BufferGeometry, Material, ShaderMaterial } from 'three';
import { clampProgress } from './engine';
import type { AdapterInput, TransitionAdapter } from './engine';
import { createPictureSurface, sourceDimensions, type PictureSurface } from './source';

interface Disposable { dispose(): void }
export interface ShaderStage {
  own(resource: Disposable): void;
  viewport: Vector2;
  uniforms: {
    progress: { value: number };
    viewport: { value: Vector2 };
    fromTexture: { value: Texture };
    toTexture: { value: Texture };
    imageFrom: { value: Vector2 };
    imageTo: { value: Vector2 };
    ratio: { value: number };
  };
  add(mesh: Mesh<BufferGeometry, ShaderMaterial>, scaleToStage?: boolean): void;
}

export const screenVertexShader = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

export const imageShader = `
uniform sampler2D fromTexture;
uniform sampler2D toTexture;
uniform vec2 viewport;
uniform vec2 imageFrom;
uniform vec2 imageTo;
uniform float progress;
uniform float ratio;
varying vec2 vUv;
vec2 coverUv(vec2 st, vec2 imageSize) {
  vec2 scale = min(vec2(
    (viewport.x / viewport.y) / (imageSize.x / imageSize.y),
    (viewport.y / viewport.x) / (imageSize.y / imageSize.x)
  ), vec2(1.0));
  return (st - 0.5) * scale + 0.5;
}
vec4 getFromColor(vec2 st) { return texture2D(fromTexture, coverUv(st, imageFrom)); }
vec4 getToColor(vec2 st) { return texture2D(toTexture, coverUv(st, imageTo)); }
`;

/** Owns one isolated GPU context; decoded media and playback belong to the caller. */
export function createShaderStage(
  input: AdapterInput,
  build: (stage: ShaderStage) => void,
): TransitionAdapter {
  if (input.signal?.aborted) throw new Error('Picture transition setup canceled.');
  const { stage, from, to } = input;
  [from, to].forEach(sourceDimensions);
  const resources = new Set<Disposable>();
  const scene = new Scene();
  const camera = new PerspectiveCamera(30, 1, 1, 10000);
  const viewport = new Vector2(1, 1);
  const scaledMeshes: Mesh[] = [];
  const surfaces: PictureSurface[] = [];
  let renderer: WebGLRenderer | undefined;
  let observer: ResizeObserver | undefined;
  let disposed = false;
  let current = 0;
  let failure: unknown;
  const onContextLost = () => {
    if (!disposed) failure = new Error('Transition WebGL context was lost.');
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    observer?.disconnect();
    scene.clear();
    for (const resource of resources) resource.dispose();
    resources.clear();
    renderer?.dispose();
    renderer?.domElement.removeEventListener('webglcontextlost', onContextLost);
    renderer?.forceContextLoss();
    renderer?.domElement.remove();
    surfaces.forEach(surface => surface.dispose());
  };
  try {
    for (const source of [from, to]) surfaces.push(createPictureSurface(source));
    const endpoints = surfaces.map(surface => surface.element);
    const texture = (surface: PictureSurface) => {
      const result = new Texture(surface.textureSource);
      if (surface.textureSource instanceof HTMLCanvasElement) {
        result.generateMipmaps = false; result.minFilter = LinearFilter;
      }
      result.colorSpace = SRGBColorSpace;
      result.needsUpdate = true;
      resources.add(result);
      return result;
    };
    const uniforms: ShaderStage['uniforms'] = {
      progress: { value: 0 }, viewport: { value: viewport }, ratio: { value: 1 },
      fromTexture: { value: texture(surfaces[0]) }, toTexture: { value: texture(surfaces[1]) },
      imageFrom: { value: new Vector2(surfaces[0].width, surfaces[0].height) },
      imageTo: { value: new Vector2(surfaces[1].width, surfaces[1].height) },
    };
    renderer = new WebGLRenderer({ alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0, 0);
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.debug.onShaderError = (gl, program, vertex, fragment) => {
      const diagnostic = [
        gl.getProgramInfoLog(program), gl.getShaderInfoLog(vertex), gl.getShaderInfoLog(fragment),
      ].filter(Boolean).join('\n').slice(0, 1200);
      throw new Error(`Transition shader compilation failed. ${diagnostic}`.trim());
    };
    renderer.domElement.addEventListener('webglcontextlost', onContextLost);
    renderer.domElement.dataset.pictureTransitionRenderer = '';
    renderer.domElement.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none';
    stage.append(renderer.domElement, ...endpoints);
    build({
      own(resource) { resources.add(resource); },
      viewport, uniforms,
      add(mesh, scaleToStage = true) {
        resources.add(mesh.geometry);
        const material: Material = mesh.material;
        resources.add(material);
        scene.add(mesh);
        if (scaleToStage) scaledMeshes.push(mesh);
      },
    });
    const draw = () => {
      if (disposed) return;
      if (failure) throw failure;
      const endpoint = current === 0 || current === 1;
      endpoints[0].hidden = current !== 0;
      endpoints[1].hidden = current !== 1;
      renderer!.domElement.hidden = endpoint;
      // Author display:block rules override the UA [hidden] rule in Chromium.
      // These cloned images/canvas belong to this stage, never to source CSS.
      endpoints[0].style.display = current === 0 ? 'block' : 'none';
      endpoints[1].style.display = current === 1 ? 'block' : 'none';
      renderer!.domElement.style.display = endpoint ? 'none' : 'block';
      if (!endpoint) renderer!.render(scene, camera);
    };
    const resize = () => {
      const bounds = stage.getBoundingClientRect();
      const width = Math.max(1, bounds.width);
      const height = Math.max(1, bounds.height);
      viewport.set(width, height);
      uniforms.ratio.value = width / height;
      renderer!.setSize(width, height, false);
      camera.aspect = width / height;
      camera.position.z = height / 2 / Math.tan(Math.PI / 12);
      camera.near = camera.position.z / 10;
      camera.far = camera.position.z * 10;
      camera.updateProjectionMatrix();
      scaledMeshes.forEach((mesh) => mesh.scale.set(width, height, 1));
      draw();
    };
    resize();
    renderer.initTexture(uniforms.fromTexture.value);
    renderer.initTexture(uniforms.toTexture.value);
    renderer.compile(scene, camera);
    observer = new ResizeObserver(() => {
      if (disposed) return;
      try { resize(); } catch (error) { failure = error; }
    });
    observer.observe(stage);
    return {
      seek(progress) {
        if (disposed) return;
        if (failure) throw failure;
        if (surfaces[1].refresh()) uniforms.toTexture.value.needsUpdate = true;
        current = clampProgress(progress);
        uniforms.progress.value = current;
        draw();
      },
      dispose,
    };
  } catch (error) {
    dispose();
    throw error;
  }
}
