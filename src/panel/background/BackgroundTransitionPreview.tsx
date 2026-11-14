import { useEffect, useState } from 'react';
import type { TransitionPreviewFrame } from '../../api/panelTransitionPreview';
import { PictureTransition } from './transitions/PictureTransition';
import styles from './BackgroundTransitionPreview.module.scss';

/** Explicit audition only: never changes a saved background or acquires a video decoder. */
export function BackgroundTransitionPreview({ frame, onComplete }: { frame: TransitionPreviewFrame; onComplete(id: string): void }) {
  const [sources, setSources] = useState<[HTMLImageElement, HTMLImageElement] | null>(null);
  const preview = frame.preview!;
  useEffect(() => {
    let live = true;
    const from = new Image(); from.src = '/background-transitions/demo-from.svg';
    const to = new Image(); to.src = '/background-transitions/demo-to.svg';
    const timer = window.setTimeout(() => { if (live) onComplete(preview.previewId); }, 3500);
    void Promise.all([from.decode(), to.decode()]).then(() => {
      if (live) { window.clearTimeout(timer); setSources([from, to]); }
    }).catch(() => { if (live) onComplete(preview.previewId); });
    return () => { live = false; window.clearTimeout(timer); };
  }, [preview.previewId, onComplete]);
  const finish = () => onComplete(preview.previewId);
  return <div className={styles.preview} aria-hidden data-background-transition-preview data-transition-preview
    data-preview-id={preview.previewId} data-effect={preview.effect}>
    <img className={styles.endpoint} src="/background-transitions/demo-from.svg" alt="" />
    {sources && <PictureTransition from={sources[0]} to={sources[1]} settings={preview} onComplete={finish}
      onFailed={message => { console.warn('Transition preview unavailable.', message.slice(0, 300)); finish(); }} />}
  </div>;
}
