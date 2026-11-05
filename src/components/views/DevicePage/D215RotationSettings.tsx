import { useEffect, useRef, useState } from 'react';
import { patchPanelDevice } from '../../../api/panel';
import { useTranslation } from '../../../lib/i18n';
import { ChipGroup } from '../../common/ChipGroup/ChipGroup';
import { SettingRow } from '../../common/SettingRow/SettingRow';
import { SettingsSection } from '../../common/SettingsSection/SettingsSection';
import styles from './PanelDevicePage.module.scss';

const ROTATIONS = [0, 90, 180, 270] as const;
type Mount = { portrait: boolean; flip180: boolean };

/** Keep the preview canonical; the service turns complete frames for the glass. */
export function D215RotationSettings({ recordId, portrait, flip180, onSaved, onSaveFailed }: Mount & {
  recordId?: string;
  onSaved: (mount: Mount) => void;
  onSaveFailed: () => void;
}) {
  const { t } = useTranslation();
  const [saving, setSaving] = useState(false);
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => { pending.current?.abort(); }, []);

  const activeRotation = (portrait ? 90 : 0) + (flip180 ? 180 : 0);
  const changeRotation = (key: string) => {
    const angle = ROTATIONS.find(value => String(value) === key);
    if (!recordId || pending.current || angle === undefined || angle === activeRotation) return;
    // Both fields travel in one patch so discovery never sees a half-applied turn.
    const mount = { portrait: angle === 90 || angle === 270, flip180: angle >= 180 };
    const request = new AbortController();
    pending.current = request;
    setSaving(true);
    void patchPanelDevice(recordId, mount).then(record => {
      if (request.signal.aborted) return;
      if (record) onSaved({ portrait: record.portrait ?? mount.portrait, flip180: record.flip180 ?? mount.flip180 });
      else onSaveFailed();
    }).catch(() => {
      if (!request.signal.aborted) onSaveFailed();
    }).finally(() => {
      if (request.signal.aborted) return;
      pending.current = null;
      setSaving(false);
    });
  };

  const label = t('devices.lcd.rotation');
  return (
    <SettingsSection ariaLabel={label} boxClassName={styles.deviceSettingsBox}>
      <SettingRow label={label} disabled={!recordId || saving}>
        <ChipGroup
          ariaLabel={label}
          activeKey={String(activeRotation)}
          onChange={changeRotation}
          options={ROTATIONS.map(angle => ({
            key: String(angle),
            label: t('devices.lcd.rotationDegrees', { n: angle }),
            disabled: !recordId || saving,
          }))}
        />
      </SettingRow>
    </SettingsSection>
  );
}
