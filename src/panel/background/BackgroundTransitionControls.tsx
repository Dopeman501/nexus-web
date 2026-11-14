import { useRef, useState } from 'react';
import { Button } from '../../components/common/Button/Button';
import { SettingRow } from '../../components/common/SettingRow/SettingRow';
import { Toggle } from '../../components/common/Toggle/Toggle';
import { useTranslation } from '../../lib/i18n';
import { BackgroundTransitionPicker } from './BackgroundTransitionPicker';
import { normalizeSharedBackgroundTransitions, type SharedBackgroundTransitionSettings } from './transitions/settings';
import { useBackgroundTransitionPreviewPublisher } from './useBackgroundTransitionPreviewPublisher';

const INITIAL_EFFECT = 'gl-transitions:WaterDrop';

/** A single preference and picker drive Slideshow and Audio Trigger together. */
export function BackgroundTransitionControls({ value, onCommit, deviceId }: {
  value?: SharedBackgroundTransitionSettings;
  onCommit: (value: SharedBackgroundTransitionSettings) => void;
  deviceId?: string | null;
}) {
  const { t } = useTranslation();
  const saved = normalizeSharedBackgroundTransitions(value);
  const sourceKey = JSON.stringify(saved);
  const [local, setLocal] = useState({ deviceId, sourceKey, value: saved });
  const [dialog, setDialog] = useState<{ deviceId: typeof deviceId; open: boolean }>({ deviceId, open: false });
  const changed = local.deviceId !== deviceId || local.sourceKey !== sourceKey;
  if (changed) setLocal({ deviceId, sourceKey, value: saved });
  const settings = changed ? saved : local.value;
  const latest = useRef(settings);
  latest.current = settings;
  const open = dialog.deviceId === deviceId && dialog.open;
  const audition = useBackgroundTransitionPreviewPublisher(deviceId, open);
  const update = (next: SharedBackgroundTransitionSettings, persist: boolean) => {
    latest.current = next;
    setLocal({ deviceId, sourceKey, value: next });
    if (persist) onCommit(next);
  };
  return <>
    <SettingRow label={t('panel.transitions.title')} description={t('panel.transitions.help')} descriptionBelow>
      <Toggle checked={settings.enabled} ariaLabel={t('panel.transitions.title')}
        onChange={enabled => update({ ...latest.current, enabled,
          effects: enabled && latest.current.effects.length === 0 ? [INITIAL_EFFECT] : latest.current.effects }, true)} />
      <Button size="sm" onClick={() => setDialog({ deviceId, open: true })}>{t('panel.transitions.title')}</Button>
    </SettingRow>
    {open && <BackgroundTransitionPicker value={settings} error={audition.error}
      onClose={() => setDialog({ deviceId, open: false })}
      onDurationChange={durationMs => update({ ...latest.current, durationMs }, false)}
      onDurationCommit={durationMs => update(normalizeSharedBackgroundTransitions({ ...latest.current, durationMs }), true)}
      onSelect={effect => {
        const current = latest.current;
        const effects = current.effects.includes(effect) ? current.effects.filter(key => key !== effect) : [...current.effects, effect];
        update({ ...current, effects, enabled: current.enabled && effects.length > 0 }, true);
        audition.preview(effect, current.durationMs);
      }} />}
  </>;
}
