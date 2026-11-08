import { Select } from '../../../../components/common/Select/Select';
import type { LightingAudioOutput } from '../../../../hooks/useLightingAudioOutput';
import { useTranslation } from '../../../../lib/i18n';

/** The service-wide capture source for audio-reactive effects. The owner keeps the hook mounted so a pick survives this picker coming and going. */
export function AudioSourceSelect({ output, className, ariaLabel }: { output: LightingAudioOutput; className?: string; ariaLabel?: string }) {
  const { t } = useTranslation();
  return (
    <Select
      className={className}
      value={output.value}
      options={output.options}
      onChange={output.select}
      ariaLabel={ariaLabel ?? t('lighting.audioOutput.label')}
      height={26}
    />
  );
}
