import { useLayoutEffect, useRef } from 'react';
import { createPictureTransitionRunner } from './pictureRunner';
import type { BackgroundTransitionSettings } from './settings';
import type { PictureSource } from './source';
import styles from './PictureTransition.module.scss';

export interface PictureTransitionProps {
  from: PictureSource;
  to: PictureSource;
  settings: BackgroundTransitionSettings;
  onComplete(): void;
  onFailed?(message: string): void;
}

/** Decorative frame layer; callers retain playback, decoder and opacity ownership. */
export function PictureTransition({ from, to, settings, onComplete, onFailed }: PictureTransitionProps) {
  const stage = useRef<HTMLDivElement>(null);
  const owner = useRef<ReturnType<typeof createPictureTransitionRunner> | null>(null);
  const callbacks = useRef({ onComplete, onFailed });
  useLayoutEffect(() => { callbacks.current = { onComplete, onFailed }; });
  useLayoutEffect(() => {
    if (!stage.current) return;
    const runner = owner.current ??= createPictureTransitionRunner(stage.current);
    let finished = false;
    const request = {
      from, to, settings: { effect: settings.effect, durationMs: settings.durationMs },
      onComplete: () => { finished = true; callbacks.current.onComplete(); },
      onFailed: (message: string) => { finished = true; callbacks.current.onFailed?.(message); },
    };
    const visible = () => {
      if (document.visibilityState === 'hidden') void runner.cancel();
      else if (!finished) void runner.replace(request);
    };
    if (document.visibilityState !== 'hidden') void runner.replace(request);
    document.addEventListener('visibilitychange', visible);
    return () => {
      document.removeEventListener('visibilitychange', visible);
      void runner.cancel();
    };
  }, [from, to, settings.effect, settings.durationMs]);
  return <div ref={stage} className={styles.stage} data-transition-effect={settings.effect} aria-hidden="true" />;
}
