import { act, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useLayoutEffect } from 'react';
import { useBackgroundPictureTransition, type PictureSelection } from './backgroundPictureTransition';
import type { PictureSource } from './transitions/source';
import type { ChooseBackgroundTransition } from './transitions/useBackgroundTransitionCycle';
import type { AudioTriggerBeatTransitionSettings } from './transitions/settings';

const renderer = vi.hoisted(() => ({ settings: { effect: '', durationMs: 0 }, from: null as PictureSource | null, to: null as PictureSource | null,
  complete: () => {}, fail: (message: string) => { void message; } }));
vi.mock('./transitions/PictureTransition', () => ({ PictureTransition: (props: {
  from: PictureSource; to: PictureSource; onComplete(): void; onFailed?(message: string): void;
  settings: { effect: string; durationMs: number };
}) => {
  renderer.from = props.from; renderer.to = props.to;
  renderer.settings = props.settings;
  renderer.complete = props.onComplete; renderer.fail = props.onFailed!;
  return <div data-testid="picture-effect" data-from={'src' in props.from ? props.from.src : 'canvas'} data-to={'src' in props.to ? props.to.src : 'canvas'} />;
} }));

const image = (name: string) => {
  const result = new Image(); result.src = `https://localhost/${name}.jpg`;
  Object.defineProperties(result, { naturalWidth: { value: 100 }, naturalHeight: { value: 50 } });
  return result;
};
const normal: PictureSelection = { key: 'normal', channel: 'normal', eligible: true, opacity: 1, frost: 0 };
const audio: PictureSelection = { ...normal, key: 'audio-one', channel: 'audio' };
const effect = { effect: 'gl-transitions:WaterDrop', durationMs: 800 };
let ready: (frame: PictureSource | null) => void;
let retire: (video: HTMLVideoElement) => void;
let retireFrame: (canvas: HTMLCanvasElement) => void;
function Harness({ selection, enabled = true, owner = 'device-one', settings = effect, chooseTransition, beatSettings }: {
  selection: PictureSelection; enabled?: boolean; owner?: string; settings?: typeof effect; chooseTransition?: ChooseBackgroundTransition;
  beatSettings?: AudioTriggerBeatTransitionSettings;
}) {
  const state = useBackgroundPictureTransition({ selection, enabled, ownerKey: owner, settings, chooseTransition, beatSettings, effectsAvailable: true });
  useLayoutEffect(() => { ready = state.onMediaReady; retire = state.onVideoRetiring; retireFrame = state.onFrameRetiring; }, [state.onMediaReady, state.onVideoRetiring, state.onFrameRetiring]);
  return state.overlay;
}
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('Audio Trigger picture transition lifetime', () => {
  it('uses main timing for activation and previews, beat timing only for real rhythm swaps', () => {
    const chooseTransition = vi.fn((_key: string, controls?: AudioTriggerBeatTransitionSettings) => ({ ...effect, durationMs: controls?.durationMs ?? 800 }));
    const beatSettings = { enabled: true, durationMs: 150 };
    const rhythm: PictureSelection = { ...audio, origin: 'rhythm' };
    const view = render(<Harness selection={normal} chooseTransition={chooseTransition} beatSettings={beatSettings} />);
    act(() => ready(image('normal')));
    view.rerender(<Harness selection={rhythm} chooseTransition={chooseTransition} beatSettings={beatSettings} />);
    act(() => ready(image('one'))); expect(renderer.settings.durationMs).toBe(800); act(() => renderer.complete());
    view.rerender(<Harness selection={{ ...rhythm, key: 'beat2' }} chooseTransition={chooseTransition} beatSettings={beatSettings} />);
    act(() => ready(image('two'))); expect(renderer.settings.durationMs).toBe(150); act(() => renderer.complete());
    view.rerender(<Harness selection={{ ...rhythm, key: 'preview', origin: 'preview' }} chooseTransition={chooseTransition} beatSettings={beatSettings} />);
    act(() => ready(image('preview'))); expect(renderer.settings.durationMs).toBe(800);
  });

  it('keeps entry on with beats Off and supports beats On with entry Off', () => {
    const chooseTransition = vi.fn((_key: string, controls?: AudioTriggerBeatTransitionSettings) => ({ ...effect, durationMs: controls?.durationMs ?? 800 }));
    const rhythm: PictureSelection = { ...audio, origin: 'rhythm' };
    const view = render(<Harness selection={normal} beatSettings={{ enabled: false, durationMs: 150 }} />);
    act(() => ready(image('normal')));
    view.rerender(<Harness selection={rhythm} beatSettings={{ enabled: false, durationMs: 150 }} />);
    act(() => ready(image('one'))); expect(view.queryByTestId('picture-effect')).not.toBeNull(); act(() => renderer.complete());
    view.rerender(<Harness selection={{ ...rhythm, key: 'beat2' }} beatSettings={{ enabled: false, durationMs: 150 }} />);
    act(() => ready(image('two'))); expect(view.queryByTestId('picture-effect')).toBeNull();
    view.rerender(<Harness selection={{ ...rhythm, key: 'beat3' }} settings={{ ...effect, effect: 'none' }} beatSettings={{ enabled: true, durationMs: 150 }} chooseTransition={chooseTransition} />);
    act(() => ready(image('three'))); expect(renderer.settings.durationMs).toBe(150);
    expect(view.queryByTestId('picture-effect')).not.toBeNull();
  });

  it('freezes an outgoing shader mirror before its owner clears it', () => {
    const drawImage = vi.fn(); vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D);
    const view = render(<Harness selection={normal} />);
    const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 360;
    act(() => ready(canvas)); act(() => retireFrame(canvas)); canvas.width = 0; canvas.height = 0;
    view.rerender(<Harness selection={audio} />); act(() => ready(image('audio')));
    expect(renderer.from).not.toBe(canvas); expect((renderer.from as HTMLCanvasElement).width).toBe(640);
    expect(view.queryByTestId('picture-effect')).not.toBeNull();
  });

  it('keeps an active beat transition and its locked timing when only main transitions are toggled', () => {
    const chooseTransition = vi.fn((_key: string, controls?: AudioTriggerBeatTransitionSettings) => ({ ...effect, durationMs: controls?.durationMs ?? 800 }));
    const rhythm: PictureSelection = { ...audio, origin: 'rhythm' };
    const next = { ...rhythm, key: 'beat-two' };
    const beatSettings = { enabled: true, durationMs: 150 };
    const view = render(<Harness selection={rhythm} chooseTransition={chooseTransition} beatSettings={beatSettings} />);
    act(() => ready(image('one')));
    view.rerender(<Harness selection={next} chooseTransition={chooseTransition} beatSettings={beatSettings} />);
    act(() => ready(image('two')));
    expect(renderer.settings.durationMs).toBe(150);
    expect(chooseTransition).toHaveBeenCalledOnce();
    view.rerender(<Harness selection={next} chooseTransition={chooseTransition} beatSettings={beatSettings}
      settings={{ effect: 'none', durationMs: 5000 }} />);
    expect(view.queryByTestId('picture-effect')).not.toBeNull();
    expect(renderer.settings.durationMs).toBe(150);
    expect(chooseTransition).toHaveBeenCalledOnce();
    view.rerender(<Harness selection={next} chooseTransition={chooseTransition} beatSettings={beatSettings} />);
    expect(view.queryByTestId('picture-effect')).not.toBeNull();
    expect(chooseTransition).toHaveBeenCalledOnce();
    // The independent beat toggle still immediately cancels its own playback.
    view.rerender(<Harness selection={next} chooseTransition={chooseTransition} beatSettings={{ ...beatSettings, enabled: false }} />);
    expect(view.queryByTestId('picture-effect')).toBeNull();
  });

  it('retains a waiting beat’s original deadline through main edits and clears it on unmount', () => {
    vi.useFakeTimers();
    const rhythm: PictureSelection = { ...audio, origin: 'rhythm' };
    const beatSettings = { enabled: true, durationMs: 150 };
    const next = { ...rhythm, key: 'beat-two' };
    const view = render(<Harness selection={rhythm} beatSettings={beatSettings} />);
    act(() => ready(image('one')));
    view.rerender(<Harness selection={next} beatSettings={beatSettings} />);
    expect(view.container.querySelector('[data-background-picture-hold]')).not.toBeNull();
    act(() => vi.advanceTimersByTime(2000));
    view.rerender(<Harness selection={next} beatSettings={beatSettings} settings={{ ...effect, effect: 'none' }} />);
    act(() => vi.advanceTimersByTime(999));
    expect(view.container.querySelector('[data-background-picture-hold]')).not.toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(view.container.querySelector('[data-background-picture-hold]')).toBeNull();
    act(() => ready(image('two')));
    view.rerender(<Harness selection={{ ...next, key: 'beat-three' }} beatSettings={beatSettings} />);
    expect(vi.getTimerCount()).toBe(1);
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('reserves the shared cycle only for a distinct ready pair and locks its duration', () => {
    const chooseTransition = vi.fn(() => ({ effect: 'curtains:wave', durationMs: 1200 }));
    const view = render(<Harness selection={normal} chooseTransition={chooseTransition} />);
    act(() => ready(image('normal'))); view.rerender(<Harness selection={audio} chooseTransition={chooseTransition} />);
    expect(chooseTransition).not.toHaveBeenCalled();
    act(() => ready(image('one'))); act(() => ready(image('one')));
    expect(chooseTransition).toHaveBeenCalledOnce(); expect(renderer.settings).toEqual({ effect: 'curtains:wave', durationMs: 1200 });
    view.rerender(<Harness selection={audio} chooseTransition={chooseTransition} settings={{ ...effect, durationMs: 5000 }} />);
    expect(view.getByTestId('picture-effect')).toBeTruthy(); expect(renderer.settings.durationMs).toBe(1200);
    act(() => renderer.complete()); view.rerender(<Harness selection={{ ...audio, key: 'next' }} chooseTransition={chooseTransition} />);
    act(() => ready(image('one'))); expect(chooseTransition).toHaveBeenCalledOnce();
  });
  const video = (name: string) => {
    const result = document.createElement('video'); result.src = `https://localhost/${name}.mp4`;
    Object.defineProperties(result, { readyState: { value: 3 }, videoWidth: { value: 320 }, videoHeight: { value: 144 } });
    return result;
  };

  it('freezes a retiring outgoing decoder and transitions to the borrowed live incoming clip and back', () => {
    const drawImage = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D);
    const view = render(<Harness selection={normal} />);
    const outgoing = video('normal');
    act(() => ready(outgoing));
    act(() => retire(outgoing));
    expect(drawImage).toHaveBeenCalledWith(outgoing, 0, 0, 320, 144);
    outgoing.removeAttribute('src');
    view.rerender(<Harness selection={audio} />);
    const incoming = video('audio');
    act(() => ready(incoming));
    expect(renderer.from).toBeInstanceOf(HTMLCanvasElement);
    expect(renderer.to).toBe(incoming);
    act(() => renderer.complete());
    act(() => retire(incoming)); incoming.removeAttribute('src');
    view.rerender(<Harness selection={normal} />);
    act(() => ready(image('normal')));
    expect(renderer.from).toBeInstanceOf(HTMLCanvasElement);
    expect(view.getByTestId('picture-effect').getAttribute('data-to')).toContain('normal.jpg');
  });

  it('falls back safely on video capture failure and ignores retirement of an unrelated decoder', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const view = render(<Harness selection={normal} />);
    act(() => ready(image('normal')));
    act(() => retire(video('unrelated')));
    view.rerender(<Harness selection={audio} />);
    const incoming = video('audio'); act(() => ready(incoming));
    expect(renderer.to).toBe(incoming);
    act(() => renderer.complete());
    act(() => retire(incoming));
    view.rerender(<Harness selection={normal} />);
    act(() => ready(image('back')));
    expect(view.queryByTestId('picture-effect')).toBeNull();
  });

  it('forgets a still when a mixed slideshow starts a video or transparent animation', () => {
    const view = render(<Harness selection={normal} />);
    act(() => ready(image('normal')));
    act(() => ready(null));
    view.rerender(<Harness selection={audio} />);
    act(() => ready(image('audio')));
    expect(view.container.childElementCount).toBe(0);
  });

  it('does not accept an old completion when a selection key is used again', () => {
    const view = render(<Harness selection={normal} />);
    act(() => ready(image('normal')));
    view.rerender(<Harness selection={audio} />);
    act(() => ready(image('one')));
    const oldCompletion = renderer.complete;
    view.rerender(<Harness selection={{ ...audio, key: 'second' }} />);
    act(() => ready(image('two')));
    view.rerender(<Harness selection={audio} />);
    act(() => ready(image('three')));
    act(() => oldCompletion());
    expect(view.getByTestId('picture-effect').getAttribute('data-to')).toContain('three.jpg');
  });

  it('animates normal to audio and back after silence while keeping only one decoded pair', () => {
    const view = render(<Harness selection={normal} />);
    act(() => ready(image('normal')));
    view.rerender(<Harness selection={audio} />);
    expect(view.container.querySelector('[data-background-picture-hold]')).not.toBeNull();
    act(() => ready(image('audio')));
    expect(view.getByTestId('picture-effect').getAttribute('data-from')).toContain('normal.jpg');
    act(() => renderer.complete());
    expect(view.container.childElementCount).toBe(0);
    view.rerender(<Harness selection={normal} />);
    act(() => ready(image('normal')));
    expect(view.getByTestId('picture-effect').getAttribute('data-from')).toContain('audio.jpg');
    act(() => renderer.complete());
    expect(view.container.childElementCount).toBe(0);
  });

  it('rejects late beat readiness/completion after a newer preview selection', () => {
    const view = render(<Harness selection={normal} />);
    act(() => ready(image('normal')));
    view.rerender(<Harness selection={audio} />);
    const staleReady = ready;
    act(() => ready(image('audio')));
    const staleCompletion = renderer.complete;
    view.rerender(<Harness selection={{ ...audio, key: 'preview' }} />);
    act(() => staleReady(image('stale')));
    expect(view.queryByTestId('picture-effect')).toBeNull();
    act(() => ready(image('preview')));
    act(() => staleCompletion());
    expect(view.getByTestId('picture-effect').getAttribute('data-to')).toContain('preview.jpg');
  });

  it('retires immediately for hidden/covered or unsupported sources and owner changes', () => {
    const view = render(<Harness selection={normal} />);
    act(() => ready(image('normal')));
    view.rerender(<Harness selection={audio} />);
    act(() => ready(image('audio')));
    view.rerender(<Harness selection={audio} enabled={false} />);
    expect(view.container.childElementCount).toBe(0);
    view.rerender(<Harness selection={{ ...audio, key: 'video', eligible: false }} />);
    expect(view.container.childElementCount).toBe(0);
    view.rerender(<Harness selection={normal} owner="other-device" />);
    act(() => ready(image('other')));
    expect(view.container.childElementCount).toBe(0);
  });

  it('bounds a stalled incoming decode and never queues later beats behind it', () => {
    vi.useFakeTimers();
    const view = render(<Harness selection={normal} />);
    act(() => ready(image('normal')));
    view.rerender(<Harness selection={audio} />);
    expect(view.container.childElementCount).toBe(1);
    act(() => vi.advanceTimersByTime(3000));
    expect(view.container.childElementCount).toBe(0);
    view.rerender(<Harness selection={{ ...audio, key: 'latest' }} />);
    act(() => ready(image('latest')));
    expect(view.container.childElementCount).toBe(0);
  });

  it.each(['default', 'none'])('preserves the existing immediate Audio Trigger behavior for %s', selected => {
    const view = render(<Harness selection={normal} settings={{ ...effect, effect: selected }} />);
    act(() => ready(image('normal')));
    view.rerender(<Harness selection={audio} settings={{ ...effect, effect: selected }} />);
    act(() => ready(image('audio')));
    expect(view.container.childElementCount).toBe(0);
  });

  it('falls back on renderer failure and bounds repeated GPU retries while preserving the selected look', () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const view = render(<Harness selection={normal} />);
    act(() => ready(image('normal')));
    view.rerender(<Harness selection={audio} />);
    act(() => ready(image('audio')));
    act(() => renderer.fail('context lost'));
    expect(view.container.childElementCount).toBe(0);
    view.rerender(<Harness selection={{ ...audio, key: 'next' }} />);
    act(() => ready(image('next')));
    expect(view.container.childElementCount).toBe(0);
    expect(warning).toHaveBeenCalledOnce(); warning.mockRestore();
  });
});
