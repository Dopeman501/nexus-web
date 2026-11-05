import { useCallback, useEffect, useRef, useState } from 'react';
import { D215_BRIGHTNESS_PRESETS, fetchD215Brightness, setD215Brightness, type D215BrightnessResult } from '../../../api/d215Brightness';
import { useTranslation } from '../../../lib/i18n';
import { Button } from '../../common/Button/Button';
import { SettingRow } from '../../common/SettingRow/SettingRow';
import { SettingsSection } from '../../common/SettingsSection/SettingsSection';
import styles from './PanelDevicePage.module.scss';

const COPY = 'devices.jungle-leopard-d215.brightness';

type Pending = { status: 'reading' | 'writing'; value: number | null };
const READING: Pending = { status: 'reading', value: null };

export function D215BrightnessSettings({ recordId }: { recordId: string }) {
  const { t, language } = useTranslation();
  const [brightness, setBrightness] = useState<D215BrightnessResult | Pending>(READING);
  const current = useRef<AbortController | null>(null);
  const run = useCallback((operation: (signal: AbortSignal) => Promise<D215BrightnessResult>, pending?: Pending) => {
    if (current.current) return;
    const request = new AbortController();
    current.current = request;
    if (pending) setBrightness(pending);
    void operation(request.signal).then(result => {
      if (request.signal.aborted) return;
      current.current = null;
      setBrightness(result);
    });
  }, []);

  useEffect(() => {
    run(signal => fetchD215Brightness(recordId, signal));
    return () => {
      current.current?.abort();
      current.current = null;
    };
  }, [recordId, run]);

  const { status, value } = brightness;
  const pending = status === 'reading' || status === 'writing';
  const canSet = value !== null && (status === 'confirmed' || status === 'mismatch');
  const label = t('devices.y70.brightness');
  const percent = new Intl.NumberFormat(language, { style: 'percent' });
  const message = status === 'reading' ? t('common.loading') : status === 'confirmed' ? null : t(`${COPY}.${status}`);
  const readback = (
    <span role="status">
      {message && <span>{message} </span>}
      {!pending && <span>{value === null ? t(`${COPY}.unknown`) : percent.format(value / 100)}</span>}
    </span>
  );

  return (
    <SettingsSection ariaLabel={label} boxClassName={styles.deviceSettingsBox}>
      <SettingRow label={label} description={readback} stackOnNarrow>
        {D215_BRIGHTNESS_PRESETS.map(preset => (
          <Button
            key={preset}
            size="sm"
            tone={value === preset ? 'accent' : 'neutral'}
            aria-pressed={value === preset}
            disabled={!canSet || value === preset}
            onClick={() => run(() => setD215Brightness(recordId, preset), { status: 'writing', value })}
          >
            {percent.format(preset / 100)}
          </Button>
        ))}
        {!pending && !canSet && (
          <Button size="sm" onClick={() => run(signal => fetchD215Brightness(recordId, signal), READING)}>
            {t('diagnostics.refresh')}
          </Button>
        )}
      </SettingRow>
    </SettingsSection>
  );
}
