import { useCallback, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { PictureTransition } from './transitions/PictureTransition';
import { normalizeBackgroundTransition, type AudioTriggerBeatTransitionSettings, type BackgroundTransitionSettings } from './transitions/settings';
import { isPictureTransitionEffect } from './transitions/catalogue';
import { panelBackgroundFrostScale } from './panelBackground';
import appStyles from '../PanelApp.module.scss';
import styles from './backgroundPictureTransition.module.scss';
import { freezePictureSource, getSourceKey, sourceDimensions, type PictureSource } from './transitions/source';
import { PictureFramePreview } from './PictureFramePreview';
import type { ChooseBackgroundTransition } from './transitions/useBackgroundTransitionCycle';

export interface PictureSelection {
  key: string;
  channel: 'normal' | 'audio';
  origin?: 'normal' | 'rhythm' | 'preview';
  eligible: boolean;
  opacity: number;
  /** Audio frost is inside its retired layer; normal frost remains a later sibling. */
  frost: number;
}
interface Frame { source: PictureSource; mediaKey: string; channel: PictureSelection['channel']; origin?: PictureSelection['origin']; frozen?: boolean }
interface ActiveTransition {
  id: number; key: string; from: PictureSource; fromKey: string; to: PictureSource | null;
  selection: PictureSelection; settings: BackgroundTransitionSettings;
  controls?: AudioTriggerBeatTransitionSettings;
}

/** One boundary survives normal/audio unmounts; outgoing videos are frozen before retirement. */
export function useBackgroundPictureTransition({ selection, settings, enabled, ownerKey, chooseTransition, beatSettings, effectsAvailable }: {
  selection: PictureSelection; settings?: BackgroundTransitionSettings; enabled: boolean; ownerKey: string; chooseTransition?: ChooseBackgroundTransition;
  beatSettings?: AudioTriggerBeatTransitionSettings; effectsAvailable?: boolean;
}) {
  const normalized = normalizeBackgroundTransition(settings);
  const { key, channel, origin, eligible, opacity, frost } = selection;
  const { effect, durationMs } = normalized;
  const custom = isPictureTransitionEffect(effect);
  const beatEnabled = beatSettings?.enabled ?? custom;
  const beatDuration = beatSettings?.durationMs ?? durationMs;
  const beatControls = useRef({ enabled: beatEnabled, durationMs: beatDuration });
  useLayoutEffect(() => { beatControls.current = { enabled: beatEnabled, durationMs: beatDuration }; }, [beatEnabled, beatDuration]);
  const beatAvailable = beatEnabled && (effectsAvailable ?? custom);
  const capture = custom || beatAvailable;
  const configuration = useRef({ settings: normalized, chooseTransition });
  useLayoutEffect(() => { configuration.current = { settings: { effect, durationMs }, chooseTransition }; }, [effect, durationMs, chooseTransition]);
  const latest = useRef({ key, ownerKey, enabled, eligible });
  const previous = useRef({ key, ownerKey });
  const frame = useRef<Frame | null>(null);
  const epoch = useRef(0);
  const deadline = useRef(0);
  const blocked = useRef({ effect: '', until: 0 });
  const [active, setActiveState] = useState<ActiveTransition | null>(null);
  const activeRef = useRef(active);
  const setActive = useCallback((next: ActiveTransition | null) => { activeRef.current = next; setActiveState(next); }, []);
  // A main-only preference change may preserve an in-flight beat and its original deadline.
  // Every replacement below clears its own timer; unmount still cancels a preserved hold.
  useLayoutEffect(() => () => window.clearTimeout(deadline.current), []);

  useLayoutEffect(() => {
    latest.current = { key, ownerKey, enabled, eligible };
    const changed = previous.current.key !== key;
    const ownerChanged = previous.current.ownerKey !== ownerKey;
    previous.current = { key, ownerKey };
    if (!changed && !ownerChanged && enabled && eligible && beatAvailable
      && activeRef.current?.controls?.enabled) return;
    const id = ++epoch.current;
    window.clearTimeout(deadline.current);
    setActive(null);
    if (ownerChanged || !enabled || !eligible || !capture) {
      frame.current = null;
      if (ownerChanged) blocked.current = { effect: '', until: 0 };
      return;
    }
    let outgoing = frame.current;
    if (!changed || !outgoing || (channel === 'normal' && outgoing.channel === 'normal')) return;
    const beat = origin === 'rhythm' && outgoing.origin === 'rhythm' && channel === 'audio' && outgoing.channel === 'audio';
    if (!(beat ? beatAvailable : custom)) return;
    if (!outgoing.frozen && (outgoing.source instanceof HTMLVideoElement || outgoing.source instanceof HTMLCanvasElement)) {
      try {
        outgoing = { ...outgoing, source: freezePictureSource(outgoing.source), frozen: true };
        frame.current = outgoing;
      } catch {
        frame.current = null;
        return;
      }
    }
    setActive({ id, key, from: outgoing.source, fromKey: outgoing.mediaKey, to: null,
      selection: { key, channel, origin, eligible, opacity, frost }, settings: configuration.current.settings,
      controls: beat ? { ...beatControls.current } : undefined });
    // A missing target must not pin an obsolete audio frame above the current source.
    deadline.current = window.setTimeout(() => {
      if (epoch.current !== id) return;
      frame.current = null;
      setActive(null);
    }, 3000);
  }, [key, channel, origin, eligible, ownerKey, enabled, custom, capture, beatAvailable, beatEnabled, opacity, frost, setActive]);

  const onMediaReady = useCallback((source: PictureSource | null) => {
    const current = latest.current;
    if (current.key !== key || current.ownerKey !== ownerKey) return;
    if (!source) { frame.current = null; window.clearTimeout(deadline.current); setActive(null); return; }
    if (!capture || !enabled || !eligible || !current.enabled || !current.eligible) return;
    try { sourceDimensions(source); } catch { return; }
    const mediaKey = getSourceKey(source);
    frame.current = { source, mediaKey, channel, origin };
    window.clearTimeout(deadline.current);
    const previous = activeRef.current;
    if (!previous || previous.id !== epoch.current || previous.key !== key || previous.to) return;
    if (previous.fromKey === mediaKey) { setActive(null); return; }
    const config = configuration.current;
    const chosen = normalizeBackgroundTransition(config.chooseTransition?.(`${ownerKey}/audio/${previous.id}`, previous.controls) ?? config.settings);
    if (!isPictureTransitionEffect(chosen.effect) || (blocked.current.effect === chosen.effect && Date.now() < blocked.current.until)) {
      setActive(null); return;
    }
    setActive({ ...previous, to: source, settings: chosen });
  }, [key, ownerKey, channel, origin, capture, enabled, eligible, setActive]);

  // A deleting child still has the previous selection callback. Match its actual
  // element, not the new selection key, while refusing a different owner/cache.
  const onSourceRetiring = useCallback((source: HTMLVideoElement | HTMLCanvasElement) => {
    const outgoing = frame.current;
    if (latest.current.ownerKey !== ownerKey || outgoing?.source !== source) return;
    try {
      frame.current = capture
        ? { ...outgoing, source: freezePictureSource(source), frozen: true } : null;
    } catch {
      frame.current = null;
      window.clearTimeout(deadline.current);
      setActive(null);
    }
  }, [ownerKey, capture, setActive]);

  const complete = (id: number) => { if (activeRef.current?.id === id) setActive(null); };
  const fail = (id: number, message: string) => {
    if (epoch.current !== id) return;
    blocked.current = { effect: activeRef.current?.settings.effect ?? effect, until: Date.now() + 30_000 };
    console.warn('Background picture transition unavailable; using the selected background.', message.slice(0, 400));
    complete(id);
  };
  const overlay = active ? <div className={styles.overlay} data-panel-bg-layer data-background-picture-hold aria-hidden>
    <div className={styles.paint} style={{ opacity: active.selection.opacity }}>
      <PictureFramePreview className={styles.image} source={active.from} />
      {active.to && <PictureTransition from={active.from} to={active.to} settings={active.settings}
        onComplete={() => complete(active.id)} onFailed={message => fail(active.id, message)} />}
    </div>
    {active.selection.channel === 'audio' && active.selection.frost > 0 && <div className={appStyles.backgroundFrost}
      data-panel-frost style={{ '--panel-frost-scale': panelBackgroundFrostScale(active.selection.frost) } as CSSProperties} />}
  </div> : null;
  return { onMediaReady, onVideoRetiring: onSourceRetiring, onFrameRetiring: onSourceRetiring,
    captureEnabled: enabled && eligible && capture, onImageReady: onMediaReady, overlay };
}
