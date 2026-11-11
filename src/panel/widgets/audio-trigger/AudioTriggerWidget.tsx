import { Expand } from 'lucide-react';
import { useTranslation } from '../../../lib/i18n';
import { Toggle } from '../../../components/common/Toggle/Toggle';
import { usePanelPreview } from '../common/PanelPreviewContext';
import type { WidgetProps } from '../types';
import { AudioTriggerGlyph } from './AudioTriggerGlyph';
import { AudioIntensitySlider } from './AudioIntensitySlider';
import { useAudioTriggerTargets } from './useAudioTriggerTargets';
import styles from './AudioTriggerWidget.module.scss';

function useControls() {
  const control = useAudioTriggerTargets(usePanelPreview());
  const count = control.targets.length;
  const enabled = control.targets.filter(target => target.enabled).length;
  const value = count ? Math.round(control.targets.reduce((sum, target) => sum + target.intensity, 0) / count) : 50;
  return { ...control, count, enabled, value, mixed: enabled > 0 && enabled < count,
    mixedIntensity: count > 1 && control.targets.some(target => target.intensity !== control.targets[0].intensity),
    disabled: control.loading || control.error === 'load' || count === 0 };
}

function ControlStatus({ control }: { control: ReturnType<typeof useControls> }) {
  const { t } = useTranslation();
  if (control.error) return <div className={styles.error} role="alert">
    <span>{t(`panel.audioTrigger.widget.${control.error}Error`)}</span>
    <button type="button" onClick={event => { event.stopPropagation(); control.refresh(); }}>{t('common.retry')}</button>
  </div>;
  return <span className={styles.status} role="status" aria-live="polite">
    {control.loading ? t('panel.audioTrigger.widget.loading') : control.count === 0 ? t('panel.audioTrigger.widget.empty')
      : control.saving ? t('panel.audioTrigger.widget.saving') : control.mixed ? t('common.mixed')
        : control.enabled ? t('panel.audioTrigger.widget.on') : t('panel.audioTrigger.widget.off')}
  </span>;
}

export function AudioTriggerWidget({ onEnterImmersive }: WidgetProps) {
  const { t } = useTranslation();
  const control = useControls();
  const toggleLabel = t(control.enabled ? 'panel.audioTrigger.widget.turnOff' : 'panel.audioTrigger.widget.turnOn');
  return <div className={styles.tile} data-audio-trigger-widget onClick={() => onEnterImmersive?.()}>
    <button type="button" className={styles.master} data-on={control.enabled > 0} aria-pressed={control.enabled > 0}
      aria-label={toggleLabel} disabled={control.disabled}
      onPointerDown={event => event.stopPropagation()}
      onClick={event => { event.stopPropagation(); control.change({ enabled: control.enabled === 0 }); }}>
      <AudioTriggerGlyph size="1.8em" /><span>{t('panel.widget.audio-trigger')}</span>
    </button>
    <AudioIntensitySlider value={control.value} mixed={control.mixedIntensity} disabled={control.disabled}
      ariaLabel={t('panel.audioTrigger.widget.intensity')} onChange={intensity => control.change({ intensity })} />
    <div className={styles.footer}>
      <ControlStatus control={control} />
      {onEnterImmersive && <button type="button" className={styles.expand} aria-label={t('panel.audioTrigger.widget.devices')}
        onPointerDown={event => event.stopPropagation()}
        onClick={event => { event.stopPropagation(); onEnterImmersive(); }}><Expand size={17} /></button>}
    </div>
  </div>;
}

export function AudioTriggerTouch({ widget }: WidgetProps) {
  const { t } = useTranslation();
  const control = useControls();
  return <section className={styles.immersive} data-audio-trigger-immersive data-widget-id={widget.id} aria-label={t('panel.widget.audio-trigger')}>
    <header className={styles.header}>
      <AudioTriggerGlyph size={36} /><h1>{t('panel.widget.audio-trigger')}</h1>
    </header>
    <div className={styles.universal}>
      <div className={styles.rowHeading}><strong>{t('panel.audioTrigger.widget.allDevices')}</strong>
        <Toggle checked={control.enabled > 0} mixed={control.mixed} disabled={control.disabled}
          ariaLabel={t('panel.audioTrigger.widget.allDevices')}
          onChange={enabled => control.change({ enabled })} /></div>
      <AudioIntensitySlider value={control.value} mixed={control.mixedIntensity} disabled={control.disabled}
        ariaLabel={t('panel.audioTrigger.widget.intensity')} onChange={intensity => control.change({ intensity })} />
      <ControlStatus control={control} />
    </div>
    <div className={styles.deviceList}>
      {control.targets.map(target => <section className={styles.device} key={target.id}>
        <div className={styles.rowHeading}>
          <div className={styles.deviceName}><strong>{target.name}</strong>
            <span>{t(`panel.audioTrigger.widget.${target.kind}`)}</span></div>
          <Toggle checked={target.enabled} disabled={control.disabled}
            ariaLabel={`${target.name} ${t('panel.widget.audio-trigger')}`}
            onChange={enabled => control.change({ targetIds: [target.id], enabled })} />
        </div>
        <AudioIntensitySlider value={target.intensity} disabled={control.disabled}
          ariaLabel={`${target.name} ${t('panel.audioTrigger.widget.deviceIntensity')}`}
          onChange={intensity => control.change({ targetIds: [target.id], intensity })} />
      </section>)}
    </div>
  </section>;
}
