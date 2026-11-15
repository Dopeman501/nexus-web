import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { KeyReactionPreview } from '../../../api/keyReactive';
import { TypeReactiveBoard } from './TypeReactiveBoard';

const ZONES: KeyReactionPreview = {
  x: Array.from({ length: 10 }, (_, i) => i * 2 + 1), y: Array(10).fill(2.5),
  width: 20, height: 6, fps: 30, frameCount: 1, frames: '', zoneLighting: true,
};

describe('TypeReactiveBoard shared zones', () => {
  const context = {
    setTransform: vi.fn(), clearRect: vi.fn(), beginPath: vi.fn(),
    roundRect: vi.fn(), arc: vi.fn(), fill: vi.fn(), stroke: vi.fn(),
    fillStyle: '', strokeStyle: '', lineWidth: 0,
  };
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(400);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);
  });
  afterEach(() => { vi.restoreAllMocks(); });

  function board(zoneLighting = true, disabled = false) {
    const onPressLed = vi.fn();
    const onPressRandom = vi.fn();
    render(<TypeReactiveBoard preview={ZONES} label="zones" disabled={disabled} live={false}
      zoneLighting={zoneLighting} frameIndex={0} onPressLed={onPressLed} onPressRandom={onPressRandom} />);
    return { canvas: screen.getByRole('button', { name: 'zones' }), onPressLed, onPressRandom };
  }

  it('renders controllable regions without suggesting independent key LEDs', () => {
    const { canvas } = board();
    expect(canvas).toHaveAttribute('data-zone-count', '10');
    expect(context.roundRect).toHaveBeenCalled();
    expect(context.arc).not.toHaveBeenCalled();
    expect(canvas.style.height).toBe('120px');
  });

  it('lets the full shared region trigger its output slot', () => {
    const { canvas, onPressLed } = board();
    // Zone 1 is centred at (20,50), but its shared region extends up to y=0.
    fireEvent.click(canvas, { clientX: 20, clientY: 10 });
    expect(onPressLed).toHaveBeenCalledWith(0);
    fireEvent.click(canvas, { clientX: 380, clientY: 90 });
    expect(onPressLed).toHaveBeenLastCalledWith(9);
  });

  it('preserves key-dot rendering and its smaller hit targets on per-key boards', () => {
    const { canvas, onPressLed } = board(false);
    expect(context.arc).toHaveBeenCalled();
    expect(context.roundRect).not.toHaveBeenCalled();
    expect(canvas).not.toHaveAttribute('data-zone-count');
    fireEvent.click(canvas, { clientX: 20, clientY: 100 });
    expect(onPressLed).not.toHaveBeenCalled();
  });

  it('does not trigger disabled regions and retains the keyboard preview action', () => {
    const { canvas, onPressLed, onPressRandom } = board(true, true);
    fireEvent.click(canvas, { clientX: 20, clientY: 10 });
    fireEvent.keyDown(canvas, { key: 'Enter' });
    expect(onPressLed).not.toHaveBeenCalled();
    expect(onPressRandom).not.toHaveBeenCalled();
  });
});
