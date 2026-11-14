import gsapUrl from './vendor/js/gsap.min.js?url';
import './vendor/css/base.css';
import { codropsOptions } from './catalogue';
import { slideMarkup } from './markup';
import { channel, isFrameCommand, localImageUrl } from './protocol';
import { ownFrameResources } from './resources';

interface Disposable { dispose(): void }
interface Timeline {
  progress(value: number, suppressEvents?: boolean): Timeline;
  pause(): Timeline;
  kill(): void;
  clear(): void;
  getChildren(nested: boolean, tweens: boolean, timelines: boolean): Timeline[];
}
interface Gsap {
  globalTimeline: Timeline;
  ticker: { sleep(): void };
  set(targets: Element[], properties: Record<string, unknown>): void;
}
interface Stage {
  init(slides: HTMLElement[]): Promise<void>;
  compile(): Promise<void>;
  render(): void;
  resize(): void;
  isSoftware(): boolean;
  isLost: boolean;
  onLost(): void;
  textures: Disposable[];
  scene: { traverse(visitor: (object: { geometry?: Disposable; material?: Disposable | Disposable[] }) => void): void; clear(): void };
  renderer: Disposable;
}
interface Slideshow {
  current: number;
  isAnimating: boolean;
  isReady?: boolean;
  stage?: Stage;
  worker?: Worker | null;
  playing?: unknown;
  stirring?: unknown;
  cellData?: Disposable;
  flowData?: Disposable;
  next(): void;
}
type SlideshowModule = { Slideshow: new (element: HTMLElement) => Slideshow };
type StageModule = { Stage: { prototype: Stage } };
const demos = import.meta.glob<SlideshowModule>('./vendor/js/demo*/slideshow.js');
const support = import.meta.glob<StageModule>('./vendor/js/webgl/Stage.js');
const parameters = new URLSearchParams(window.location.hash.slice(1));
const id = parameters.get('id') ?? '';
const nonce = parameters.get('nonce') ?? '';
const index = codropsOptions.findIndex(effect => effect.id === id);
const origin = window.location.origin;
const resources = ownFrameResources();
const stages = new Set<Stage>();
const originalRandom = Math.random;
let randomState = 0x1a2b3c4d;
Math.random = () => { randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0; return randomState / 0x100000000; };
let slideshow: Slideshow | undefined;
let gsap: Gsap | undefined;
let timeline: Timeline | undefined;
let firstStirring: unknown;
let initialising = false;
let currentProgress = -1;
let stageFailure: Error | undefined;
let snapshots: { element: HTMLElement; style: string | null; className: string }[] = [];

function reply(kind: 'boot' | 'ready' | 'disposed' | 'error', message?: string) {
  window.parent.postMessage({ channel, nonce, id, kind, ...(message ? { message } : {}) }, origin);
}

function disposeStage(stage: Stage) {
  stage.textures.forEach(texture => texture.dispose());
  stage.scene.traverse(object => {
    object.geometry?.dispose();
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    materials.forEach(material => material?.dispose());
  });
  stage.scene.clear();
  try { stage.renderer.dispose(); }
  catch (error) { console.warn('Codrops preview renderer cleanup deferred until initialization settles.', error); }
}

function dispose() {
  if (resources.disposed) return;
  timeline?.kill();
  gsap?.ticker.sleep();
  slideshow?.worker?.terminate();
  slideshow?.cellData?.dispose();
  slideshow?.flowData?.dispose();
  stages.forEach(disposeStage);
  resources.dispose();
  Math.random = originalRandom;
}

/** Keep late asynchronous renderer initialization from constructing a scene after retirement. */
async function prepareStage() {
  const { Stage } = await support['./vendor/js/webgl/Stage.js']();
  const init = Stage.prototype.init;
  const compile = Stage.prototype.compile;
  const render = Stage.prototype.render;
  const resize = Stage.prototype.resize;
  Stage.prototype.init = async function (images) {
    stages.add(this);
    try { await init.call(this, images); }
    catch (error) { stageFailure = error instanceof Error ? error : new Error('Codrops GPU initialization failed.'); throw error; }
    finally { if (resources.disposed) disposeStage(this); }
    if (resources.disposed) throw new DOMException('Preview retired.', 'AbortError');
  };
  Stage.prototype.compile = async function () {
    try { await compile.call(this); }
    catch (error) { stageFailure = error instanceof Error ? error : new Error('Codrops GPU compilation failed.'); throw error; }
    if (resources.disposed) { disposeStage(this); throw new DOMException('Preview retired.', 'AbortError'); }
  };
  Stage.prototype.render = function () { if (!resources.disposed) render.call(this); };
  Stage.prototype.resize = function () { if (!resources.disposed) resize.call(this); };
  // Preview only: upstream declines software GPUs. A paused sampler can render them more slowly.
  Stage.prototype.isSoftware = () => false;
}

async function loadGsap() {
  const script = document.createElement('script');
  script.src = gsapUrl;
  await new Promise<void>((resolve, reject) => {
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('The local GSAP runtime could not load.'));
    document.head.append(script);
  });
  gsap = (window as unknown as { gsap: Gsap }).gsap;
  gsap.globalTimeline.pause();
  gsap.ticker.sleep();
}

async function waitForGpu() {
  const deadline = performance.now() + 25_000;
  while (!slideshow?.isReady) {
    if (resources.disposed) throw new DOMException('Preview retired.', 'AbortError');
    if (stageFailure) throw stageFailure;
    if (performance.now() >= deadline) throw new Error('The original Codrops GPU effect did not become ready; no crossfade is being substituted.');
    await new Promise<void>(resolve => window.setTimeout(resolve, 20));
  }
}

function restoreInitialDom() {
  timeline?.kill();
  gsap!.globalTimeline.clear();
  for (const { element, style, className } of snapshots) {
    if (style === null) element.removeAttribute('style'); else element.setAttribute('style', style);
    element.className = className;
    const cache = (element as HTMLElement & { _gsap?: { uncache: number } })._gsap;
    if (cache) cache.uncache = 1;
  }
  slideshow!.current = 0;
  slideshow!.isAnimating = false;
  if (firstStirring) slideshow!.stirring = firstStirring;
}

function makeTimeline() {
  randomState = 0x31415926;
  const before = new Set(gsap!.globalTimeline.getChildren(false, false, true));
  slideshow!.next();
  timeline = gsap!.globalTimeline.getChildren(false, false, true).find(child => !before.has(child));
  if (!timeline) throw new Error('The original Codrops demo did not create its transition timeline.');
  timeline.pause().progress(0, true);
  firstStirring ??= slideshow!.playing;
  gsap!.ticker.sleep();
}

function seek(progress: number) {
  if (!timeline || resources.disposed) return;
  if (slideshow?.stage?.isLost) throw new Error('The Codrops preview GPU context was lost.');
  // Original callbacks also switch DOM classes mid-animation. Rebuild only on a backwards seek,
  // restoring their exact baseline so a slider/replay cannot retain a later callback's state.
  if (progress < currentProgress) { restoreInitialDom(); makeTimeline(); }
  timeline!.progress(progress, false);
  slideshow?.stage?.render();
  // Upstream callbacks use immediate gsap.set() calls; retire their completed root tweens.
  gsap!.globalTimeline.getChildren(false, true, false).forEach(tween => tween.kill());
  gsap!.ticker.sleep();
  currentProgress = progress;
}

async function initialise(from: string, to: string) {
  if (initialising || resources.disposed) return;
  initialising = true;
  const sources = [localImageUrl(from, origin), localImageUrl(to, origin)];
  document.body.className = `demo-${index + 1}`;
  const preview = document.getElementById('preview')!;
  // Static, pinned upstream slide markup. No external HTML or user input enters innerHTML.
  preview.innerHTML = slideMarkup[index];
  preview.querySelectorAll<HTMLElement>('.slide__img').forEach((element, imageIndex) => {
    element.style.backgroundImage = `url(${JSON.stringify(sources[imageIndex % 2])})`;
  });
  await Promise.all(sources.map(async source => { const image = new Image(); image.src = source; await image.decode(); }));
  if (resources.disposed) return;
  await loadGsap();
  if (resources.disposed) { gsap?.ticker.sleep(); return; }
  if (index >= 16 && index <= 21) await prepareStage();
  const module = await demos[`./vendor/js/demo${index + 1}/slideshow.js`]();
  if (resources.disposed) return;
  slideshow = new module.Slideshow(preview.querySelector<HTMLElement>('.slides')!);
  if (slideshow.stage) {
    const stage = slideshow.stage;
    const onLost = stage.onLost;
    stage.onLost = () => {
      onLost.call(stage);
      if (!resources.disposed) reply('error', 'The original Codrops preview GPU context was lost.');
    };
  }
  if (slideshow.stage) await waitForGpu();
  if (resources.disposed) return;
  snapshots = [...preview.querySelectorAll<HTMLElement>('*')].map(element => ({
    element, style: element.getAttribute('style'), className: element.className,
  }));
  makeTimeline();
  reply('ready');
}

window.addEventListener('message', event => {
  if (event.source !== window.parent || event.origin !== origin || !isFrameCommand(event.data, nonce, id)) return;
  const command = event.data;
  if (command.kind === 'dispose') { dispose(); reply('disposed'); return; }
  if (resources.disposed) return;
  if (command.kind === 'seek') {
    try { seek(command.progress); } catch (error) { reply('error', error instanceof Error ? error.message : 'Codrops seek failed.'); }
  } else if (command.kind === 'init') {
    void initialise(command.from, command.to).catch(error => {
      if (!resources.disposed) reply('error', error instanceof Error ? error.message : 'Codrops initialization failed.');
    });
  }
});
window.addEventListener('pagehide', dispose, { once: true });
if (index >= 0 && /^[a-zA-Z0-9-]{16,80}$/.test(nonce)) reply('boot');
else { dispose(); throw new Error('Invalid local Codrops preview session.'); }
