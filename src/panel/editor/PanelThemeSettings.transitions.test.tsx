import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PanelThemeSettings, type PanelThemeSettingsProps } from './PanelThemeSettings';
import { buildPanelTheme } from '../theme/panelTheme';
import { I18nProvider } from '../../lib/i18n';
import en from '../../locales/en.json';
import type { ComponentProps } from 'react';
import type { BackgroundMediaPicker } from '../background/BackgroundMediaPicker';
import type { PanelAudioTriggerSettings } from '../background/AudioTriggerSettings';

let picker: ComponentProps<typeof BackgroundMediaPicker>;
let audio: ComponentProps<typeof PanelAudioTriggerSettings>;
vi.mock('../background/AudioTriggerSettings', () => ({
  PanelAudioTriggerSettings: (props: ComponentProps<typeof PanelAudioTriggerSettings>) => { audio = props; return null; },
}));
vi.mock('../background/BackgroundMediaPicker', () => ({
  BackgroundMediaPicker: (props: ComponentProps<typeof BackgroundMediaPicker>) => { picker = props; return null; },
}));
vi.mock('../widgets/lighting/effecteditor/BackgroundEffectPreview', () => ({ BackgroundEffectPreview: () => null }));
vi.mock('../widgets/lighting/page/AnimateGrid', () => ({ AnimateGrid: () => null }));
vi.mock('../background/useBackgroundTransitionPreviewPublisher', () => ({ useBackgroundTransitionPreviewPublisher: () => ({ preview: vi.fn(), error: false }) }));

function mount(overrides: Partial<PanelThemeSettingsProps> = {}) {
  const noop = vi.fn();
  const props: PanelThemeSettingsProps = {
    theme: { ...buildPanelTheme(null, null), backdrop: 'theme', backgroundMode: 'media', backgroundSlideshow: true },
    resolvedThemeMode: 'dark', sections: 'background', showMediaTab: true, deviceId: 'panel-one', audioReactive: true,
    onThemeSyncCommit: noop, onThemeModeCommit: noop, onAccentSyncCommit: noop, onAccentPreview: noop, onAccentCommit: noop,
    onBackgroundPreview: noop, onBackgroundCommit: noop, onBackgroundModeCommit: noop, onBackdropCommit: noop,
    onBackgroundEffectCommit: noop, onBackgroundTemplateCommit: noop, onBackgroundEffectStatePreview: noop,
    onBackgroundEffectStateCommit: noop, onBackgroundOpacityPreview: noop, onBackgroundOpacityCommit: noop,
    onBackgroundMediaCommit: noop, onBackgroundSlideshowCommit: noop, onBackgroundMediaOrderCommit: noop,
    onBackgroundFrostPreview: noop, onBackgroundFrostCommit: noop, onImmersiveBackdropCommit: noop,
    onWidgetOpacityPreview: noop, onWidgetOpacityCommit: noop, onWidgetLabelsCommit: noop,
    onWidgetPaddingPreview: noop, onWidgetPaddingCommit: noop, onTextColorModeCommit: noop,
    onTextColorPreview: noop, onTextColorCommit: noop, onFontCommit: noop, onBackgroundAudioTriggerCommit: vi.fn(),
    onBackgroundTransitionsCommit: vi.fn(), ...overrides,
  };
  render(<I18nProvider initialLanguage="en" initialTranslations={en}><PanelThemeSettings {...props} /></I18nProvider>);
  return props;
}

describe('shared panel transition controls', () => {
  it('passes separate beat settings and commit callback into Audio Trigger while main is off', () => {
    const onBeat = vi.fn();
    const theme = { ...buildPanelTheme(null, null), backgroundTransitions: { enabled: false, effects: ['curtains:wave'], durationMs: 4000 },
      backgroundAudioTriggerBeatTransition: { enabled: true, durationMs: 200 } };
    const props = mount({ theme, onBackgroundAudioTriggerBeatTransitionCommit: onBeat });
    expect(audio.beatTransition).toEqual({ enabled: true, durationMs: 200 });
    audio.onBeatTransitionChange?.({ enabled: false, durationMs: 300 });
    expect(onBeat).toHaveBeenCalledExactlyOnceWith({ enabled: false, durationMs: 300 });
    expect(props.onBackgroundAudioTriggerCommit).not.toHaveBeenCalled();
    expect(props.onBackgroundTransitionsCommit).not.toHaveBeenCalled();
  });
  it('offers one toggle/picker and commits one shared setting without editing either playback channel', () => {
    const props = mount();
    expect(screen.getAllByRole('switch', { name: 'Transitions' })).toHaveLength(1);
    expect('onTransitionCommit' in picker).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Transitions' }));
    fireEvent.click(document.querySelector('[data-transition-key="curtains:wave"]')!);
    expect(props.onBackgroundTransitionsCommit).toHaveBeenCalledExactlyOnceWith({ enabled: false, effects: ['gl-transitions:WaterDrop', 'curtains:wave'], durationMs: 800 });
    expect(props.onBackgroundAudioTriggerCommit).not.toHaveBeenCalled();
    expect(props.onBackgroundSlideshowCommit).not.toHaveBeenCalled();
  });

  it.each([{ independentBackground: true }, { hideBackgroundAppearanceControls: true }])(
    'hides both transition controls on independent circle and lighting editors (%j)', overrides => {
      mount(overrides);
      expect(screen.queryByRole('button', { name: 'Transitions' })).toBeNull();
      expect('onTransitionCommit' in picker).toBe(false);
    },
  );

  it.each(['solid', 'shader'] as const)('offers shared transitions with a %s normal background', backgroundMode => {
    const theme = { ...buildPanelTheme(null, null), backgroundMode };
    mount({ theme });
    expect(screen.getByRole('button', { name: 'Transitions' })).toBeTruthy();
  });

  it.each([{ audioReactive: false }, { onBackgroundAudioTriggerCommit: undefined }])(
    'retains shared slideshow transitions independently from the audio controls (%j)', overrides => {
      mount(overrides);
      expect(screen.getByRole('button', { name: 'Transitions' })).toBeTruthy();
    },
  );
});
