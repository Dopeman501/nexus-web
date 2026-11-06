import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { PanelBackgroundShader } from './PanelBackgroundShader';
import { PanelBackgroundMedia } from './PanelBackgroundMedia';
import { PanelBackgroundSolid } from './PanelBackgroundSolid';
import { panelBackgroundFrostScale, resolvePanelBackground } from './panelBackground';
import { d215BackgroundTheme, type D215PanelBackground } from '../d215/d215PanelBackground';
import type { PanelSurface } from '../types';
import appStyles from '../PanelApp.module.scss';
import styles from './AudioTriggerBackgroundLayer.module.scss';

/** Only the selected snapshot mounts resources; normal selection stays persisted. */
export function AudioTriggerBackgroundLayer({ background, deviceId, themeMode, surface, fullRes }: {
  background: D215PanelBackground;
  deviceId?: string;
  themeMode: 'dark' | 'light';
  surface: PanelSurface;
  fullRes?: boolean;
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
  return <div className={styles.layer} data-audio-trigger-background
    style={{ '--panel-background-solid': resolvePanelBackground(theme.backgroundColor, theme.backgroundColorLight, themeMode) } as CSSProperties}>
    {shader ? <PanelBackgroundShader effect={theme.backgroundEffect} template={theme.backgroundTemplate}
      effectState={theme.backgroundEffectState} surface={surface} fullRes={fullRes} opacity={theme.backgroundOpacity} />
      : media ? <PanelBackgroundMedia deviceId={deviceId!} id={theme.backgroundMediaId!} type={theme.backgroundMediaType!}
        alpha={theme.backgroundMediaAlpha} opacity={theme.backgroundOpacity}
        onLoaded={() => { retry.current = 0; }} onFailed={() => setFailedId(theme.backgroundMediaId)} />
        : <PanelBackgroundSolid opacity={theme.backgroundOpacity} />}
    {(shader || media) && theme.backgroundFrost > 0 && <div className={appStyles.backgroundFrost} data-panel-frost
      style={{ '--panel-frost-scale': panelBackgroundFrostScale(theme.backgroundFrost) } as CSSProperties} aria-hidden />}
  </div>;
}
