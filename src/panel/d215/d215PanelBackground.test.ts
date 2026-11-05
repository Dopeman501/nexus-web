import { describe, expect, it } from 'vitest';
import { d215BackgroundTheme, readD215PanelBackground } from './d215PanelBackground';

describe('D215 circle background normalization', () => {
  it.each([undefined, null, false, 'red', []])('ignores non-object metadata %s', value => {
    expect(readD215PanelBackground(value)).toBeUndefined();
  });
  it('bounds unknown modes, colours, effects, sliders and unsafe media references', () => {
    expect(readD215PanelBackground({ mode: 'html', color: 'red', colorLight: '#ffffff', effect: 'unknown', template: 99,
      opacity: -1, frost: 123, mediaId: '/private/file', mediaType: 'html', interval: -2, mediaOrder: ['safe', 'safe', '../unsafe'] }))
      .toMatchObject({ mode: 'solid', color: undefined, colorLight: '#ffffff', effect: 'plasma', template: 3,
        opacity: 0, frost: 100, mediaId: null, mediaType: null, mediaOrder: ['safe'] });
  });
  it('cleans animation scalars, numeric uniforms and sensor overrides without shared references', () => {
    const sensor = { category: 'quick', sensor: 'summary/cpu-usage', min: 0, max: 100 };
    const background = readD215PanelBackground({ mode: 'shader', effectState: { speed: 400, hue: NaN,
      contrast: 20, intensity: -1, params: { valid: 2, unsafe: NaN, bad: '3' },
      sensors: { u_cpu: sensor, u_bad: { ...sensor, max: 0 } } } });
    expect(background?.effectState).toMatchObject({ speed: 100, intensity: 0, contrast: 4, params: { valid: 2 }, sensors: { u_cpu: sensor } });
    expect(background?.effectState?.sensors?.u_cpu).not.toBe(sensor);
    expect(background?.effectState?.sensors).not.toHaveProperty('u_bad');
    expect(Number.isFinite(background?.effectState?.hue)).toBe(true);
    expect(d215BackgroundTheme(background).backgroundEffectState).toEqual(background?.effectState);
  });
  it('retains the full saturation/contrast range offered by the shipped shader controls', () => {
    expect(readD215PanelBackground({ effectState: { saturation: 4, contrast: 4 } })?.effectState)
      .toMatchObject({ saturation: 4, contrast: 4 });
  });
  it('maps all media playback fields into the existing background contract', () => {
    expect(d215BackgroundTheme({ mode: 'media', mediaId: 'clip', mediaType: 'animated', mediaAlpha: true,
      slideshow: true, interval: 60, shuffle: true, finishVideos: false, mediaOrder: ['clip'], frost: 20 }))
      .toMatchObject({ backgroundMode: 'media', backgroundMediaId: 'clip', backgroundMediaType: 'animated',
        backgroundMediaAlpha: true, backgroundSlideshow: true, backgroundSlideshowInterval: 60, backgroundSlideshowShuffle: true,
        backgroundSlideshowFinishVideos: false, backgroundMediaOrder: ['clip'], backgroundFrost: 20, backdrop: 'theme' });
  });
});
