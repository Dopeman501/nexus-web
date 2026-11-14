import { type CSSProperties, useCallback, useEffect, useRef } from 'react';
import { backgroundMediaFileUrl } from '../../api/panelBackgroundMedia';
import styles from '../PanelApp.module.scss';
import type { PictureSource } from './transitions/source';

export const NULL_ERROR_GRACE_MS = 5_000;

export function PanelBackgroundMedia({
  id,
  deviceId,
  type,
  alpha,
  opacity,
  ready = true,
  loop = true,
  covered = false,
  playbackHeld = false,
  onLoaded,
  onImageReady,
  onMediaReady,
  onVideoRetiring,
  onFadedIn,
  onFailed,
  onVideoMetadata,
  onVideoEnded,
}: {
  id: string;
  deviceId: string;
  type: 'static' | 'animated';
  /** Transparent assets are png/gif, so an animated one still renders in an <img>. */
  alpha?: boolean;
  opacity: number;
  /** False keeps the layer at opacity 0 (its fade-in held back) until the
   * slideshow has the asset decoded; the single-background case is always ready. */
  ready?: boolean;
  /** A slideshow paces a video itself and turns the element's own loop off. */
  loop?: boolean;
  /** An opaque widget hides the whole background: hold the video on its current frame. */
  covered?: boolean;
  /** Hold an outgoing transition frame without changing coverage/load deadlines. */
  playbackHeld?: boolean;
  onLoaded?: () => void;
  /** A decoded opaque still, suitable for a picture transition without another decoder. */
  onImageReady?: (image: HTMLImageElement | null) => void;
  onMediaReady?: (source: PictureSource | null) => void;
  /** Synchronous capture opportunity before this owner releases the decoder. */
  onVideoRetiring?: (video: HTMLVideoElement) => void;
  /** The layer's opacity transition has finished after `ready` went true. */
  onFadedIn?: () => void;
  onFailed?: () => void;
  onVideoMetadata?: (video: HTMLVideoElement) => void;
  onVideoEnded?: (video: HTMLVideoElement) => void;
}) {
  const url = backgroundMediaFileUrl(deviceId, id);
  const style = { '--panel-background-opacity': opacity } as CSSProperties;
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const graceTimerRef = useRef(0);
  const onFailedRef = useRef(onFailed);
  const retiringRef = useRef(onVideoRetiring);
  useEffect(() => {
    onFailedRef.current = onFailed;
    retiringRef.current = onVideoRetiring;
  });
  useEffect(() => {
    if (!onImageReady) return;
    if (type !== 'static' || alpha) { onImageReady(null); return; }
    const image = imageRef.current;
    if (image?.naturalWidth && image.naturalHeight && image.complete) onImageReady(image);
  }, [url, type, alpha, onImageReady]);
  useEffect(() => {
    if (!onMediaReady) return;
    if (alpha) { onMediaReady(null); return; }
    const image = imageRef.current;
    const video = videoRef.current;
    if (type === 'static' && image?.complete && image.naturalWidth && image.naturalHeight) onMediaReady(image);
    else if (type === 'animated' && video && video.readyState >= 2 && video.videoWidth && video.videoHeight) onMediaReady(video);
  }, [url, type, alpha, onMediaReady]);

  useEffect(() => {
    if (covered || playbackHeld) videoRef.current?.pause();
    else videoRef.current?.play().catch(() => {});
  }, [url, covered, playbackHeld]);

  // A removed video otherwise holds its hardware decoder until GC, and a panel
  // with a single decoder cannot start the next clip. A ref callback pairs
  // with the element itself: it runs during the deletion, before a keyed
  // sibling's commit, and for an element that outlives one effect run. The
  // Assign src only in this ref's setup: React prepares new element props
  // before old ref cleanup, which could otherwise start a second decoder.
  // The URL-keyed node is immutable; setup also restores StrictMode cleanup.
  const attachVideo = useCallback((video: HTMLVideoElement | null) => {
    videoRef.current = video;
    if (!video) return;
    if (!video.hasAttribute('src')) video.setAttribute('src', url);
    return () => {
      window.clearTimeout(graceTimerRef.current);
      videoRef.current = null;
      try {
        retiringRef.current?.(video);
      } catch {
        console.warn('Background transition frame capture unavailable; releasing the video.');
      } finally {
        video.pause();
        video.removeAttribute('src');
        video.load();
      }
    };
  }, [url]);

  return (
    <div
      className={styles.backgroundMedia}
      data-ready={ready ? 'true' : undefined}
      data-panel-bg-layer
      style={style}
      aria-hidden="true"
      onTransitionEnd={onFadedIn && ready ? e => { if (e.target === e.currentTarget && e.propertyName === 'opacity') onFadedIn(); } : undefined}
    >
      {type === 'static' || alpha ? (
        <img
          key={url}
          ref={imageRef}
          src={url}
          alt=""
          className={styles.backgroundMediaContent}
          onLoad={event => {
            onImageReady?.(type === 'static' && !alpha ? event.currentTarget : null);
            onMediaReady?.(type === 'static' && !alpha ? event.currentTarget : null);
            onLoaded?.();
          }}
          onError={onFailed}
        />
      ) : (
        <video
          key={url}
          ref={attachVideo}
          className={`${styles.backgroundMediaContent} ${styles.backgroundMediaVideo}`}
          autoPlay={!covered && !playbackHeld}
          loop={loop}
          muted
          playsInline
          onCanPlay={event => {
            const video = event.currentTarget;
            onImageReady?.(null);
            if (video.readyState >= 2 && video.videoWidth && video.videoHeight) onMediaReady?.(video);
            onLoaded?.();
          }}
          onError={e => {
            const video = e.currentTarget;
            window.clearTimeout(graceTimerRef.current);
            if (video.error) {
              onFailed?.();
              return;
            }
            // Chrome 83 WebViews fire `error` with no MediaError on clips that
            // then play, so wait before giving up.
            graceTimerRef.current = window.setTimeout(() => {
              if (videoRef.current === video && (video.error || video.readyState < 2)) {
                onFailedRef.current?.();
              }
            }, NULL_ERROR_GRACE_MS);
          }}
          onLoadedMetadata={onVideoMetadata ? e => onVideoMetadata(e.currentTarget) : undefined}
          onEnded={onVideoEnded ? e => onVideoEnded(e.currentTarget) : undefined}
        />
      )}
    </div>
  );
}
