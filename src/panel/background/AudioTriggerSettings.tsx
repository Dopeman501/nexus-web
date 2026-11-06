import { useEffect, useRef, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '../../components/common/Button/Button';
import { Overlay } from '../../components/common/Overlay/Overlay';
import { SettingRow, SettingSlider, SettingToggle } from '../../components/common/SettingRow/SettingRow';
import { Toggle } from '../../components/common/Toggle/Toggle';
import { Notice } from '../../components/common/Notice/Notice';
import { useTranslation } from '../../lib/i18n';
import { EFFECTS } from '../../types/lighting';
import { PanelThemeSettings } from '../editor/PanelThemeSettings';
import { d215BackgroundTheme, readD215PanelBackground, type D215PanelBackground } from '../d215/d215PanelBackground';
import { panelBackgroundPair, panelBackgroundState } from './panelBackground';
import { AUDIO_TRIGGER_MAX_BACKGROUNDS, type AudioTriggerSettings } from './audioTrigger';
import { useBackgroundMedia } from './useBackgroundMedia';
import styles from './AudioTriggerSettings.module.scss';

const DEFAULT_SETTINGS: AudioTriggerSettings = { enabled: false, intensity: 50, switchDelay: 1, shuffle: false, backgrounds: [] };
const NEW_BACKGROUND: D215PanelBackground = { mode: 'solid', color: '#0f0f0f', colorLight: '#fafafa', opacity: 1, frost: 0, slideshow: false };
const noop = () => {};
const BACKGROUND_SECTION = 'background';

interface Props {
  value?: AudioTriggerSettings;
  onChange: (value: AudioTriggerSettings) => void;
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
    {open && <AudioTriggerBackgrounds {...props} value={value} onClose={() => setOpen(false)} />}
  </>;
}

function AudioTriggerBackgrounds({ value, onChange, onClose, ...device }: Props & {
  value: AudioTriggerSettings;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const label = (key: string, fallback: string) => { const text = t(key); return text === key ? fallback : text; };
  const [draft, setDraft] = useState<D215PanelBackground>(NEW_BACKGROUND);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [intensity, setIntensity] = useState(value.intensity);
  const [delay, setDelay] = useState(value.switchDelay);
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
    const backgrounds = editingIndex === null
      ? [...current.current.backgrounds, background]
      : current.current.backgrounds.map((item, index) => index === editingIndex ? background : item);
    if (backgrounds.length > AUDIO_TRIGGER_MAX_BACKGROUNDS) return;
    change({ backgrounds });
    setEditingIndex(null);
  };
  const remove = (index: number) => {
    change({ backgrounds: current.current.backgrounds.filter((_, itemIndex) => itemIndex !== index) });
    if (editingIndex === index) { setEditingIndex(null); setDraft(NEW_BACKGROUND); }
    else if (editingIndex !== null && editingIndex > index) setEditingIndex(editingIndex - 1);
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
    <div className={styles.body}>
      <SettingSlider editable trackFill label={label('panel.audioTrigger.intensity', 'Audio Intensity')}
        description={label('panel.audioTrigger.intensityHint', 'Higher sensitivity responds to quieter audio and softer beats')}
        descriptionBelow value={intensity} min={0} max={100} step={1} formatValue={number => `${number}%`}
        onChange={(number, commit) => { setIntensity(number); if (commit) change({ intensity: number }); }}
        onCommit={number => change({ intensity: number })} />
      <SettingSlider editable trackFill label={label('panel.audioTrigger.delay', 'Switch Delay')}
        description={label('panel.audioTrigger.delayHint', 'Wait before entering Audio Trigger or returning after silence; beat changes stay immediate')}
        descriptionBelow value={delay} min={0} max={10} step={0.1} formatValue={number => `${number.toFixed(1)} s`}
        onChange={(number, commit) => { setDelay(number); if (commit) change({ switchDelay: number }); }}
        onCommit={number => change({ switchDelay: number })} />
      <SettingToggle label={label('slideshow.shuffle', 'Shuffle')} checked={value.shuffle}
        onChange={shuffle => change({ shuffle })} />
      <p className={styles.hint}>{label('panel.audioTrigger.selectionHint', 'Add backgrounds from any category. One stays on while audio plays; multiple follow the rhythm.')}</p>
      {value.backgrounds.length === 0 && <Notice tone="info">{label('panel.audioTrigger.empty', 'Add a background to start using Audio Trigger.')}</Notice>}
      <ol className={styles.selection}>
        {value.backgrounds.map((background, index) => <li key={index}>
          <Button size="sm" tone={editingIndex === index ? 'accent' : 'neutral'}
            aria-label={label('panel.audioTrigger.edit', 'Edit background {number}').replace('{number}', String(index + 1))}
            onClick={() => { setDraft(background); setEditingIndex(index); }}>
            {background.mode === 'solid' && <span className={styles.swatch} style={{ backgroundColor: background.color }} aria-hidden />}
            {background.mode === 'media' && background.mediaId && thumbs[background.mediaId]
              && <img className={styles.thumbnail} src={thumbs[background.mediaId]} alt="" />}
            {index + 1}. {summary(background)}
          </Button>
          <Button size="sm" tone="ghost" icon={<Trash2 />} onClick={() => remove(index)}
            aria-label={label('panel.audioTrigger.remove', 'Remove background {number}').replace('{number}', String(index + 1))} />
        </li>)}
      </ol>
      <div className={styles.actions}>
        {editingIndex !== null && <Button size="sm" icon={<Plus />} onClick={() => { setEditingIndex(null); setDraft(NEW_BACKGROUND); }}>
          {label('panel.audioTrigger.new', 'New background')}
        </Button>}
        <Button size="sm" tone="accent" disabled={!canSave} onClick={save}>
          {editingIndex === null ? label('panel.audioTrigger.add', 'Add background') : label('panel.audioTrigger.update', 'Update background')}
        </Button>
        <span className={styles.hint}>{value.backgrounds.length} / {AUDIO_TRIGGER_MAX_BACKGROUNDS}</span>
      </div>
      <AudioBackgroundEditor key={editingIndex ?? 'new'} background={draft} onChange={setDraft} {...device} />
    </div>
  </Overlay>;
}

/** Reuses familiar controls while all previews and commits stay in the local draft. */
function AudioBackgroundEditor({ background, onChange, themeMode, deviceId, deviceAspect, deviceW, deviceH, round }: Omit<Props, 'value' | 'onChange'> & {
  background: D215PanelBackground;
  onChange: (background: D215PanelBackground) => void;
}) {
  const theme = d215BackgroundTheme(background);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const source = useRef(background);
  const current = useRef(background);
  if (source.current !== background) { source.current = background; current.current = background; }
  const patch = (next: Partial<D215PanelBackground>) => {
    if (!alive.current) return;
    current.current = { ...current.current, ...next, slideshow: false };
    onChange(current.current);
  };
  const color = (hex: string) => { const pair = panelBackgroundPair(hex); patch({ mode: 'solid', color: pair.dark, colorLight: pair.light }); };
  return <PanelThemeSettings theme={theme} sections={BACKGROUND_SECTION} resolvedThemeMode={themeMode}
    independentBackground hideSlideshowControls showEffectSearch showImmersiveBackdrop={false}
    showMediaTab={!!deviceId} deviceId={deviceId} audioReactive
    deviceAspect={deviceAspect} roundDisplay={round} deviceW={deviceW} deviceH={deviceH}
    onBackgroundPreview={color} onBackgroundCommit={color} onBackgroundModeCommit={mode => patch({ mode })}
    onBackgroundEffectCommit={effect => patch({ mode: 'shader', effect, template: 0, effectState: panelBackgroundState(effect, 0) })}
    onBackgroundTemplateCommit={template => patch({ template, effectState: panelBackgroundState(theme.backgroundEffect, template) })}
    onBackgroundEffectStatePreview={effectState => patch({ effectState })} onBackgroundEffectStateCommit={effectState => patch({ effectState })}
    onBackgroundOpacityPreview={opacity => patch({ opacity })} onBackgroundOpacityCommit={opacity => patch({ opacity })}
    onBackgroundMediaCommit={(mediaId, mediaType, mediaAlpha) => patch({ mode: 'media', mediaId, mediaType, mediaAlpha })}
    onBackgroundSlideshowCommit={noop} onBackgroundMediaOrderCommit={noop}
    onBackgroundFrostPreview={frost => patch({ frost })} onBackgroundFrostCommit={frost => patch({ frost })}
    onThemeSyncCommit={noop} onThemeModeCommit={noop} onAccentSyncCommit={noop} onAccentPreview={noop} onAccentCommit={noop}
    onBackdropCommit={noop} onImmersiveBackdropCommit={noop} onWidgetOpacityPreview={noop} onWidgetOpacityCommit={noop}
    onWidgetLabelsCommit={noop} onWidgetPaddingPreview={noop} onWidgetPaddingCommit={noop}
    onTextColorModeCommit={noop} onTextColorPreview={noop} onTextColorCommit={noop} onFontCommit={noop} />;
}
