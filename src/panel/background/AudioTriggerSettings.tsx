import { useEffect, useRef, useState } from 'react';
import { Button } from '../../components/common/Button/Button';
import { Overlay } from '../../components/common/Overlay/Overlay';
import { SettingRow } from '../../components/common/SettingRow/SettingRow';
import { Toggle } from '../../components/common/Toggle/Toggle';
import { useTranslation } from '../../lib/i18n';
import { EFFECTS } from '../../types/lighting';
import { PanelThemeSettings } from '../editor/PanelThemeSettings';
import { d215BackgroundTheme, readD215PanelBackground, type D215PanelBackground } from '../d215/d215PanelBackground';
import { panelBackgroundPair, panelBackgroundState } from './panelBackground';
import { AUDIO_TRIGGER_MAX_BACKGROUNDS, type AudioTriggerSettings } from './audioTrigger';
import { useBackgroundMedia } from './useBackgroundMedia';
import styles from './AudioTriggerSettings.module.scss';
import { AudioTriggerMenuContent } from './AudioTriggerMenuContent';
import type { PanelThemeSettingsProps } from '../editor/PanelThemeSettings';
import { useAudioTriggerPreviewPublisher } from './useAudioTriggerPreviewPublisher';
import { BeatTransitionControls } from './BeatTransitionControls';
import type { AudioTriggerBeatTransitionSettings } from './transitions/settings';

const DEFAULT_SETTINGS: AudioTriggerSettings = { enabled: false, intensity: 50, switchDelay: 1, shuffle: false, backgrounds: [] };
const NEW_BACKGROUND: D215PanelBackground = { mode: 'solid', color: '#0f0f0f', colorLight: '#fafafa', opacity: 1, frost: 0, slideshow: false };
const noop = () => {};
const BACKGROUND_SECTION = 'background';

interface Props {
  value?: AudioTriggerSettings;
  onChange: (value: AudioTriggerSettings) => void;
  beatTransition?: AudioTriggerBeatTransitionSettings;
  onBeatTransitionChange?: (value: AudioTriggerBeatTransitionSettings) => void;
  themeMode: 'dark' | 'light';
  deviceId?: string | null;
  deviceAspect: number;
  deviceW?: number;
  deviceH?: number;
  round?: boolean;
}

/** The normal background is never edited by this menu. */
export function PanelAudioTriggerSettings(props: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const value = props.value ?? DEFAULT_SETTINGS;
  const label = (key: string, fallback: string) => { const text = t(key); return text === key ? fallback : text; };
  return <>
    <SettingRow label={label('panel.audioTrigger.title', 'Audio Trigger')}
      description={label('panel.audioTrigger.description', 'Use different backgrounds while audio is playing')} descriptionBelow>
      <Toggle checked={value.enabled} onChange={enabled => props.onChange({ ...value, enabled })}
        ariaLabel={label('panel.audioTrigger.title', 'Audio Trigger')} />
      <Button size="sm" onClick={() => setOpen(true)}>{label('panel.audioTrigger.backgrounds', 'Backgrounds')}</Button>
    </SettingRow>
    {open && <AudioTriggerBackgrounds key={props.deviceId} {...props} value={value} onClose={() => setOpen(false)} />}
  </>;
}

function AudioTriggerBackgrounds({ value, onChange, beatTransition, onBeatTransitionChange, onClose, ...device }: Props & {
  value: AudioTriggerSettings;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const label = (key: string, fallback: string) => { const text = t(key); return text === key ? fallback : text; };
  const [draft, setDraft] = useState<D215PanelBackground>(NEW_BACKGROUND);
  const [editing, setEditing] = useState<{ index: number; source: string } | null>(null);
  const selection = useRef(editing);
  const select = (next: typeof editing) => { selection.current = next; setEditing(next); };
  // An external list edit must not redirect automatic saves into another entry.
  const editingIndex = editing && JSON.stringify(value.backgrounds[editing.index]) === editing.source ? editing.index : null;
  useAudioTriggerPreviewPublisher(device.deviceId, editing === null || editingIndex !== null ? draft : null);
  const { items, thumbs } = useBackgroundMedia(device.deviceId ?? '');
  const source = useRef(value);
  const current = useRef(value);
  if (source.current !== value) { source.current = value; current.current = value; }
  const change = (patch: Partial<AudioTriggerSettings>) => {
    current.current = { ...current.current, ...patch };
    onChange(current.current);
  };
  const save = () => {
    const background = readD215PanelBackground({ ...draft, slideshow: false });
    if (!background || (background.mode === 'media' && (!background.mediaId || !background.mediaType))) return;
    const backgrounds = [...current.current.backgrounds, background];
    if (backgrounds.length > AUDIO_TRIGGER_MAX_BACKGROUNDS) return;
    change({ backgrounds });
    select(null);
  };
  const commit = (next: D215PanelBackground) => {
    const target = selection.current;
    if (!target || JSON.stringify(current.current.backgrounds[target.index]) !== target.source) return;
    const background = readD215PanelBackground({ ...next, slideshow: false });
    if (!background || (background.mode === 'media' && (!background.mediaId || !background.mediaType))) return;
    if (JSON.stringify(background) === target.source) return;
    select({ index: target.index, source: JSON.stringify(background) });
    change({ backgrounds: current.current.backgrounds.map((item, index) => index === target.index ? background : item) });
  };
  const remove = (index: number) => {
    change({ backgrounds: current.current.backgrounds.filter((_, itemIndex) => itemIndex !== index) });
    if (editingIndex === index) { select(null); setDraft(NEW_BACKGROUND); }
    else if (editingIndex !== null && editingIndex > index) select({ index: editingIndex - 1, source: editing!.source });
  };
  const summary = (background: D215PanelBackground) => background.mode === 'shader'
    ? `${label('panel.settings.backgroundMode.animations', 'Animations')} · ${t(EFFECTS.find(effect => effect.key === background.effect)?.labelKey ?? 'lighting.effects.plasma')}`
    : background.mode === 'media'
      ? `${label('panel.settings.backgroundMode.media', 'Media')} · ${items.find(item => item.id === background.mediaId)?.name ?? label('panel.audioTrigger.mediaUnavailable', 'Media unavailable')}`
      : `${label('panel.settings.backgroundMode.solid', 'Solid')} · ${background.color ?? ''}`;
  const canSave = (editingIndex !== null || value.backgrounds.length < AUDIO_TRIGGER_MAX_BACKGROUNDS)
    && (draft.mode !== 'media' || !!(draft.mediaId && draft.mediaType));
  return <Overlay open onClose={onClose} ariaLabel={label('panel.audioTrigger.menuTitle', 'Audio Trigger backgrounds')}
    className={styles.dialog}>
    <header className={styles.header}>
      <h2>{label('panel.audioTrigger.menuTitle', 'Audio Trigger backgrounds')}</h2>
      <Button size="sm" onClick={onClose}>{label('panel.audioTrigger.done', 'Done')}</Button>
    </header>
    <AudioTriggerMenuContent intensity={value.intensity} switchDelay={value.switchDelay} shuffle={value.shuffle}
      onChange={change} items={value.backgrounds} maximum={AUDIO_TRIGGER_MAX_BACKGROUNDS}
      afterShuffleControls={onBeatTransitionChange && <BeatTransitionControls value={beatTransition} onChange={onBeatTransitionChange} />}
      editingIndex={editingIndex} canSave={canSave} onSave={save} autoSave
      onNew={() => { select(null); setDraft(NEW_BACKGROUND); }}
      onEdit={(background, index) => { setDraft(background); select({ index, source: JSON.stringify(background) }); }} onRemove={remove}
      labels={{ add: label('panel.audioTrigger.add', 'Add background'), update: label('panel.audioTrigger.update', 'Update background'),
        new: label('panel.audioTrigger.new', 'New background'),
        edit: index => label('panel.audioTrigger.edit', 'Edit background {number}').replace('{number}', String(index + 1)),
        remove: index => label('panel.audioTrigger.remove', 'Remove background {number}').replace('{number}', String(index + 1)),
        hint: label('panel.audioTrigger.selectionHint', 'Add backgrounds from any category. One stays on while audio plays; multiple follow the rhythm.'),
        empty: label('panel.audioTrigger.empty', 'Add a background to start using Audio Trigger.') }}
      renderItem={background => <>
        {background.mode === 'solid' && <span className={styles.swatch} style={{ backgroundColor: background.color }} aria-hidden />}
        {background.mode === 'media' && background.mediaId && thumbs[background.mediaId]
          && <img className={styles.thumbnail} src={thumbs[background.mediaId]} alt="" />}
        {summary(background)}
      </>}>
      <AudioBackgroundEditor key={editingIndex ?? 'new'} background={draft} onChange={setDraft} onCommit={commit} {...device} />
    </AudioTriggerMenuContent>
  </Overlay>;
}

/** Reuses familiar controls; callers choose whether finished edits also persist. */
export function AudioBackgroundEditor({ background, onChange, onCommit, themeMode, deviceId, deviceAspect, deviceW, deviceH, round,
  hideBackgroundAppearanceControls, mediaPicker, hideSensorBindings, independentAudioPreview, staticEffect }: Omit<Props, 'value' | 'onChange' | 'beatTransition' | 'onBeatTransitionChange'> & {
  background: D215PanelBackground;
  onChange: (background: D215PanelBackground) => void;
  onCommit?: (background: D215PanelBackground) => void;
} & Pick<PanelThemeSettingsProps, 'hideBackgroundAppearanceControls' | 'mediaPicker' | 'hideSensorBindings' | 'independentAudioPreview' | 'staticEffect'>) {
  const theme = d215BackgroundTheme(background);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const source = useRef(background);
  const current = useRef(background);
  if (source.current !== background) { source.current = background; current.current = background; }
  const patch = (next: Partial<D215PanelBackground>, commit = true) => {
    if (!alive.current) return;
    current.current = { ...current.current, ...next, slideshow: false };
    onChange(current.current);
    if (commit) onCommit?.(current.current);
  };
  const color = (hex: string, commit: boolean) => { const pair = panelBackgroundPair(hex); patch({ mode: 'solid', color: pair.dark, colorLight: pair.light }, commit); };
  return <PanelThemeSettings theme={theme} sections={BACKGROUND_SECTION} resolvedThemeMode={themeMode}
    independentBackground hideSlideshowControls showEffectSearch showImmersiveBackdrop={false}
    showMediaTab={!!deviceId || !!mediaPicker} deviceId={deviceId} audioReactive
    hideBackgroundAppearanceControls={hideBackgroundAppearanceControls} mediaPicker={mediaPicker}
    hideSensorBindings={hideSensorBindings} independentAudioPreview={independentAudioPreview} staticEffect={staticEffect}
    deviceAspect={deviceAspect} roundDisplay={round} deviceW={deviceW} deviceH={deviceH}
    onBackgroundPreview={hex => color(hex, false)} onBackgroundCommit={hex => color(hex, true)} onBackgroundModeCommit={mode => patch({ mode })}
    onBackgroundEffectCommit={effect => patch({ mode: 'shader', effect, template: 0, effectState: panelBackgroundState(effect, 0) })}
    onBackgroundTemplateCommit={template => patch({ template, effectState: panelBackgroundState(theme.backgroundEffect, template) })}
    onBackgroundEffectStatePreview={effectState => patch({ effectState }, false)} onBackgroundEffectStateCommit={effectState => patch({ effectState })}
    onBackgroundOpacityPreview={opacity => patch({ opacity }, false)} onBackgroundOpacityCommit={opacity => patch({ opacity })}
    onBackgroundMediaCommit={(mediaId, mediaType, mediaAlpha) => patch({ mode: 'media', mediaId, mediaType, mediaAlpha })}
    onBackgroundSlideshowCommit={noop} onBackgroundMediaOrderCommit={noop}
    onBackgroundFrostPreview={frost => patch({ frost }, false)} onBackgroundFrostCommit={frost => patch({ frost })}
    onThemeSyncCommit={noop} onThemeModeCommit={noop} onAccentSyncCommit={noop} onAccentPreview={noop} onAccentCommit={noop}
    onBackdropCommit={noop} onImmersiveBackdropCommit={noop} onWidgetOpacityPreview={noop} onWidgetOpacityCommit={noop}
    onWidgetLabelsCommit={noop} onWidgetPaddingPreview={noop} onWidgetPaddingCommit={noop}
    onTextColorModeCommit={noop} onTextColorPreview={noop} onTextColorCommit={noop} onFontCommit={noop} />;
}
