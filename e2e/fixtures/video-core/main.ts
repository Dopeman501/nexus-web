import { loadPictureTransitionFactory } from '../../../src/panel/background/transitions/engineLoader';
import type { AdapterFactory, TransitionAdapter } from '../../../src/panel/background/transitions/engine';

type Source = HTMLImageElement | HTMLCanvasElement | HTMLVideoElement;
const stage = document.querySelector<HTMLDivElement>('#stage')!;
const clips = { mp4: new URL('../../../.playwright/video-media/mp4-a.mp4', import.meta.url).href,
  webm: new URL('../../../.playwright/video-media/webm.webm', import.meta.url).href };
const sources: HTMLVideoElement[] = [];
let from: Source, to: Source, active: TransitionAdapter | null = null;
const image = async (fill: string) => {
  const result = new Image(); result.className = 'backgroundMediaContent';
  result.src = 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="320" height="144"><rect width="320" height="144" fill="${fill}"/><circle cx="90" cy="70" r="50" fill="#f9d36b"/><path d="M160 0L320 144H250L140 0" fill="#75d8e8"/></svg>`);
  await result.decode(); return result;
};
async function video(kind: keyof typeof clips) {
  const result = document.createElement('video'); result.className = 'source backgroundMediaContent';
  result.muted = true; result.loop = true; result.playsInline = true; sources.push(result); result.src = clips[kind]; document.body.append(result);
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Fixture video did not decode')), 4000);
    result.oncanplay = () => { clearTimeout(timeout); resolve(); };
    result.onerror = () => { clearTimeout(timeout); reject(new Error('Fixture video decode failed')); };
  });
  await result.play(); await new Promise(resolve => result.requestVideoFrameCallback(resolve)); return result;
}
function snapshot(source: Source, width = 640, height = 288) {
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  canvas.getContext('2d')!.drawImage(source, 0, 0, width, height); return canvas;
}
function release(video: HTMLVideoElement) { video.pause(); video.removeAttribute('src'); video.load(); video.remove(); }
async function disposeAdapter() { await active?.dispose(); active = null; return stage.childElementCount; }
async function clear() { await disposeAdapter(); sources.forEach(release); sources.length = 0; }
const api = {
  async mount(effect: string, pair: string) {
    await clear();
    from = pair.startsWith('video') ? await video('mp4') : await image('#81223f');
    if (from instanceof HTMLVideoElement) {
      await new Promise(resolve => setTimeout(resolve, 200));
      const frozen = snapshot(from, from.videoWidth, from.videoHeight); release(from); from = frozen;
    }
    to = pair.endsWith('video') ? await video(pair === 'video-video' ? 'webm' : 'mp4') : await image('#105c92');
    const factory = await loadPictureTransitionFactory(effect);
    active = await factory({ stage, from, to } as Parameters<AdapterFactory>[0]);
    return { canPlayMp4: document.createElement('video').canPlayType('video/mp4;codecs="avc1.4d401e"'), canPlayWebM: document.createElement('video').canPlayType('video/webm;codecs="vp8"') };
  },
  seek(progress: number) {
    active!.seek(progress);
    return { from: snapshot(from).toDataURL(), to: snapshot(to).toDataURL(), time: to instanceof HTMLVideoElement ? to.currentTime : null };
  },
  disposeAdapter, clear,
};
(window as unknown as { videoCore: typeof api }).videoCore = api;
