import { useState } from 'react';
import { useEffectThumbnail } from '../../../../hooks/useEffectThumbnail';
import styles from '../LightingPage.module.scss';

interface EffectBackdropProps {
  effect: string;
  slot: number;
  version: string;
  frozen?: boolean;
  gpuAvailable?: boolean;
}

function PresetImage({ effect, slot, version, frozen = false, gpuAvailable }: EffectBackdropProps) {
  const url = useEffectThumbnail(effect, slot, version, gpuAvailable === false, frozen);
  const [failed, setFailed] = useState(false);
  return url && !failed
    ? <img className={styles.mediaBackdrop} src={url} alt="" draggable={false} onError={() => setFailed(true)} />
    : null;
}

/** The global output stream does not follow device pins. While local WebGL
 * cannot draw, show the focused preset instead of that unrelated stream. */
export function EffectBackdrop(props: EffectBackdropProps) {
  const { effect, slot, version, frozen = false } = props;
  return (
    <div className={styles.effectBackdrop} data-effect-preview={effect} aria-hidden="true">
      <PresetImage key={`${effect}:${slot}:${version}:${frozen}`} {...props} />
    </div>
  );
}
