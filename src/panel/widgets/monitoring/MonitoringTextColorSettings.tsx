import { ColorPickerWithPresets } from '../../../components/common/ColorPickerWithPresets/ColorPickerWithPresets';
import { useTranslation } from '../../../lib/i18n';
import { PRESET_ACCENTS } from '../../../lib/settings';
import { DEFAULT_CUSTOM_TEXT_COLOR } from '../../theme/textColor';
import type { WidgetSettingsProps } from '../types';
import { SettingsButton, SettingsRow } from '../common/SettingsRow/SettingsRow';
import { monitoringTextColor } from './monitoringTextColor';

const TEXT_COLORS = ['#ffffff', '#000000', ...PRESET_ACCENTS];

export function MonitoringTextColorSettings({ widget, onUpdate }: Pick<WidgetSettingsProps, 'widget' | 'onUpdate'>) {
  const { t } = useTranslation();
  const color = monitoringTextColor(widget.config?.textColor);
  return <div role="group" aria-label={t('panel.settings.textColor')}>
    <SettingsRow label={t('panel.settings.textColor')}>
      <SettingsButton variant="muted" disabled={widget.config?.textColor == null}
        aria-label={`${t('panel.settings.textColor')}: ${t('monitoring.settings.resetLabel')}`}
        onClick={() => onUpdate({ textColor: null })}>
        {t('monitoring.settings.resetLabel')}
      </SettingsButton>
    </SettingsRow>
    <ColorPickerWithPresets value={color || DEFAULT_CUSTOM_TEXT_COLOR} presets={TEXT_COLORS}
      onCommit={hex => onUpdate({ textColor: hex })} allowCustom pickerPortal />
  </div>;
}
