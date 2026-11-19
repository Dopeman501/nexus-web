import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EffectState } from '../../types/lighting';
import { PanelBackgroundShader } from './PanelBackgroundShader';

type DrawRef = React.RefObject<((canvas: HTMLCanvasElement) => void) | null>;
let drawRef: DrawRef | undefined;
let stateRef: React.RefObject<EffectState | null>;
let visibleRef: React.RefObject<boolean>;

vi.mock('../../hooks/useShaderRenderer', () => ({
  useShaderRenderer: (_canvas: unknown, _effect: unknown, state: typeof stateRef, _audio: unknown, options: { onDrawRef?: DrawRef; visibleRef: typeof visibleRef }) => {
    drawRef = options.onDrawRef; stateRef = state; visibleRef = options.visibleRef;
    return { ready: true, error: null };
  },
}));
vi.mock('../../hooks/useShaderParams', () => ({ useShaderParams: () => ({ sensors: [] }) }));
vi.mock('../../hooks/SensorSignalProvider', () => ({ SensorSignalProvider: ({ children }: { children: React.ReactNode }) => children }));
vi.mock('../../hooks/useAudioState', () => ({ useAudioState: () => ({ current: null }) }));
vi.mock('../../hooks/useMusicReactive', () => ({ useMusicReactive: () => ({ enabled: false }) }));
vi.mock('./panelAudio', () => ({ usePanelAudioReactive: () => true }));

const props = { effect: 'plasma', template: 0, opacity: 1 };

describe('PanelBackgroundShader transition frames', () => {
  let drawImage: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    drawRef = undefined;
    drawImage = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D);
  });
  afterEach(() => vi.restoreAllMocks());

  function draw(container: HTMLElement) {
    const shader = container.querySelector('canvas')!;
    shader.width = 1200; shader.height = 800;
    act(() => drawRef?.current?.(shader));
  }

  it('does not allocate or copy frames without an opted-in transition receiver', () => {
    const { container } = render(<PanelBackgroundShader {...props} />);
    draw(container);
    expect(drawRef?.current).toBeNull();
    expect(drawImage).not.toHaveBeenCalled();
  });

  it('pauses only rendering while asleep, retaining the canvas, visibility ref and latest settings on wake', () => {
    const ready = vi.fn();
    const view = render(<PanelBackgroundShader {...props} onMediaReady={ready} />);
    const canvas = view.container.querySelector('canvas');
    const stableVisibility = visibleRef;
    draw(view.container);
    const lateDraw = drawRef?.current;
    const copies = drawImage.mock.calls.length;
    const state = { speed: 2, params: {} };
    view.rerender(<PanelBackgroundShader {...props} renderPaused effectState={state} onMediaReady={ready} />);
    expect(visibleRef).toBe(stableVisibility);
    expect(visibleRef.current).toBe(false);
    draw(view.container);
    act(() => lateDraw?.(canvas!)); // A previously queued observer must not copy while hidden.
    expect(drawImage).toHaveBeenCalledTimes(copies);
    expect(stateRef.current).toBe(state);
    view.rerender(<PanelBackgroundShader {...props} effectState={state} onMediaReady={ready} />);
    expect(visibleRef.current).toBe(true);
    expect(view.container.querySelector('canvas')).toBe(canvas);
    draw(view.container);
    expect(drawImage.mock.calls.length).toBeGreaterThan(copies);
  });

  it('rotates only the CPU mirror for new shader state and retires old pixels before release', () => {
    const ready = vi.fn(); const retirementWidths: number[] = [];
    const retire = vi.fn((source: HTMLCanvasElement) => retirementWidths.push(source.width));
    const firstState = { speed: 1, params: {} };
    const secondState = { speed: 2, params: {} };
    const { container, rerender, unmount } = render(
      <PanelBackgroundShader {...props} effectState={firstState} onMediaReady={ready} onFrameRetiring={retire} />,
    );
    const gpu = container.querySelector('canvas');
    expect(ready).not.toHaveBeenCalled();
    draw(container);
    const first = ready.mock.calls[0][0] as HTMLCanvasElement;
    rerender(<PanelBackgroundShader {...props} effectState={secondState} onMediaReady={ready} onFrameRetiring={retire} />);
    expect(retire).toHaveBeenCalledWith(first);
    expect(retirementWidths).toEqual([1200]);
    expect(first.width).toBe(0);
    expect(container.querySelector('canvas')).toBe(gpu);
    expect(stateRef.current).toBe(secondState);
    draw(container);
    expect(ready.mock.calls[1][0]).not.toBe(first);
    const lateDraw = drawRef?.current;
    unmount();
    lateDraw?.(gpu!);
    expect(ready).toHaveBeenCalledTimes(2);
    expect(retire).toHaveBeenCalledTimes(2);
  });

  it('reannounces callback changes after a valid draw without discarding the current mirror', () => {
    const ready = vi.fn(); const next = vi.fn(); const retire = vi.fn();
    const { container, rerender } = render(<PanelBackgroundShader {...props} onMediaReady={ready} onFrameRetiring={retire} />);
    draw(container);
    const mirror = ready.mock.calls[0][0];
    rerender(<PanelBackgroundShader {...props} onMediaReady={next} onFrameRetiring={retire} />);
    expect(next).not.toHaveBeenCalled();
    expect(retire).not.toHaveBeenCalled();
    draw(container);
    expect(next).toHaveBeenCalledWith(mirror);
  });
});
