import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { PanelBackgroundMedia } from '../background/PanelBackgroundMedia';
import { PanelBackgroundShader } from '../background/PanelBackgroundShader';
import { PanelBackgroundSlideshow } from '../background/PanelBackgroundSlideshow';
import { PanelBackgroundSolid } from '../background/PanelBackgroundSolid';
import { panelBackgroundFrostScale, resolvePanelBackground } from '../background/panelBackground';
import { d215BackgroundTheme, type D215PanelBackground as Background } from './d215PanelBackground';
import appStyles from '../PanelApp.module.scss';
import styles from './D215PanelsLayer.module.scss';

const ROUND_SURFACE = 'lcd-round';

export function D215PanelBackgroundLayer({ background, deviceId, themeMode, covered = false }: {
  background: Background;
  deviceId?: string;
  themeMode: 'dark' | 'light';
  covered?: boolean;
}) {
  const theme = d215BackgroundTheme(background);
  const [failedId, setFailedId] = useState<string | null>(null);
  const retry = useRef(0);
  useEffect(() => {
    if (failedId === null) return;
    const delay = [5_000, 15_000, 60_000][Math.min(retry.current++, 2)];
    const timer = window.setTimeout(() => setFailedId(null), delay);
    return () => window.clearTimeout(timer);
  }, [failedId]);
  const opacity = theme.backgroundOpacity;
  const mode = theme.backgroundMode;
  return <div className={styles.background} data-d215-panel-background
    style={{ '--panel-background-solid': resolvePanelBackground(theme.backgroundColor, theme.backgroundColorLight, themeMode) } as CSSProperties}>
    {mode === 'shader' ? <PanelBackgroundShader effect={theme.backgroundEffect} template={theme.backgroundTemplate}
      effectState={theme.backgroundEffectState} surface={ROUND_SURFACE} opacity={opacity} covered={covered} />
      : mode === 'media' && deviceId && theme.backgroundSlideshow
        ? <PanelBackgroundSlideshow deviceId={deviceId} startId={theme.backgroundMediaId} intervalSec={theme.backgroundSlideshowInterval}
          shuffle={theme.backgroundSlideshowShuffle} finishVideos={theme.backgroundSlideshowFinishVideos}
          order={theme.backgroundMediaOrder} opacity={opacity} covered={covered} />
        : mode === 'media' && deviceId && theme.backgroundMediaId && theme.backgroundMediaType && failedId !== theme.backgroundMediaId
          ? <PanelBackgroundMedia deviceId={deviceId} id={theme.backgroundMediaId} type={theme.backgroundMediaType}
            alpha={theme.backgroundMediaAlpha} opacity={opacity} covered={covered}
            onLoaded={() => { retry.current = 0; }} onFailed={() => setFailedId(theme.backgroundMediaId)} />
          : <PanelBackgroundSolid opacity={opacity} />}
    {mode !== 'solid' && theme.backgroundFrost > 0 && <div className={appStyles.backgroundFrost} data-panel-frost
      style={{ '--panel-frost-scale': panelBackgroundFrostScale(theme.backgroundFrost) } as CSSProperties} aria-hidden />}
  </div>;
}
