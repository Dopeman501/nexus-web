import { act, render } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { PanelThemeSettings } from '../../../panel/editor/PanelThemeSettings';
import { D215PanelBackgroundSettings } from './D215PanelBackgroundSettings';

type Props = ComponentProps<typeof PanelThemeSettings>;
let controls: Props;
vi.mock('../../../panel/editor/PanelThemeSettings', () => ({
  PanelThemeSettings: (props: Props) => { controls = props; return <div data-testid="theme">{JSON.stringify(props.theme)}</div>; },
}));

describe('D215 circle background settings adapter', () => {
  it('ignores media callbacks that finish after switching away from this circle', () => {
    const onChange = vi.fn();
    const { unmount } = render(<D215PanelBackgroundSettings onChange={onChange} themeMode="dark" diameter={300} />);
    const pending = controls.onBackgroundMediaCommit;
    unmount();
    pending(null, null, false);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('previews locally and commits colour/opacity/frost only through the selected instance callback', () => {
    const onChange = vi.fn();
    render(<D215PanelBackgroundSettings background={{ color: '#ff0000' }} onChange={onChange} themeMode="dark" diameter={240} deviceId="d215" />);
    expect(controls).toMatchObject({ sections: 'background', independentBackground: true, showImmersiveBackdrop: false,
      showMediaTab: true, roundDisplay: true, deviceW: 240, deviceH: 240, deviceId: 'd215', audioReactive: false });
    act(() => controls.onBackgroundPreview('#abcdef'));
    expect(onChange).not.toHaveBeenCalled();
    expect(controls.theme.backgroundColor).toBe('#abcdef');
    act(() => controls.onBackgroundCommit('#112233'));
    expect(onChange).toHaveBeenLastCalledWith({ color: '#112233', colorLight: '#112233' });
    act(() => controls.onBackgroundOpacityCommit(0.4));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ opacity: 0.4 }));
    act(() => controls.onBackgroundFrostCommit(40));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ frost: 40 }));
  });

  it('stores animation state and media settings on the circle without device/global preset writes', () => {
    const onChange = vi.fn();
    render(<D215PanelBackgroundSettings onChange={onChange} themeMode="light" diameter={300} />);
    expect(controls.showMediaTab).toBe(false);
    act(() => controls.onBackgroundEffectCommit('fire'));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ effect: 'fire', template: 0,
      effectState: expect.objectContaining({ params: expect.any(Object) }) }));
    act(() => controls.onBackgroundTemplateCommit(2));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ template: 2, effectState: expect.any(Object) }));
    const effectState = { ...controls.theme.backgroundEffectState, speed: 37, params: { u_zoom: 2 } };
    act(() => controls.onBackgroundEffectStateCommit(effectState));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ effectState }));
    act(() => {
      controls.onBackgroundMediaCommit('asset-one', 'animated', false);
      controls.onBackgroundSlideshowCommit({ enabled: true, interval: 60, shuffle: true, finishVideos: false });
    });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ mode: 'media', mediaId: 'asset-one', mediaType: 'animated', mediaAlpha: false,
      slideshow: true, interval: 60, shuffle: true, finishVideos: false }));
    act(() => controls.onBackgroundMediaOrderCommit(['asset-two', 'asset-one']));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ mediaOrder: ['asset-two', 'asset-one'] }));
    act(() => controls.onBackgroundMediaCommit(null, null, false));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ mediaId: null, mediaType: null, mediaAlpha: false }));
  });
});
