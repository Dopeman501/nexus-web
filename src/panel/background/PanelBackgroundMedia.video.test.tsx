import { fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PanelBackgroundMedia } from './PanelBackgroundMedia';

vi.mock('../../api/panelBackgroundMedia', () => ({ backgroundMediaFileUrl: (device: string, id: string) => `/media/${device}/${id}` }));
beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());
const decoded = (video: HTMLVideoElement) => Object.defineProperties(video, {
  readyState: { value: 3, configurable: true }, videoWidth: { value: 320 }, videoHeight: { value: 144 },
});

describe('video transition media ownership', () => {
  it('publishes only decoded video frames and republishes to a fresh subscriber', () => {
    const ready = vi.fn();
    const view = render(<PanelBackgroundMedia id="a" deviceId="d" type="animated" opacity={1} onMediaReady={ready} />);
    const video = view.container.querySelector('video')!;
    fireEvent.canPlay(video);
    expect(ready).not.toHaveBeenCalled();
    decoded(video); fireEvent.canPlay(video);
    expect(ready).toHaveBeenLastCalledWith(video);
    const next = vi.fn();
    view.rerender(<PanelBackgroundMedia id="a" deviceId="d" type="animated" opacity={1} onMediaReady={next} />);
    expect(next).toHaveBeenLastCalledWith(video);
  });

  it('captures retiring video before source teardown and creates a fresh node for the next asset', () => {
    const retiring = vi.fn((video: HTMLVideoElement) => {
      expect(video.getAttribute('src')).toBe('/media/d/a');
      expect(video.readyState).toBe(3);
      expect(HTMLMediaElement.prototype.load).not.toHaveBeenCalled();
    });
    const view = render(<PanelBackgroundMedia id="a" deviceId="d" type="animated" opacity={1} onVideoRetiring={retiring} />);
    const video = view.container.querySelector('video')!; decoded(video);
    view.rerender(<PanelBackgroundMedia id="b" deviceId="d" type="animated" opacity={1} onVideoRetiring={retiring} />);
    expect(retiring).toHaveBeenCalledExactlyOnceWith(video);
    expect(video.hasAttribute('src')).toBe(false);
    expect(HTMLMediaElement.prototype.load).toHaveBeenCalledOnce();
    expect(view.container.querySelector('video')).not.toBe(video);
  });

  it('guarantees decoder cleanup when a retirement subscriber fails', () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const view = render(<PanelBackgroundMedia id="a" deviceId="d" type="animated" opacity={1}
      onVideoRetiring={() => { throw new Error('capture unavailable'); }} />);
    const video = view.container.querySelector('video')!;
    view.unmount();
    expect(video.hasAttribute('src')).toBe(false);
    expect(HTMLMediaElement.prototype.load).toHaveBeenCalledOnce();
    expect(warning).toHaveBeenCalledOnce();
  });

  it('retires the old source before assigning a source to the replacement decoder', () => {
    const order: string[] = [];
    const view = render(<PanelBackgroundMedia id="a" deviceId="d" type="animated" opacity={1}
      onVideoRetiring={() => { order.push('retire'); }} />);
    const original = Element.prototype.setAttribute;
    vi.spyOn(Element.prototype, 'setAttribute').mockImplementation(function (name, value) {
      if (this instanceof HTMLVideoElement && name === 'src' && value === '/media/d/b') order.push('next-source');
      original.call(this, name, value);
    });
    view.rerender(<PanelBackgroundMedia id="b" deviceId="d" type="animated" opacity={1} />);
    expect(order).toEqual(['retire', 'next-source']);
  });

  it('holds playback independently from coverage and resumes the same decoder', () => {
    const view = render(<PanelBackgroundMedia id="a" deviceId="d" type="animated" opacity={1} playbackHeld />);
    const video = view.container.querySelector('video')!;
    expect(video.autoplay).toBe(false);
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalledOnce();
    view.rerender(<PanelBackgroundMedia id="a" deviceId="d" type="animated" opacity={1} />);
    expect(view.container.querySelector('video')).toBe(video);
    expect(video.autoplay).toBe(true);
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledOnce();
    expect(HTMLMediaElement.prototype.load).not.toHaveBeenCalled();
  });
});
