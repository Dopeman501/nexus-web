import { useRef, useState } from 'react';
import { SettingSlider, SettingToggle } from '../../components/common/SettingRow/SettingRow';
import { useTranslation } from '../../lib/i18n';
import { normalizeBackgroundTransition, type AudioTriggerBeatTransitionSettings } from './transitions/settings';

/** Beat swaps have their own timing; activation continues to use the main preference. */
export function BeatTransitionControls({ value, onChange }: {
  value?: AudioTriggerBeatTransitionSettings;
  onChange: (value: AudioTriggerBeatTransitionSettings) => void;
}) {
  const { t } = useTranslation();
  const saved = { enabled: value?.enabled === true,
    durationMs: normalizeBackgroundTransition({ durationMs: value?.durationMs }).durationMs };
  const sourceKey = JSON.stringify(saved);
  const [local, setLocal] = useState({ sourceKey, value: saved });
  const changed = local.sourceKey !== sourceKey;
  if (changed) setLocal({ sourceKey, value: saved });
  const settings = changed ? saved : local.value;
  const latest = useRef(settings);
  latest.current = settings;
  const label = (key: string, fallback: string) => { const text = t(key); return text === key ? fallback : text; };
  const update = (next: AudioTriggerBeatTransitionSettings, persist: boolean) => {
    latest.current = next;
    setLocal({ sourceKey, value: next });
    if (persist) onChange(next);
  };
  const formatDuration = (durationMs: number) => {
    const key = 'panel.transitions.milliseconds';
    const text = t(key, { value: durationMs });
    return text === key ? `${durationMs} ms` : text;
  };
  return <>
    <SettingToggle label={label('panel.audioTrigger.beatTransitions', 'Beat transitions')}
      description={label('panel.audioTrigger.beatTransitionsHint', 'Only background swaps between beats. Activation uses the main transition duration.')}
      checked={settings.enabled} onChange={enabled => update({ ...latest.current, enabled }, true)} />
    <SettingSlider label={label('panel.transitions.duration', 'Transition duration')} value={settings.durationMs}
      min={80} max={5000} step={10} editable={settings.enabled} disabled={!settings.enabled} trackFill
      formatValue={formatDuration} onChange={durationMs => update({ ...latest.current, durationMs }, false)}
      onCommit={durationMs => update({ ...latest.current,
        durationMs: normalizeBackgroundTransition({ durationMs }).durationMs }, true)} />
  </>;
}
