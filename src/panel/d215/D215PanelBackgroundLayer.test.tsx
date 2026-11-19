import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { D215PanelBackgroundLayer } from './D215PanelBackgroundLayer';

const mocks = vi.hoisted(() => ({ media: vi.fn(), shader: vi.fn(), slideshow: vi.fn(), stop: vi.fn() }));
vi.mock('../background/PanelBackgroundMedia', async () => {
  const { useEffect } = await import('react');
  return { PanelBackgroundMedia: (props: unknown) => {
    mocks.media(props); useEffect(() => mocks.stop, []); return <div data-testid="media" />;
  } };
});
vi.mock('../background/PanelBackgroundShader', () => ({ PanelBackgroundShader: (props: unknown) => {
  mocks.shader(props); return <div data-testid="shader" />;
} }));
vi.mock('../background/PanelBackgroundSlideshow', () => ({ PanelBackgroundSlideshow: (props: unknown) => {
  mocks.slideshow(props); return <div data-testid="slideshow" />;
} }));
afterEach(() => vi.clearAllMocks());

describe('D215 independent background rendering', () => {
  it('pauses only circle shader rendering and leaves media/slideshow coverage unchanged', () => {
    const view = render(<D215PanelBackgroundLayer themeMode="dark" renderPaused
      background={{ mode: 'shader', effect: 'plasma' }} />);
    expect(mocks.shader).toHaveBeenLastCalledWith(expect.objectContaining({ renderPaused: true, covered: false }));
    view.rerender(<D215PanelBackgroundLayer themeMode="dark" deviceId="device" renderPaused
      background={{ mode: 'media', mediaId: 'clip', mediaType: 'animated' }} />);
    expect(mocks.media).toHaveBeenLastCalledWith(expect.objectContaining({ covered: false }));
    view.rerender(<D215PanelBackgroundLayer themeMode="dark" deviceId="device" renderPaused
      background={{ mode: 'media', slideshow: true }} />);
    expect(mocks.slideshow).toHaveBeenLastCalledWith(expect.objectContaining({ covered: false }));
  });
  it('retries a transient media failure with backoff and cancels retries on unmount', () => {
    vi.useFakeTimers();
    try {
      const { unmount } = render(<D215PanelBackgroundLayer themeMode="dark" deviceId="device"
        background={{ mode: 'media', mediaId: 'clip', mediaType: 'animated' }} />);
      act(() => mocks.media.mock.lastCall![0].onFailed());
      expect(screen.queryByTestId('media')).not.toBeInTheDocument();
      act(() => vi.advanceTimersByTime(5000));
      expect(screen.getByTestId('media')).toBeInTheDocument();
      act(() => mocks.media.mock.lastCall![0].onFailed());
      act(() => vi.advanceTimersByTime(5000));
      expect(screen.queryByTestId('media')).not.toBeInTheDocument();
      unmount();
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });

  it('resolves light/dark colour and opacity with the standard solid renderer', () => {
    const props = { background: { mode: 'solid' as const, color: '#2c0d0d', colorLight: '#fee2e2', opacity: 0.4 }, themeMode: 'light' as const };
    const { container, rerender } = render(<D215PanelBackgroundLayer {...props} />);
    expect(container.querySelector('[data-d215-panel-background]')).toHaveStyle({ '--panel-background-solid': '#fee2e2' });
    expect(container.querySelector('[data-panel-bg-layer]')).toHaveStyle({ '--panel-background-opacity': '0.4' });
    rerender(<D215PanelBackgroundLayer {...props} themeMode="dark" />);
    expect(container.querySelector('[data-d215-panel-background]')).toHaveStyle({ '--panel-background-solid': '#2c0d0d' });
  });

  it('sends local animation state and coverage to the shader with bounded frost', () => {
    const effectState = { speed: 27, intensity: 1, hue: 0, colorize: 0, saturation: 1, contrast: 1, params: { u_zoom: 2 } };
    const { container } = render(<D215PanelBackgroundLayer themeMode="dark" covered
      background={{ mode: 'shader', effect: 'fire', template: 2, effectState, frost: 40 }} />);
    expect(mocks.shader).toHaveBeenLastCalledWith(expect.objectContaining({ effect: 'fire', template: 2, effectState, covered: true, surface: 'lcd-round' }));
    expect(container.querySelector('[data-panel-frost]')).toHaveStyle({ '--panel-frost-scale': '0.8' });
  });

  it('uses the real device library, releases failed media and falls back to its own colour', () => {
    const { container, rerender, unmount } = render(<D215PanelBackgroundLayer themeMode="dark" deviceId="real-device"
      background={{ mode: 'media', mediaId: 'one', mediaType: 'animated', color: '#112233' }} />);
    expect(mocks.media).toHaveBeenLastCalledWith(expect.objectContaining({ deviceId: 'real-device', id: 'one', type: 'animated' }));
    act(() => mocks.media.mock.lastCall![0].onFailed());
    expect(screen.queryByTestId('media')).not.toBeInTheDocument();
    expect(container.querySelector('[data-panel-bg-layer]')).toBeInTheDocument();
    expect(mocks.stop).toHaveBeenCalledTimes(1);
    rerender(<D215PanelBackgroundLayer themeMode="dark" deviceId="real-device" background={{ mode: 'media', mediaId: 'two', mediaType: 'static' }} />);
    expect(screen.getByTestId('media')).toBeInTheDocument();
    unmount();
    expect(mocks.stop).toHaveBeenCalledTimes(2);
  });

  it('configures the slideshow independently and uses solid fallback without a device', () => {
    const { container, rerender } = render(<D215PanelBackgroundLayer themeMode="dark" deviceId="device" covered background={{ mode: 'media',
      slideshow: true, interval: 60, shuffle: true, finishVideos: false, mediaOrder: ['two', 'one'], mediaId: 'two' }} />);
    expect(mocks.slideshow).toHaveBeenLastCalledWith(expect.objectContaining({ deviceId: 'device', startId: 'two', intervalSec: 60,
      shuffle: true, finishVideos: false, order: ['two', 'one'], covered: true }));
    rerender(<D215PanelBackgroundLayer themeMode="dark" background={{ mode: 'media', mediaId: 'two', mediaType: 'static' }} />);
    expect(screen.queryByTestId('slideshow')).not.toBeInTheDocument();
    expect(container.querySelector('[data-panel-bg-layer]')).toBeInTheDocument();
  });
});
