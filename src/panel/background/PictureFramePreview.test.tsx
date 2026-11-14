import { render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { PictureFramePreview } from './PictureFramePreview';

afterEach(() => vi.restoreAllMocks());

it('owns its decorative bitmap and leaves a borrowed frame intact after replacement and unmount', () => {
  const drawImage = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D);
  const source = document.createElement('canvas'); source.width = 320; source.height = 144;
  const view = render(<PictureFramePreview source={source} />);
  const preview = view.container.querySelector('canvas')!;
  expect(preview).not.toBe(source);
  expect(preview.width).toBe(320);
  const still = new Image(); still.src = 'https://localhost/still.jpg';
  view.rerender(<PictureFramePreview source={still} />);
  expect(preview.width).toBe(0);
  expect(view.container.querySelector('img')?.src).toBe(still.src);
  view.unmount();
  expect(source.width).toBe(320); expect(source.height).toBe(144);
});

it('falls back without mutating the borrowed source if capture is unavailable', () => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  const source = document.createElement('canvas'); source.width = 320; source.height = 144;
  const view = render(<PictureFramePreview source={source} />);
  expect(view.container.querySelector('canvas')?.width).toBe(0);
  expect(source.width).toBe(320);
});
