import { useCallback, useState, type CSSProperties } from 'react';
import { ErrorBoundary } from '../../components/common/ErrorBoundary/ErrorBoundary';
import { PanelOpaqueProvider } from '../widgets/common/PanelOpaqueContext';
import type { AppManifest } from '../widgets/types';
import { d215PanelWidget } from './d215Panels';
import type { D215PanelInstance } from './d215PanelTypes';
import { D215PanelBackgroundLayer } from './D215PanelBackgroundLayer';
import styles from './D215PanelsLayer.module.scss';

const ROUND_SURFACE = 'lcd-round';

/** Opaque widgets pause only the background belonging to their own circle. */
export function D215PanelFace({ item, app, backgroundsEnabled, deviceId, themeMode, editing, contentStyle, renderPaused = false }: {
  item: D215PanelInstance;
  app: AppManifest;
  backgroundsEnabled: boolean;
  deviceId?: string;
  themeMode: 'dark' | 'light';
  editing: boolean;
  contentStyle: CSSProperties;
  renderPaused?: boolean;
}) {
  const [covered, setCovered] = useState(false);
  const report = useCallback((id: string, opaque: boolean) => { if (id === item.id) setCovered(opaque); }, [item.id]);
  const Widget = app.Widget;
  return <PanelOpaqueProvider value={report}>
    <div className={`panel-card ${styles.card}`} data-size="2x2round" data-widget-type={item.type} style={{ padding: 0 }}>
      {backgroundsEnabled && item.background && <D215PanelBackgroundLayer background={item.background}
        deviceId={deviceId} themeMode={themeMode} covered={covered} renderPaused={renderPaused} />}
      <div className={styles.content} style={contentStyle}>
        <ErrorBoundary label={item.type} resetKey={item.type}>
          <Widget widget={d215PanelWidget(item)} surface={ROUND_SURFACE} deviceTouch={false} deviceId={deviceId} editorPreview={editing} />
        </ErrorBoundary>
      </div>
    </div>
  </PanelOpaqueProvider>;
}
