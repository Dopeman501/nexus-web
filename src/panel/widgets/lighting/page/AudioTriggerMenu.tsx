import { useState } from 'react';
import { SettingRow, SettingToggle } from '../../../../components/common/SettingRow/SettingRow';
import { Button } from '../../../../components/common/Button/Button';
import { Notice } from '../../../../components/common/Notice/Notice';
import { LIGHTING_AUDIO_TRIGGER_MAX_LOOKS, type LightingAudioTriggerLook, type LightingAudioTriggerSettings } from '../../../../api/lightingAudioTrigger';
import type { LightingAudioOutput } from '../../../../hooks/useLightingAudioOutput';
import { useTranslation } from '../../../../lib/i18n';
import { EFFECTS, type EffectState } from '../../../../types/lighting';
import { AudioSourceSelect } from './AudioSourceSelect';
import { AudioTriggerLookEditor } from './AudioTriggerLookEditor';
import styles from './AudioTriggerMenu.module.scss';
import sharedStyles from '../../../background/AudioTriggerSettings.module.scss';
import { AudioTriggerMenuContent } from '../../../background/AudioTriggerMenuContent';
import { useMediaLibrary } from '../effecteditor/useMediaLibrary';

interface Props {
  value: LightingAudioTriggerSettings;
  onChange: (patch: Partial<LightingAudioTriggerSettings>) => void;
  stateFor: (effect: string) => EffectState;
  output?: LightingAudioOutput;
  busy?: boolean;
  error?: 'load' | 'save' | null;
  onRetry?: () => void;
}

const NEW_LOOK: LightingAudioTriggerLook = { mode: 'static', color: '#7f1d1d' };

/** Saves local look snapshots; the native engine owns detection and transient output. */
export function AudioTriggerMenu({ value, onChange, stateFor, output, busy = false, error, onRetry }: Props) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<LightingAudioTriggerLook>(NEW_LOOK);
  const [editing, setEditing] = useState<number | null>(null);
  const [editingSource, setEditingSource] = useState('');
  const { items, thumbs } = useMediaLibrary();
  // A remote list edit must not retarget an in-progress draft to another look.
  const editingIndex = editing !== null && (busy || JSON.stringify(value.looks[editing]) === editingSource) ? editing : null;
  const summary = (look: LightingAudioTriggerLook) => look.mode === 'media'
    ? items.find(item => item.id === look.mediaId)?.name ?? t('panel.audioTrigger.mediaUnavailable')
    : look.color ?? t(EFFECTS.find(effect => effect.key === look.effect)?.labelKey ?? 'lighting.mode.animate');
  const save = () => {
    if (busy || (draft.mode === 'media' && !draft.mediaId) || (editingIndex === null && value.looks.length >= LIGHTING_AUDIO_TRIGGER_MAX_LOOKS)) return;
    const look = structuredClone(draft);
    onChange({ looks: editingIndex === null ? [...value.looks, look] : value.looks.map((item, index) => index === editingIndex ? look : item) });
    // Retain the target until confirmation: a rejected Update remains an Update.
    if (editingIndex === null) setEditing(null);
  };
  const remove = (index: number) => {
    onChange({ looks: value.looks.filter((_, item) => item !== index) });
    if (editingIndex === index) { setEditing(null); setDraft(NEW_LOOK); }
    else if (editingIndex !== null && editingIndex > index) setEditing(editingIndex - 1);
  };
  return (
    <section className={styles.menu} role="tabpanel" aria-label={t('lighting.audioTrigger.title')}>
      <SettingToggle label={t('lighting.audioTrigger.title')} checked={value.enabled} onChange={enabled => onChange({ enabled })} disabled={busy}
        description={t('lighting.audioTrigger.description')} />
      {error && <Notice tone="warning">{t(`lighting.audioTrigger.${error}Error`)}
        {onRetry && <Button size="sm" onClick={onRetry}>{t('lighting.audioTrigger.retry')}</Button>}
      </Notice>}
      <fieldset className={styles.controls} disabled={busy}>
      <AudioTriggerMenuContent intensity={value.intensity} switchDelay={value.switchDelay} shuffle={value.shuffle}
        onChange={onChange} items={value.looks} maximum={LIGHTING_AUDIO_TRIGGER_MAX_LOOKS} editingIndex={editingIndex}
        canSave={(editingIndex !== null || value.looks.length < LIGHTING_AUDIO_TRIGGER_MAX_LOOKS) && (draft.mode !== 'media' || !!draft.mediaId)}
        onSave={save} onRemove={remove} onNew={() => { setEditing(null); setDraft(NEW_LOOK); }}
        onEdit={(look, index) => { setDraft(structuredClone(look)); setEditing(index); setEditingSource(JSON.stringify(look)); }}
        labels={{ add: t('lighting.audioTrigger.add'), update: t('lighting.audioTrigger.update'), new: t('lighting.audioTrigger.new'),
          edit: index => `${t('lighting.audioTrigger.edit')} ${index + 1}`, remove: index => `${t('lighting.audioTrigger.remove')} ${index + 1}`,
          hint: t('panel.audioTrigger.selectionHint'), empty: t('lighting.audioTrigger.empty') }}
        leadingControls={output && <SettingRow label={t('lighting.audioTrigger.source')} stackOnNarrow>
          <AudioSourceSelect output={output} className={styles.source} ariaLabel={t('lighting.audioTrigger.source')} />
        </SettingRow>}
        renderItem={look => <>
          {look.color && <span className={sharedStyles.swatch} style={{ backgroundColor: look.color }} aria-hidden />}
          {look.mediaId && thumbs[look.mediaId] && <img className={sharedStyles.thumbnail} src={thumbs[look.mediaId]} alt="" />}
          {summary(look)}
        </>}>
        <AudioTriggerLookEditor key={editingIndex ?? 'new'} value={draft} onChange={setDraft} stateFor={stateFor} />
      </AudioTriggerMenuContent>
      </fieldset>
    </section>
  );
}
