import { useEffect, useRef, useState } from 'react';
import { restartD215Screen, type D215RestartResult } from '../../../api/d215Restart';
import { useTranslation } from '../../../lib/i18n';
import { Button } from '../../common/Button/Button';
import { SettingRow } from '../../common/SettingRow/SettingRow';
import { SettingsSection } from '../../common/SettingsSection/SettingsSection';
import styles from './PanelDevicePage.module.scss';

const COPY = 'devices.jungle-leopard-d215.restart';

export function D215RestartSettings({ recordId }: { recordId: string }) {
  return <RestartControl key={recordId} recordId={recordId} />;
}

function RestartControl({ recordId }: { recordId: string }) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<D215RestartResult['status'] | 'idle' | 'restarting'>('idle');
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => { pending.current?.abort(); }, []);

  const restart = () => {
    if (pending.current) return;
    const request = new AbortController();
    pending.current = request;
    setStatus('restarting');
    void restartD215Screen(recordId, request.signal).catch(() => ({ status: 'uncertain' } as const)).then(result => {
      if (request.signal.aborted || pending.current !== request) return;
      pending.current = null;
      setStatus(result.status);
    });
  };

  const label = t(`${COPY}.label`);
  const message = status === 'idle' ? t(`${COPY}.hint`) : <span role="status">{t(`${COPY}.${status}`)}</span>;
  return (
    <SettingsSection ariaLabel={label} boxClassName={styles.deviceSettingsBox}>
      <SettingRow label={label} description={message} stackOnNarrow>
        <Button size="sm" disabled={status === 'restarting'} onClick={restart}>
          {status === 'restarting' ? t(`${COPY}.restarting`) : label}
        </Button>
      </SettingRow>
    </SettingsSection>
  );
}
