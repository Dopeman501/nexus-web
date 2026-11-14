import { useEffect, useLayoutEffect, useRef, type CSSProperties } from 'react';
import styles from '../PanelApp.module.scss';
import type { PictureSource } from './transitions/source';

/** The panel's solid background color, which Media mode also shows while it has nothing to display. */
export function PanelBackgroundSolid({ opacity, color, onMediaReady, onFrameRetiring }: {
  opacity: number; color?: string; onMediaReady?: (source: PictureSource | null) => void;
  onFrameRetiring?: (canvas: HTMLCanvasElement) => void;
}) {
  const layer = useRef<HTMLDivElement>(null);
  const callbacks = useRef({ onMediaReady, onFrameRetiring });
  callbacks.current = { onMediaReady, onFrameRetiring };
  const capture = !!onMediaReady;
  const frame = useRef<HTMLCanvasElement | null>(null);
  useLayoutEffect(() => {
    if (!capture) return;
    const canvas = document.createElement('canvas'); canvas.width = 8; canvas.height = 8;
    try {
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Solid background frame canvas unavailable.');
      const resolved = color ?? (layer.current ? getComputedStyle(layer.current).backgroundColor : '#000000');
      context.fillStyle = resolved; context.fillRect(0, 0, 8, 8);
      frame.current = canvas;
    } catch { frame.current = null; }
    return () => {
      try { callbacks.current.onFrameRetiring?.(canvas); }
      finally { if (frame.current === canvas) frame.current = null; canvas.width = 0; canvas.height = 0; }
    };
  }, [color, capture, onMediaReady]);
  useEffect(() => { if (capture) onMediaReady?.(frame.current); }, [capture, color, onMediaReady]);
  return (
    <div
      ref={layer}
      className={styles.backgroundSolid}
      data-panel-bg-layer
      style={{ '--panel-background-opacity': opacity } as CSSProperties}
      aria-hidden
    />
  );
}
