import { act, render, screen } from '@testing-library/react';
import { useEffect, useRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BackgroundMediaItem } from '../../api/panelBackgroundMedia';
import type { PictureSource } from './transitions/source';
import { PanelBackgroundSlideshow } from './PanelBackgroundSlideshow';

const state = vi.hoisted(() => ({
  items: [] as BackgroundMediaItem[],
  sources: new Map<string, HTMLVideoElement | HTMLImageElement>(),
  ended: new Map<string, (video: HTMLVideoElement) => void>(),
  failed: new Map<string, () => void>(),
  ready: new Map<string, (source: PictureSource | null) => void>(),
  loaded: new Map<string, () => void>(),
  stalled: new Set<string>(),
  events: [] as string[],
  from: null as PictureSource | null,
  to: null as PictureSource | null,
  complete: () => {},
  failEffect: () => {},
}));

vi.mock('../../api/panelBackgroundMedia', () => ({ fetchBackgroundMediaLibrary: () => Promise.resolve({ items: state.items }) }));
vi.mock('../../hooks/useMultiplexSocket', () => ({ useTopicCallback: () => {} }));
vi.mock('./transitions/PictureTransition', () => ({ PictureTransition: (props: {
  from: PictureSource; to: PictureSource; onComplete(): void; onFailed?(): void;
}) => {
  state.from = props.from; state.to = props.to;
  state.complete = props.onComplete; state.failEffect = props.onFailed ?? props.onComplete;
  return <div data-testid="video-transition" />;
} }));

vi.mock('./PanelBackgroundMedia', () => ({ PanelBackgroundMedia: (props: {
  id: string; type: 'static' | 'animated'; alpha?: boolean; ready?: boolean; playbackHeld?: boolean;
  onMediaReady?(source: PictureSource | null): void; onImageReady?(image: HTMLImageElement | null): void;
  onVideoRetiring?(video: HTMLVideoElement): void; onLoaded?(): void; onFailed?(): void;
  onFadedIn?(): void; onVideoEnded?(video: HTMLVideoElement): void; onVideoMetadata?(video: HTMLVideoElement): void;
}) => {
  const video = useRef<HTMLVideoElement>(null);
  const current = useRef(props); current.current = props;
  const isVideo = props.type === 'animated' && !props.alpha;
  if (props.onFailed) state.failed.set(props.id, props.onFailed);
  if (props.onMediaReady) state.ready.set(props.id, props.onMediaReady);
  if (props.onLoaded) state.loaded.set(props.id, props.onLoaded);
  if (props.onVideoEnded) state.ended.set(props.id, props.onVideoEnded);
  useEffect(() => {
    const element = isVideo ? video.current! : new Image();
    element.dataset.asset = props.id;
    element.src = `https://localhost/${props.id}.${isVideo ? 'mp4' : 'jpg'}`;
    if (isVideo) Object.defineProperties(element, {
      videoWidth: { value: 100 }, videoHeight: { value: 50 }, readyState: { value: 3 },
      duration: { value: 4, configurable: true }, play: { value: vi.fn(() => Promise.resolve()) }, pause: { value: vi.fn() },
    });
    else Object.defineProperties(element, { naturalWidth: { value: 100 }, naturalHeight: { value: 50 } });
    state.sources.set(props.id, element);
    if (!state.stalled.has(props.id)) {
      state.events.push(`ready:${props.id}`);
      if (isVideo) props.onVideoMetadata?.(element as HTMLVideoElement);
      const source = props.alpha ? null : element;
      if (props.onMediaReady) props.onMediaReady(source);
      else props.onImageReady?.(isVideo ? null : element as HTMLImageElement);
      props.onLoaded?.();
    }
    return () => {
      if (isVideo) {
        state.events.push(`retire:${props.id}`);
        current.current.onVideoRetiring?.(element as HTMLVideoElement);
      }
      state.sources.delete(props.id); state.ended.delete(props.id);
    };
  // Source ownership follows the immutable keyed asset, as in the real media component.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.id]);
  const { ready, onFadedIn } = props;
  useEffect(() => {
    if (ready !== false) onFadedIn?.();
  }, [ready, onFadedIn]);
  return isVideo
    ? <video ref={video} data-testid="video-slide" data-id={props.id} data-held={props.playbackHeld ? 'true' : undefined} />
    : <div data-testid="image-slide" data-id={props.id} />;
} }));

const asset = (id: string, type: 'static' | 'animated', importedAtUnixMs: number): BackgroundMediaItem => ({
  id, type, name: id, sourceExt: type === 'animated' ? '.webm' : '.jpg',
  width: 100, height: 50, importedAtUnixMs, durationSec: type === 'animated' ? 4 : 0, alpha: false,
});
const effect = { effect: 'curtains:wave', durationMs: 1600 };
const base = { deviceId: 'one', startId: 'a', intervalSec: 10, shuffle: false, finishVideos: true, order: [], opacity: 1, transition: effect };
const tick = async (ms: number) => act(async () => { vi.advanceTimersByTime(ms); });
const end = async (id: string) => act(async () => { state.ended.get(id)?.(state.sources.get(id) as HTMLVideoElement); });
const complete = async () => act(async () => state.complete());
async function show(overrides: Partial<typeof base> = {}) {
  const view = render(<PanelBackgroundSlideshow {...base} {...overrides} />);
  await act(async () => { await Promise.resolve(); });
  return view;
}

beforeEach(() => {
  vi.useFakeTimers();
  state.items = []; state.sources.clear(); state.ended.clear(); state.failed.clear(); state.ready.clear(); state.loaded.clear(); state.stalled.clear();
  state.events.length = 0; state.from = null; state.to = null;
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: (source: PictureSource) => {
    state.events.push(`snapshot:${source instanceof HTMLVideoElement ? source.dataset.asset : 'image'}`);
  } } as unknown as CanvasRenderingContext2D);
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('Slideshow video transition presentation', () => {
  it('uses a live incoming video for image-to-video and promotes only on completion', async () => {
    state.items = [asset('a', 'static', 1), asset('b', 'animated', 2)];
    await show(); await tick(10_000);
    expect(screen.getByTestId('video-transition')).not.toBeNull();
    expect(state.to).toBe(state.sources.get('b'));
    expect(state.to).toBeInstanceOf(HTMLVideoElement);
    const liveVideo = state.to;
    expect(screen.getByTestId('image-slide')).not.toBeNull();
    await complete();
    expect(screen.queryByTestId('image-slide')).toBeNull();
    expect(screen.getByTestId('video-slide').getAttribute('data-id')).toBe('b');
    expect(state.sources.get('b')).toBe(liveVideo);
    expect(state.events).not.toContain('retire:b');
  });

  it('freezes an outgoing video for video-to-image and holds only the outgoing playback', async () => {
    state.items = [asset('a', 'animated', 1), asset('b', 'static', 2)];
    await show(); await tick(10_000); // Finish videos waits for complete plays.
    await end('a'); await end('a'); await end('a');
    expect(screen.getByTestId('video-transition')).not.toBeNull();
    expect(state.from).toBeInstanceOf(HTMLCanvasElement);
    expect(screen.getByTestId('video-slide').getAttribute('data-held')).toBe('true');
    await complete();
    expect(screen.queryByTestId('video-slide')).toBeNull();
  });

  it('captures before retiring the old decoder, then transitions to one live new video', async () => {
    state.items = [asset('a', 'animated', 1), asset('b', 'animated', 2)];
    const retiring = vi.fn();
    const view = render(<PanelBackgroundSlideshow {...base} finishVideos={false} onVideoRetiring={retiring} />);
    await act(async () => { await Promise.resolve(); });
    await tick(10_000);
    expect(screen.getByTestId('video-transition')).not.toBeNull();
    expect(state.events.indexOf('snapshot:a')).toBeLessThan(state.events.indexOf('retire:a'));
    expect(state.events.indexOf('retire:a')).toBeLessThan(state.events.indexOf('ready:b'));
    expect(retiring).toHaveBeenCalledTimes(1);
    expect(view.container.querySelectorAll('video')).toHaveLength(1);
    expect(state.from).toBeInstanceOf(HTMLCanvasElement);
    expect(state.to).toBe(state.sources.get('b'));
    expect(screen.getByTestId('video-slide').getAttribute('data-held')).toBeNull();
  });

  it('does not count short incoming loops or start its interval before visual promotion', async () => {
    state.items = [asset('a', 'animated', 1), asset('b', 'animated', 2), asset('c', 'static', 3)];
    await show({ finishVideos: false }); await tick(10_000);
    await end('b'); await tick(5000);
    expect(screen.getByTestId('video-slide').getAttribute('data-id')).toBe('b');
    await complete(); await tick(9999);
    expect(screen.getByTestId('video-slide').getAttribute('data-id')).toBe('b');
    await tick(1);
    expect(screen.getByTestId('image-slide').getAttribute('data-id')).toBe('c');
  });

  it('starts Finish videos whole-play accounting after the new video effect completes', async () => {
    state.items = [asset('a', 'static', 1), asset('b', 'animated', 2), asset('c', 'static', 3)];
    await show(); await tick(10_000);
    await end('b'); await end('b'); await end('b');
    expect(screen.getByTestId('video-transition')).not.toBeNull();
    await complete();
    await end('b'); await end('b');
    expect(screen.queryByTestId('image-slide')).toBeNull();
    await end('b');
    expect(screen.getByTestId('image-slide').getAttribute('data-id')).toBe('c');
  });

  it('keeps a stalled replacement bounded and skips it without a second decoder', async () => {
    state.items = [asset('a', 'animated', 1), asset('b', 'animated', 2), asset('c', 'animated', 3)];
    state.stalled.add('b');
    const view = await show({ finishVideos: false }); await tick(10_000);
    expect(screen.getByTestId('video-slide').getAttribute('data-id')).toBe('b');
    await tick(30_000);
    expect(screen.getByTestId('video-slide').getAttribute('data-id')).toBe('c');
    expect(view.container.querySelectorAll('video')).toHaveLength(1);
  });

  it('keeps one frozen picture through failed replacements until a live frame is ready', async () => {
    state.items = [asset('a', 'animated', 1), asset('b', 'animated', 2), asset('c', 'animated', 3)];
    state.stalled.add('b'); state.stalled.add('c');
    const view = await show({ finishVideos: false }); await tick(10_000);
    expect(view.container.querySelector('[data-slideshow-picture-hold]')).not.toBeNull();
    await act(async () => state.failed.get('b')?.());
    expect(screen.getByTestId('video-slide').getAttribute('data-id')).toBe('c');
    expect(view.container.querySelector('[data-slideshow-picture-hold]')).not.toBeNull();
    const source = state.sources.get('c')!;
    await act(async () => { state.ready.get('c')?.(source); state.loaded.get('c')?.(); });
    expect(screen.getByTestId('video-transition')).not.toBeNull();
    expect(state.to).toBe(source);
    expect(view.container.querySelectorAll('video')).toHaveLength(1);
  });

  it('does not recapture or restart an active effect for duplicate canplay readiness', async () => {
    state.items = [asset('a', 'animated', 1), asset('b', 'static', 2)];
    await show(); await end('a'); await end('a'); await end('a');
    const original = state.from;
    await act(async () => state.ready.get('b')?.(state.sources.get('b')!));
    expect(state.from).toBe(original);
    expect(state.events.filter(event => event === 'snapshot:a')).toHaveLength(1);
  });

  it('cuts safely after capture failure and keeps both assets eligible', async () => {
    state.items = [asset('a', 'animated', 1), asset('b', 'animated', 2)];
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(null);
    const view = await show({ finishVideos: false }); await tick(10_000);
    expect(screen.queryByTestId('video-transition')).toBeNull();
    expect(screen.getByTestId('video-slide').getAttribute('data-id')).toBe('b');
    await tick(10_000);
    expect(screen.getByTestId('video-slide').getAttribute('data-id')).toBe('a');
    expect(view.container.querySelectorAll('video')).toHaveLength(1);
  });

  it('publishes the live replacement only on effect failure/completion and ignores an obsolete completion', async () => {
    state.items = [asset('a', 'animated', 1), asset('b', 'animated', 2), asset('c', 'animated', 3)];
    const frames = vi.fn();
    const view = render(<PanelBackgroundSlideshow {...base} finishVideos={false} onMediaReady={frames} />);
    await act(async () => { await Promise.resolve(); }); await tick(10_000);
    const obsolete = state.complete;
    expect(frames.mock.calls.at(-1)?.[0].dataset.asset).toBe('a');
    view.rerender(<PanelBackgroundSlideshow {...base} startId="c" finishVideos={false} onMediaReady={frames} />);
    await act(async () => obsolete());
    expect(screen.getByTestId('video-transition')).not.toBeNull();
    expect(frames.mock.calls.at(-1)?.[0].dataset.asset).toBe('a');
    await act(async () => state.failEffect());
    expect(screen.queryByTestId('video-transition')).toBeNull();
    expect(frames.mock.calls.at(-1)?.[0]).toBe(state.sources.get('c'));
  });

  it('retires an effect when covered and resumes with a full visible interval', async () => {
    state.items = [asset('a', 'animated', 1), asset('b', 'animated', 2), asset('c', 'static', 3)];
    const view = await show({ finishVideos: false }); await tick(10_000);
    const obsolete = state.complete;
    view.rerender(<PanelBackgroundSlideshow {...base} finishVideos={false} covered />);
    expect(screen.queryByTestId('video-transition')).toBeNull();
    expect(view.container.querySelector('[data-slideshow-picture-hold]')).toBeNull();
    await act(async () => obsolete()); await tick(60_000);
    expect(screen.getByTestId('video-slide').getAttribute('data-id')).toBe('b');
    view.rerender(<PanelBackgroundSlideshow {...base} finishVideos={false} covered={false} />);
    await tick(9999);
    expect(screen.queryByTestId('image-slide')).toBeNull();
    await tick(1);
    expect(screen.getByTestId('image-slide').getAttribute('data-id')).toBe('c');
  });

  it('ignores late ready, failure and ended callbacks from a retired video', async () => {
    state.items = [asset('a', 'animated', 1), asset('b', 'animated', 2), asset('c', 'static', 3)];
    await show();
    const source = state.sources.get('a')!;
    const staleReady = state.ready.get('a')!;
    const staleEnded = state.ended.get('a')!;
    const staleFailure = state.failed.get('a')!;
    await end('a'); await end('a'); await end('a'); await complete();
    await act(async () => {
      staleReady(source); staleFailure();
      staleEnded(source as HTMLVideoElement); staleEnded(source as HTMLVideoElement); staleEnded(source as HTMLVideoElement);
    });
    expect(screen.queryByTestId('video-transition')).toBeNull();
    expect(screen.queryByTestId('image-slide')).toBeNull();
    expect(screen.getByTestId('video-slide').getAttribute('data-id')).toBe('b');
  });

  it.each(['static', 'animated'] as const)('counts only the visible tail after %s-to-video promotion', async (firstType) => {
    state.items = [asset('a', firstType, 1), asset('b', 'animated', 2), asset('c', 'static', 3)];
    await show({ intervalSec: 5, transition: { ...effect, durationMs: 5000 } });
    if (firstType === 'static') await tick(5000);
    else { await end('a'); await end('a'); }
    const incoming = state.sources.get('b') as HTMLVideoElement;
    Object.defineProperty(incoming, 'duration', { value: 8 });
    incoming.currentTime = 5;
    await complete();
    expect(state.sources.get('b')).toBe(incoming);
    expect(incoming.currentTime).toBe(5);
    await end('b'); // Only the final three seconds have been visible.
    expect(screen.queryByTestId('video-transition')).toBeNull();
    expect(screen.queryByTestId('image-slide')).toBeNull();
    expect(screen.getByTestId('video-slide').getAttribute('data-id')).toBe('b');
    await end('b'); // The next whole play now covers the five-second interval.
    expect(screen.getByTestId('image-slide').getAttribute('data-id')).toBe('c');
  });
});
