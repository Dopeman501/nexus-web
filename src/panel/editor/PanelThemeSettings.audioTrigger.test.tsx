import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PanelThemeSettings, type PanelThemeSettingsProps } from './PanelThemeSettings';
import { buildPanelTheme } from '../theme/panelTheme';

vi.mock('../background/BackgroundMediaPicker', () => ({
  BackgroundMediaPicker: (props: { slideshow?: unknown }) => props.slideshow ? <div>Slideshow</div> : <div>Media choices</div>,
}));
vi.mock('../widgets/lighting/effecteditor/BackgroundEffectPreview', () => ({ BackgroundEffectPreview: () => null }));
vi.mock('../widgets/lighting/page/AnimateGrid', () => ({ AnimateGrid: () => null }));

function mount(mode: 'solid' | 'shader' | 'media' = 'media', overrides: Partial<PanelThemeSettingsProps> = {}) {
  const noop = vi.fn();
  const props: PanelThemeSettingsProps = {
    theme: { ...buildPanelTheme(null, null), backdrop: 'theme', backgroundMode: mode }, resolvedThemeMode: 'dark',
    sections: 'background', showMediaTab: true, deviceId: 'panel-one', audioReactive: true,
    onThemeSyncCommit: noop, onThemeModeCommit: noop, onAccentSyncCommit: noop, onAccentPreview: noop, onAccentCommit: noop,
    onBackgroundPreview: noop, onBackgroundCommit: noop, onBackgroundModeCommit: noop, onBackdropCommit: noop,
    onBackgroundEffectCommit: noop, onBackgroundTemplateCommit: noop, onBackgroundEffectStatePreview: noop,
    onBackgroundEffectStateCommit: noop, onBackgroundOpacityPreview: noop, onBackgroundOpacityCommit: noop,
    onBackgroundMediaCommit: noop, onBackgroundSlideshowCommit: noop, onBackgroundMediaOrderCommit: noop,
    onBackgroundFrostPreview: noop, onBackgroundFrostCommit: noop, onImmersiveBackdropCommit: noop,
    onWidgetOpacityPreview: noop, onWidgetOpacityCommit: noop, onWidgetLabelsCommit: noop,
    onWidgetPaddingPreview: noop, onWidgetPaddingCommit: noop, onTextColorModeCommit: noop,
    onTextColorPreview: noop, onTextColorCommit: noop, onFontCommit: noop, onBackgroundAudioTriggerCommit: vi.fn(),
    ...overrides,
  };
  render(<PanelThemeSettings {...props} />);
  return props;
}

describe('Audio Trigger placement and eligibility', () => {
  it('places the Audio Trigger toggle and Backgrounds button directly before Slideshow', () => {
    mount();
    const trigger = screen.getByRole('switch', { name: 'Audio Trigger' });
    const slideshow = screen.getByText('Slideshow');
    expect(trigger.compareDocumentPosition(slideshow) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Backgrounds' }).compareDocumentPosition(slideshow)
      & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it.each(['solid', 'shader'] as const)('offers the same separate selection for %s backgrounds', mode => {
    const props = mount(mode);
    fireEvent.click(screen.getByRole('switch', { name: 'Audio Trigger' }));
    expect(props.onBackgroundAudioTriggerCommit).toHaveBeenCalledWith(expect.objectContaining({ enabled: true }));
    expect(props.onBackgroundCommit).not.toHaveBeenCalled();
    expect(props.onBackgroundModeCommit).not.toHaveBeenCalled();
  });

  it.each([{ audioReactive: false }, { independentBackground: true }, { onBackgroundAudioTriggerCommit: undefined }])(
    'hides controls outside an eligible shared background editor (%j)', overrides => {
      mount('media', overrides);
      expect(screen.queryByRole('switch', { name: 'Audio Trigger' })).toBeNull();
    },
  );

  it('omits slideshow controls inside an audio selection editor', () => {
    mount('media', { hideSlideshowControls: true, independentBackground: true });
    expect(screen.queryByText('Slideshow')).toBeNull();
    expect(screen.getByText('Media choices')).toBeTruthy();
  });
});
