import { useEffect, useRef, useState } from 'react';
import { PanelThemeSettings } from '../../../panel/editor/PanelThemeSettings';
import { panelBackgroundPair, panelBackgroundState } from '../../../panel/background/panelBackground';
import { d215BackgroundTheme, type D215PanelBackground } from '../../../panel/d215/d215PanelBackground';

const noop = () => {};
const BACKGROUND_SECTION = 'background';

/** The same background controls, backed only by this circle's layout entry. */
export function D215PanelBackgroundSettings({ background, onChange, themeMode, deviceId, diameter }: {
  background?: D215PanelBackground;
  onChange: (patch: Partial<D215PanelBackground>) => void;
  themeMode: 'dark' | 'light';
  deviceId?: string;
  diameter: number;
}) {
  const [draft, setDraft] = useState<Partial<D215PanelBackground>>({});
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const source = useRef(background);
  const current = useRef(background);
  const notify = useRef(onChange);
  notify.current = onChange;
  if (source.current !== background) { source.current = background; current.current = background; }
  const theme = d215BackgroundTheme({ ...background, ...draft });
  const commit = (patch: Partial<D215PanelBackground>) => {
    if (!alive.current) return;
    setDraft({});
    // A multi-file import selects its first asset and enables the slideshow
    // synchronously. Accumulate both patches before the parent can rerender.
    current.current = { ...current.current, ...patch };
    notify.current(current.current);
  };
  const colorPatch = (hex: string) => {
    const pair = panelBackgroundPair(hex);
    return { color: pair.dark, colorLight: pair.light };
  };
  return <PanelThemeSettings theme={theme} sections={BACKGROUND_SECTION} resolvedThemeMode={themeMode}
    independentBackground showEffectSearch showImmersiveBackdrop={false} showMediaTab={!!deviceId} deviceId={deviceId}
    deviceAspect={1} roundDisplay deviceW={diameter} deviceH={diameter} audioReactive={false}
    onBackgroundPreview={hex => setDraft(colorPatch(hex))} onBackgroundCommit={hex => commit(colorPatch(hex))}
    onBackgroundModeCommit={mode => commit({ mode })}
    onBackgroundEffectCommit={effect => commit({ effect, template: 0, effectState: panelBackgroundState(effect, 0) })}
    onBackgroundTemplateCommit={template => commit({ template, effectState: panelBackgroundState(theme.backgroundEffect, template) })}
    onBackgroundEffectStatePreview={effectState => setDraft({ effectState })}
    onBackgroundEffectStateCommit={effectState => commit({ effectState })}
    onBackgroundOpacityPreview={opacity => setDraft({ opacity })} onBackgroundOpacityCommit={opacity => commit({ opacity })}
    onBackgroundMediaCommit={(mediaId, mediaType, mediaAlpha) => commit({ mediaId, mediaType, mediaAlpha, ...(mediaId ? { mode: 'media' } : {}) })}
    onBackgroundSlideshowCommit={patch => commit({
      ...(patch.enabled !== undefined ? { slideshow: patch.enabled } : {}),
      ...(patch.interval !== undefined ? { interval: patch.interval } : {}),
      ...(patch.shuffle !== undefined ? { shuffle: patch.shuffle } : {}),
      ...(patch.finishVideos !== undefined ? { finishVideos: patch.finishVideos } : {}),
    })}
    onBackgroundMediaOrderCommit={mediaOrder => commit({ mediaOrder })}
    onBackgroundFrostPreview={frost => setDraft({ frost })} onBackgroundFrostCommit={frost => commit({ frost })}
    onThemeSyncCommit={noop} onThemeModeCommit={noop} onAccentSyncCommit={noop} onAccentPreview={noop} onAccentCommit={noop}
    onBackdropCommit={noop} onImmersiveBackdropCommit={noop} onWidgetOpacityPreview={noop} onWidgetOpacityCommit={noop}
    onWidgetLabelsCommit={noop} onWidgetPaddingPreview={noop} onWidgetPaddingCommit={noop}
    onTextColorModeCommit={noop} onTextColorPreview={noop} onTextColorCommit={noop} onFontCommit={noop} />;
}
