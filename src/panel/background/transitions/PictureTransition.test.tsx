import { render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { PictureTransitionRequest } from './pictureRunner';
import { PictureTransition } from './PictureTransition';

const owner = vi.hoisted(() => ({
  replace: vi.fn<(request: PictureTransitionRequest) => Promise<boolean>>().mockResolvedValue(true),
  cancel: vi.fn<() => Promise<void>>().mockResolvedValue(),
}));
vi.mock('./pictureRunner', () => ({ createPictureTransitionRunner: () => owner }));
afterEach(() => { owner.replace.mockClear(); owner.cancel.mockClear(); vi.restoreAllMocks(); });

it('does not restart an equivalent settings record or changed callback identity', () => {
  const from = new Image(); const to = new Image();
  const first = vi.fn(); const latest = vi.fn();
  const { rerender, unmount, container } = render(<PictureTransition from={from} to={to}
    settings={{ effect: 'curtains:wave', durationMs: 200 }} onComplete={first} />);
  expect(container.firstElementChild?.getAttribute('aria-hidden')).toBe('true');
  rerender(<PictureTransition from={from} to={to}
    settings={{ effect: 'curtains:wave', durationMs: 200 }} onComplete={latest} />);
  expect(owner.replace).toHaveBeenCalledTimes(1);
  owner.replace.mock.calls[0][0].onComplete();
  expect(first).not.toHaveBeenCalled();
  expect(latest).toHaveBeenCalledTimes(1);
  unmount();
  expect(owner.cancel).toHaveBeenCalledTimes(1);
});

it('cancels the old request before replacing sources and forwards failures', () => {
  const from = new Image(); const to = new Image(); const replacement = new Image();
  const failed = vi.fn();
  const { rerender, unmount } = render(<PictureTransition from={from} to={to}
    settings={{ effect: 'gl-transitions:WaterDrop', durationMs: 200 }} onComplete={() => {}} onFailed={failed} />);
  rerender(<PictureTransition from={to} to={replacement}
    settings={{ effect: 'gl-transitions:WaterDrop', durationMs: 200 }} onComplete={() => {}} onFailed={failed} />);
  expect(owner.cancel).toHaveBeenCalledTimes(1);
  expect(owner.replace).toHaveBeenCalledTimes(2);
  owner.replace.mock.calls[1][0].onFailed?.('Lost context');
  expect(failed).toHaveBeenCalledExactlyOnceWith('Lost context');
  unmount();
});

it('does no hidden-page setup, retires on hide and restarts only the current visible pair', () => {
  const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
  const { unmount } = render(<PictureTransition from={new Image()} to={new Image()}
    settings={{ effect: 'curtains:wave', durationMs: 200 }} onComplete={() => {}} />);
  expect(owner.replace).not.toHaveBeenCalled();
  visibility.mockReturnValue('visible');
  document.dispatchEvent(new Event('visibilitychange'));
  expect(owner.replace).toHaveBeenCalledTimes(1);
  visibility.mockReturnValue('hidden');
  document.dispatchEvent(new Event('visibilitychange'));
  expect(owner.cancel).toHaveBeenCalledTimes(1);
  visibility.mockReturnValue('visible');
  document.dispatchEvent(new Event('visibilitychange'));
  expect(owner.replace).toHaveBeenCalledTimes(2);
  unmount();
  document.dispatchEvent(new Event('visibilitychange'));
  expect(owner.replace).toHaveBeenCalledTimes(2);
});
