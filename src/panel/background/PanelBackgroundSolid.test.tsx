import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PanelBackgroundSolid } from './PanelBackgroundSolid';

describe('PanelBackgroundSolid', () => {
  afterEach(() => vi.restoreAllMocks());
  it('publishes the resolved colour and retires its owned frame before clearing it', () => {
    const context = { fillStyle: '', fillRect: vi.fn() };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);
    const ready = vi.fn(); const retiring = vi.fn((canvas: HTMLCanvasElement) => expect(canvas.width).toBeGreaterThan(0));
    const view = render(<PanelBackgroundSolid opacity={1} color="#ff8800" onMediaReady={ready} onFrameRetiring={retiring} />);
    const first = ready.mock.calls[0][0] as HTMLCanvasElement;
    expect(context.fillStyle).toBe('#ff8800');
    view.rerender(<PanelBackgroundSolid opacity={1} color="#0088ff" onMediaReady={ready} onFrameRetiring={retiring} />);
    expect(retiring).toHaveBeenCalledWith(first); expect(first.width).toBe(0);
    const second = ready.mock.calls.at(-1)![0] as HTMLCanvasElement;
    expect(second).not.toBe(first); expect(context.fillStyle).toBe('#0088ff');
    view.unmount(); expect(retiring).toHaveBeenCalledWith(second); expect(second.width).toBe(0);
  });
  it('paints the solid layer at the given opacity', () => {
    const { container } = render(<PanelBackgroundSolid opacity={0.4} />);
    const layer = container.querySelector<HTMLElement>('[data-panel-bg-layer]')!;
    expect(layer.className).toMatch(/backgroundSolid/);
    expect(layer.style.getPropertyValue('--panel-background-opacity')).toBe('0.4');
  });
});
