import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { PanelBackgroundShader } from './PanelBackgroundShader';
import { PanelBackgroundMedia } from './PanelBackgroundMedia';
import { PanelBackgroundSolid } from './PanelBackgroundSolid';
import { panelBackgroundFrostScale, resolvePanelBackground } from './panelBackground';
import { d215BackgroundTheme, type D215PanelBackground } from '../d215/d215PanelBackground';
import type { PanelSurface } from '../types';
import appStyles from '../PanelApp.module.scss';
import styles from './AudioTriggerBackgroundLayer.module.scss';
import type { PictureSource } from './transitions/source';

/** Only the selected snapshot mounts resources; normal selection stays persisted. */
export function AudioTriggerBackgroundLayer({ background, deviceId, themeMode, surface, fullRes, renderPaused = false, onImageReady, onMediaReady, onVideoRetiring, onFrameRetiring }: {
  background: D215PanelBackground;
  deviceId?: string;
  themeMode: 'dark' | 'light';
  surface: PanelSurface;
  fullRes?: boolean;
  renderPaused?: boolean;
  onImageReady?: (image: HTMLImageElement | null) => void;
  onMediaReady?: (source: PictureSource | null) => void;
  onVideoRetiring?: (video: HTMLVideoElement) => void;
  onFrameRetiring?: (canvas: HTMLCanvasElement) => void;
}) {
  const theme = d215BackgroundTheme(background);
  const [failedId, setFailedId] = useState<string | null>(null);
  const retry = useRef(0);
  useEffect(() => {
    if (failedId === null) return;
    const timer = window.setTimeout(() => setFailedId(null), [5000, 15000, 60000][Math.min(retry.current++, 2)]);
    return () => window.clearTimeout(timer);
  }, [failedId]);
  const media = theme.backgroundMode === 'media' && deviceId && theme.backgroundMediaId && theme.backgroundMediaType
    && failedId !== theme.backgroundMediaId;
  const shader = theme.backgroundMode === 'shader';
  const solidColor = resolvePanelBackground(theme.backgroundColor, theme.backgroundColorLight, themeMode);
  return <div className={styles.layer} data-audio-trigger-background
    style={{ '--panel-background-solid': solidColor } as CSSProperties}>
    {shader ? <PanelBackgroundShader effect={theme.backgroundEffect} template={theme.backgroundTemplate}
      effectState={theme.backgroundEffectState} surface={surface} fullRes={fullRes} opacity={theme.backgroundOpacity}
      renderPaused={renderPaused} onMediaReady={onMediaReady} onFrameRetiring={onFrameRetiring} />
      : media ? <PanelBackgroundMedia deviceId={deviceId!} id={theme.backgroundMediaId!} type={theme.backgroundMediaType!}
        alpha={theme.backgroundMediaAlpha} opacity={theme.backgroundOpacity}
        onImageReady={onImageReady}
        onMediaReady={onMediaReady} onVideoRetiring={onVideoRetiring}
        onLoaded={() => { retry.current = 0; }} onFailed={() => setFailedId(theme.backgroundMediaId)} />
        : <PanelBackgroundSolid opacity={theme.backgroundOpacity} color={solidColor}
          onMediaReady={onMediaReady} onFrameRetiring={onFrameRetiring} />}
    {(shader || media) && theme.backgroundFrost > 0 && <div className={appStyles.backgroundFrost} data-panel-frost
      style={{ '--panel-frost-scale': panelBackgroundFrostScale(theme.backgroundFrost) } as CSSProperties} aria-hidden />}
  </div>;
}
