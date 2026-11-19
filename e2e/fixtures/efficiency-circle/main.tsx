import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { UiSettingsProvider } from '../../../src/hooks/useUiSettings';
import { D215PanelsLayer } from '../../../src/panel/d215/D215PanelsLayer';
import { PanelScreenSleep } from '../../../src/panel/chrome/PanelScreenSleep';
import { I18nProvider, useTranslation } from '../../../src/lib/i18n';

const panels = { enabled: true, backgroundsEnabled: true, items: [{ id: 'circle-one', type: 'clock',
  x: 0.5, y: 0.5, diameter: 0.6, config: {}, background: { mode: 'shader' as const, effect: 'plasma' } }] };
const fixtureDeviceId = 'transition-fixture';

// D215 glass has no touch input or Screen sleep command. Exercise the same
// production circle owners with the real fade component in this isolated UI.
function Fixture() {
  const { t } = useTranslation();
  const [asleep, setAsleep] = useState(false);
  const [hidden, setHidden] = useState(false);
  return <UiSettingsProvider serviceOnline={false} manageDom={false}>
    <div className="panel-root" data-screen-sleep={hidden || undefined}
      style={{ position: 'relative', width: '100vw', height: '100vh' }}>
      <D215PanelsLayer panels={panels} renderPaused={hidden} deviceId={fixtureDeviceId} />
      <button style={{ position: 'absolute', zIndex: 100 }} onClick={() => setAsleep(true)}>{t('panel.controlCenter.screenSleep')}</button>
    </div>
    <PanelScreenSleep asleep={asleep} onSleepFaded={() => setHidden(true)}
      onWakeStart={() => setHidden(false)} onWake={() => setAsleep(false)} />
  </UiSettingsProvider>;
}

createRoot(document.getElementById('root')!).render(<I18nProvider initialLanguage="en"><Fixture /></I18nProvider>);
