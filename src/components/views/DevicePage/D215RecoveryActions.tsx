import { useEffect, useRef, useState } from 'react';
import { RotateCw } from 'lucide-react';
import { fetchPanelDevices } from '../../../api/panel';
import { restartD215Screen, type D215RestartResult } from '../../../api/d215Restart';
import { JUNGLE_LEOPARD_D215_FAMILY } from '../../../panel/types';
import { useTranslation } from '../../../lib/i18n';
import { Button } from '../../common/Button/Button';
import styles from './D215RecoveryActions.module.scss';

const COPY = 'devices.jungle-leopard-d215';
type Action = 'control' | 'screen';

async function bounded<T>(work: Promise<T>, signal: AbortSignal): Promise<T | null> {
  if (signal.aborted) return null;
  let cancel!: () => void;
  const cancelled = new Promise<null>(resolve => { cancel = () => resolve(null); });
  signal.addEventListener('abort', cancel, { once: true });
  const timer = window.setTimeout(cancel, 10_000);
  try {
    return await Promise.race([work.catch(() => null), cancelled]);
  } finally {
    window.clearTimeout(timer);
    signal.removeEventListener('abort', cancel);
  }
}

async function restartSavedScreen(signal: AbortSignal): Promise<D215RestartResult> {
  // The failed stream has no panel row. Its saved record still identifies the
  // Settings restart endpoint; never choose between multiple stored displays.
  const saved = await bounded(fetchPanelDevices(), signal);
  const matches = Array.isArray(saved?.devices) ? saved.devices.filter(record => typeof record?.id === 'string'
    && record.id.length > 0 && record.capabilities?.family === JUNGLE_LEOPARD_D215_FAMILY
    && (record.capabilities.surface === 'lcd-wide' || record.capabilities.surface === 'lcd-portrait')) : [];
  if (signal.aborted || matches?.length !== 1) return { status: 'unavailable' };
  return restartD215Screen(matches[0].id, signal).catch(() => ({ status: 'uncertain' }));
}

export function D215RecoveryActions({ controlDevice }: {
  controlDevice: (id: string, enabled: boolean) => Promise<unknown>;
}) {
  const { t } = useTranslation();
  const [action, setAction] = useState<Action | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => { pending.current?.abort(); }, []);

  const restart = async (next: Action) => {
    if (pending.current) return;
    const request = new AbortController();
    pending.current = request;
    setAction(next);
    setMessage(null);
    let result: string;
    try {
      if (next === 'control') {
        // Reasserting enabled emits the native gate event that retires the old
        // D215 lease and resets retries, without an intervening disabled state.
        const accepted = await bounded(controlDevice(JUNGLE_LEOPARD_D215_FAMILY, true), request.signal);
        result = `${COPY}.recovery.${accepted === true ? 'controlRequested' : 'controlFailed'}`;
      } else {
        const response = await restartSavedScreen(request.signal);
        result = `${COPY}.restart.${response.status}`;
      }
    } catch {
      result = next === 'control' ? `${COPY}.recovery.controlFailed` : `${COPY}.restart.unavailable`;
    }
    if (request.signal.aborted || pending.current !== request) return;
    pending.current = null;
    setAction(null);
    setMessage(result);
  };

  return (
    <div className={styles.recovery}>
      <div className={styles.actions} role="group" aria-label={t(`${COPY}.recovery.actions`)}>
        <Button tone="accent" icon={<RotateCw size={16} />} disabled={action !== null} onClick={() => void restart('control')}>
          {t(`${COPY}.recovery.${action === 'control' ? 'restartingControl' : 'control'}`)}
        </Button>
        <Button icon={<RotateCw size={16} />} disabled={action !== null} onClick={() => void restart('screen')}>
          {t(`${COPY}.restart.${action === 'screen' ? 'restarting' : 'label'}`)}
        </Button>
      </div>
      <p className={styles.message} role="status">
        {t(message ?? (action === 'control' ? `${COPY}.recovery.restartingControl`
          : action === 'screen' ? `${COPY}.restart.restarting` : `${COPY}.recovery.hint`))}
      </p>
    </div>
  );
}
