import { useLayoutEffect, useRef } from 'react';
import { freezePictureSource, type PictureSource } from './transitions/source';

/** Decorative endpoint only; never takes ownership of the caller's frame/decoder. */
export function PictureFramePreview({ source, className }: { source: PictureSource; className?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    if (source instanceof HTMLImageElement || !canvas.current) return;
    const target = canvas.current;
    try {
      const snapshot = freezePictureSource(source);
      target.width = snapshot.width; target.height = snapshot.height;
      target.getContext('2d')?.drawImage(snapshot, 0, 0);
      snapshot.width = 0; snapshot.height = 0;
    } catch {
      // Capture fallback is handled by the transition owner; never retain a decoder.
      target.width = 0; target.height = 0;
    }
    return () => { target.width = 0; target.height = 0; };
  }, [source]);
  return source instanceof HTMLImageElement
    ? <img className={className} src={source.currentSrc || source.src} alt="" />
    : <canvas ref={canvas} className={className} aria-hidden />;
}
