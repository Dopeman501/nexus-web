import type { Page } from '@playwright/test';

export interface VideoObservation {
  peakSources: number; peakPlaying: number;
  events: { action: string; id: number; at: number; src: string; capturedAt: number; ready: number }[];
  videos: { id: number; src: string; currentSrc: string; connected: boolean; paused: boolean; time: number; frames: number }[];
}
declare global { interface Window { videoObservation(): VideoObservation } }
export async function observeVideos(page: Page) {
  await page.addInitScript(() => {
    const videos = new Map<HTMLVideoElement, { id: number; frames: number; capturedAt: number; request: number }>();
    const events: VideoObservation['events'] = [];
    let peakSources = 0, peakPlaying = 0;
    const sample = () => {
      peakSources = Math.max(peakSources, [...videos.keys()].filter(video => !!video.getAttribute('src')).length);
      peakPlaying = Math.max(peakPlaying, [...videos.keys()].filter(video => !!video.getAttribute('src') && !video.paused).length);
    };
    const track = (video: HTMLVideoElement) => {
      if (videos.has(video)) return videos.get(video)!;
      const state = { id: videos.size + 1, frames: 0, capturedAt: 0, request: 0 }; videos.set(video, state);
      const frame = () => {
        state.request = 0; state.frames++; sample();
        if (video.getAttribute('src') && !video.paused) state.request = video.requestVideoFrameCallback(frame);
      };
      for (const action of ['playing', 'ended', 'canplay', 'error', 'emptied']) video.addEventListener(action, () => {
        if (action === 'playing' && !state.request) state.request = video.requestVideoFrameCallback(frame);
        record(video, action);
      });
      return state;
    };
    const record = (video: HTMLVideoElement, action: string) => {
      const state = track(video); sample();
      events.push({ action, id: state.id, at: performance.now(), src: video.getAttribute('src') ?? '', capturedAt: state.capturedAt, ready: video.readyState });
      if (events.length > 1200) events.shift();
    };
    const src = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src')!;
    Object.defineProperty(HTMLMediaElement.prototype, 'src', { ...src, set(this: HTMLMediaElement, value: string) {
      src.set!.call(this, value); if (this instanceof HTMLVideoElement) record(this, 'src');
    } });
    const set = Element.prototype.setAttribute, remove = Element.prototype.removeAttribute;
    Element.prototype.setAttribute = function (name, value) {
      set.call(this, name, value); if (this instanceof HTMLVideoElement && name === 'src') record(this, 'src');
    };
    Element.prototype.removeAttribute = function (name) {
      if (this instanceof HTMLVideoElement && name === 'src') record(this, 'retire');
      remove.call(this, name); sample();
    };
    for (const name of ['play', 'pause', 'load'] as const) {
      const native = HTMLMediaElement.prototype[name];
      Object.defineProperty(HTMLMediaElement.prototype, name, { configurable: true, writable: true, value: function (this: HTMLMediaElement) {
        const result = Reflect.apply(native, this, []);
        if (this instanceof HTMLVideoElement) {
          const state = track(this);
          if ((name === 'pause' || name === 'load') && state.request) { this.cancelVideoFrameCallback(state.request); state.request = 0; }
          record(this, name);
        }
        return result;
      } });
    }
    const draw = CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage = function (this: CanvasRenderingContext2D, ...args: Parameters<typeof draw>) {
      if (args[0] instanceof HTMLVideoElement) track(args[0]).capturedAt = performance.now();
      return Reflect.apply(draw, this, args);
    } as typeof draw;
    window.videoObservation = () => ({ peakSources, peakPlaying, events: [...events], videos: [...videos].map(([video, state]) => ({
      id: state.id, src: video.getAttribute('src') ?? '', currentSrc: video.currentSrc,
      connected: video.isConnected, paused: video.paused, time: video.currentTime, frames: state.frames,
    })) });
  });
}
