import { fireEvent, render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useEffectThumbnail } from '../../../../hooks/useEffectThumbnail';
import { EffectBackdrop } from './EffectBackdrop';

vi.mock('../../../../hooks/useEffectThumbnail', () => ({ useEffectThumbnail: vi.fn() }));

describe('effect preview fallback', () => {
  beforeEach(() => {
    vi.mocked(useEffectThumbnail).mockReset();
    vi.mocked(useEffectThumbnail).mockReturnValue('blob:ball-preset');
  });

  it('shows the focused effect and requests its selected preset and committed version', () => {
    const { container } = render(<EffectBackdrop effect="ball" slot={2} version="saved-look" />);
    expect(container.querySelector('[data-effect-preview]')).toHaveAttribute('data-effect-preview', 'ball');
    expect(container.querySelector('img')).toHaveAttribute('src', 'blob:ball-preset');
    expect(useEffectThumbnail).toHaveBeenLastCalledWith('ball', 2, 'saved-look', false, false);
  });

  it('covers the global output without showing the previous look while the new one loads', () => {
    const { container, rerender } = render(<EffectBackdrop effect="ball" slot={0} version="first" />);
    vi.mocked(useEffectThumbnail).mockReturnValue(null);
    rerender(<EffectBackdrop effect="wave" slot={1} version="second" />);
    expect(container.querySelector('[data-effect-preview]')).toHaveAttribute('data-effect-preview', 'wave');
    expect(container.querySelector('img')).toBeNull();
  });

  it('uses a still preset while paused and skips unavailable host thumbnail rendering', () => {
    render(<EffectBackdrop effect="ball" slot={3} version="paused" frozen gpuAvailable={false} />);
    expect(useEffectThumbnail).toHaveBeenLastCalledWith('ball', 3, 'paused', true, true);
  });

  it('hides failed images and retries when the selected preset changes', () => {
    const { container, rerender } = render(<EffectBackdrop effect="ball" slot={0} version="first" />);
    fireEvent.error(container.querySelector('img')!);
    expect(container.querySelector('img')).toBeNull();
    vi.mocked(useEffectThumbnail).mockReturnValue('blob:next-preset');
    rerender(<EffectBackdrop effect="ball" slot={1} version="second" />);
    expect(container.querySelector('img')).toHaveAttribute('src', 'blob:next-preset');
  });
});
