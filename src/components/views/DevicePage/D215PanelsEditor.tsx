import { ArrowLeft, Trash2 } from 'lucide-react';
import { useMemo, type CSSProperties } from 'react';
import { useTranslation } from '../../../lib/i18n';
import { createUuid } from '../../../lib/uuid';
import { addD215Panel, d215PanelWidget, readD215Panels, removeD215Panel, setD215PanelsEnabled, setD215PanelBackgroundsEnabled, updateD215PanelBackground, updateD215PanelConfig } from '../../../panel/d215/d215Panels';
import type { D215PanelCanvas } from '../../../panel/d215/d215PanelGeometry';
import { MAX_D215_PANELS } from '../../../panel/d215/d215PanelTypes';
import { PanelWidgetCatalog } from '../../../panel/editor/PanelWidgetCatalog';
import type { PanelLayout } from '../../../panel/types';
import { appAvailableForSurface, lookupApp } from '../../../panel/widgets/registry';
import { readD215Widget } from '../../../panel/d215/d215Widget';
import { PanelDeviceIdProvider } from '../../../panel/widgets/common/PanelDeviceIdContext';
import { Button } from '../../common/Button/Button';
import { Card } from '../../common/Card/Card';
import { ErrorBoundary } from '../../common/ErrorBoundary/ErrorBoundary';
import { SettingToggle } from '../../common/SettingRow/SettingRow';
import styles from './D215PanelsEditor.module.scss';
import { D215PanelBackgroundSettings } from './D215PanelBackgroundSettings';

const COPY = 'devices.jungle-leopard-d215.panels';
const ROUND_SURFACE = 'lcd-round';

export function D215PanelsEditor({ layout, canvas, selectedId, onSelect, onChange, themeStyle, themeMode = 'dark', backgroundThemeMode = themeMode, deviceId }: {
  layout: PanelLayout;
  canvas: D215PanelCanvas;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onChange: (layout: PanelLayout) => void;
  themeStyle?: CSSProperties;
  themeMode?: 'dark' | 'light';
  backgroundThemeMode?: 'dark' | 'light';
  deviceId?: string;
}) {
  const { t } = useTranslation();
  const state = useMemo(() => readD215Panels(layout.d215Panels), [layout.d215Panels]);
  const selected = state.items.find(item => item.id === selectedId);
  const widgetEnabled = readD215Widget(layout.d215Widget, state.enabled).enabled;
  const reservedTypes = [...layout.pages.flatMap(page => page.widgets.map(widget => widget.type)),
    ...(widgetEnabled && layout.widgetPlaylist?.enabled ? layout.widgetPlaylist.types : [])];
  const blockedTypeHints = Object.fromEntries(reservedTypes.flatMap(type => {
    const app = lookupApp(type);
    return app?.meta.singleInstance ? [[app.meta.type,
      t(`${COPY}.singleInstanceInWidgets`, { name: t(app.meta.i18nKey) })]] : [];
  }));
  const selectedApp = selected ? lookupApp(selected.type) : undefined;
  const Settings = selectedApp && appAvailableForSurface(selectedApp.meta, ROUND_SURFACE) ? selectedApp.Settings : undefined;
  const labelFor = (type: string) => {
    const app = lookupApp(type);
    return app ? t(app.meta.i18nKey) : type;
  };

  return (
    <div className={styles.editor} style={themeStyle}>
      <Card compact>
        <SettingToggle label={t(`${COPY}.enabled`)} description={t(`${COPY}.enabledHint`)} checked={state.enabled}
          onChange={enabled => onChange(setD215PanelsEnabled(layout, enabled))} />
        <SettingToggle label={t(`${COPY}.backgrounds`)} description={t(`${COPY}.backgroundsHint`)} checked={state.backgroundsEnabled !== false}
          onChange={enabled => onChange(setD215PanelBackgroundsEnabled(layout, enabled))} />
        <p className={styles.hint}>{t(`${COPY}.hint`)}</p>
        <span className={styles.count} role="status">{t(`${COPY}.count`, { count: state.items.length, max: MAX_D215_PANELS })}</span>
        {state.items.length > 0 && (
          <div className={styles.instances} role="group" aria-label={t(`${COPY}.title`)}>
            {state.items.map((item, index) => (
              <Button key={item.id} size="sm" tone={item.id === selectedId ? 'accent' : 'neutral'}
                aria-pressed={item.id === selectedId} onClick={() => onSelect(item.id)}>
                {labelFor(item.type)} {index + 1}
              </Button>
            ))}
          </div>
        )}
      </Card>
      {selected ? (
        <div className={styles.settings}>
          <div className={styles.header}>
            <Button size="sm" onClick={() => onSelect(null)} aria-label={t('devices.panels.widgetSettings.back')}>
              <ArrowLeft size={16} aria-hidden />
            </Button>
            <span className={styles.title}>{labelFor(selected.type)}</span>
            <Button size="sm" onClick={() => { onChange(removeD215Panel(layout, selected.id)); onSelect(null); }}
              aria-label={t('devices.panels.widgetSettings.remove')}>
              <Trash2 size={16} aria-hidden />
            </Button>
          </div>
          <PanelDeviceIdProvider value={deviceId ?? null}>
            <ErrorBoundary key={selected.id} label={selected.type}>
              {Settings ? (
                <Settings widget={d215PanelWidget(selected)} surface={ROUND_SURFACE} desktopEditor
                  onUpdate={patch => onChange(updateD215PanelConfig(layout, selected.id, patch))} onResize={() => {}} />
              ) : <p className={styles.hint}>{t(selectedApp ? 'devices.panels.widgetSettings.noConfigurableSettings' : `${COPY}.unavailable`)}</p>}
            </ErrorBoundary>
          </PanelDeviceIdProvider>
          {state.backgroundsEnabled !== false && <D215PanelBackgroundSettings key={selected.id}
            background={selected.background} onChange={patch => onChange(updateD215PanelBackground(layout, selected.id, patch))}
            themeMode={backgroundThemeMode} deviceId={deviceId} diameter={Math.round(selected.diameter * Math.min(canvas.width, canvas.height))} />}
        </div>
      ) : (
        <>
          <PanelWidgetCatalog surface={ROUND_SURFACE} variant="desktop-modal" themeMode={themeMode} themeStyle={themeStyle}
            onAdd={type => {
              const id = createUuid();
              const next = addD215Panel(layout, type, id, canvas);
              if (next !== layout) { onChange(next); return id; }
            }}
            onEditWidget={onSelect} canAddSize={() => state.items.length < MAX_D215_PANELS}
            fullHint={t(`${COPY}.full`)}
            blockedTypeHints={blockedTypeHints}
            placedTypes={[...state.items.map(item => item.type), ...layout.pages.flatMap(page => page.widgets.map(widget => widget.type))]} />
        </>
      )}
    </div>
  );
}
