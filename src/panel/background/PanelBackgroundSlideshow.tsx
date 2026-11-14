import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useTopicCallback } from '../../hooks/useMultiplexSocket';
import { fetchBackgroundMediaLibrary, type BackgroundMediaItem } from '../../api/panelBackgroundMedia';
import { PanelBackgroundMedia } from './PanelBackgroundMedia';
import { PanelBackgroundSolid } from './PanelBackgroundSolid';
import { PictureFramePreview } from './PictureFramePreview';
import { orderBackgroundMedia, slideshowLap } from './slideshowOrder';
import { PictureTransition } from './transitions/PictureTransition';
import { isPictureTransitionEffect } from './transitions/catalogue';
import { normalizeBackgroundTransition, type BackgroundTransitionSettings } from './transitions/settings';
import { freezePictureSource, getSourceKey, sourceDimensions, type PictureSource } from './transitions/source';
import type { ChooseBackgroundTransition } from './transitions/useBackgroundTransitionCycle';
import styles from '../PanelApp.module.scss';
import transitionStyles from './backgroundPictureTransition.module.scss';

// Ceiling on the incoming layer's transitionend, which never fires when the
// fade is a no-op (background opacity at 0) or the kiosk tab is hidden.
const FADE_CEILING_MS = 1000;
// An incoming slide that neither loads nor errors is skipped so the cycle cannot strand on it.
const LOAD_CEILING_MS = 30_000;
// Grace on top of a paced video's expected run before the slideshow moves on regardless.
const VIDEO_STALL_GRACE_MS = 15_000;

const isVideoItem = (item: BackgroundMediaItem | null) => !!item && item.type === 'animated' && !item.alpha;
type DecodedSlide = { id: string; source: PictureSource };
type SlidePicturePair = { targetId: string; from: PictureSource; to: PictureSource; replacement: boolean; settings: BackgroundTransitionSettings };
type CutFrame = { targetId: string; source: HTMLCanvasElement };

function outgoingPicture(source: PictureSource): PictureSource {
  return source instanceof HTMLVideoElement ? freezePictureSource(source) : source;
}

function replay(video: HTMLVideoElement) {
  video.currentTime = 0;
  video.play()?.catch(() => {});
}

/**
 * Cycles this panel's background-media library. `startId` (the record's
 * selected asset) leads the cycle. Slides crossfade: the next asset mounts
 * above the current one at opacity 0, fades in once decoded, and only then is
 * the previous one dropped. A video slide plays whole (repeating to cover the
 * interval, as the gallery widget does) or is cut at the interval like a still.
 */
export function PanelBackgroundSlideshow(props: Parameters<typeof SlideshowInstance>[0]) {
  return <SlideshowInstance key={props.deviceId} {...props} />;
}

function SlideshowInstance({
  deviceId,
  startId,
  intervalSec,
  shuffle,
  finishVideos,
  order,
  opacity,
  covered = false,
  transition,
  chooseTransition,
  onImageReady,
  onMediaReady,
  onVideoRetiring,
}: {
  deviceId: string;
  startId: string | null;
  intervalSec: number;
  shuffle: boolean;
  finishVideos: boolean;
  /** Asset ids in play order for an in-order slideshow (see orderBackgroundMedia). */
  order: readonly string[];
  opacity: number;
  /** An opaque widget hides the whole background: hold the current slide and pause its video. */
  covered?: boolean;
  transition?: BackgroundTransitionSettings;
  chooseTransition?: ChooseBackgroundTransition;
  onImageReady?: (image: HTMLImageElement | null) => void;
  onMediaReady?: (source: PictureSource | null) => void;
  onVideoRetiring?: (video: HTMLVideoElement) => void;
}) {
  const selectedTransition = normalizeBackgroundTransition(transition);
  const selectionRef = useRef(selectedTransition);
  selectionRef.current = selectedTransition;
  const chooser = useRef(chooseTransition); chooser.current = chooseTransition;
  const transitionOwner = useId();
  const transitionIntent = useRef(0);
  const coveredRef = useRef(covered);
  coveredRef.current = covered;
  const currentSourceRef = useRef<DecodedSlide | null>(null);
  const incomingSourceRef = useRef<DecodedSlide | null>(null);
  const playedMsRef = useRef(0);
  const firstPlayMsRef = useRef<number | null>(null);
  const resetVideoPacing = useCallback((source?: PictureSource) => {
    playedMsRef.current = 0;
    firstPlayMsRef.current = source instanceof HTMLVideoElement
      && Number.isFinite(source.duration) && source.duration > 0
      && Number.isFinite(source.currentTime) && source.currentTime > 0
      ? Math.max(0, source.duration - source.currentTime) * 1000 : null;
  }, []);
  const callbacks = useRef({ onMediaReady, onImageReady, onVideoRetiring });
  callbacks.current = { onMediaReady, onImageReady, onVideoRetiring };
  const publishSource = useCallback((source: PictureSource | null) => {
    callbacks.current.onMediaReady?.(source);
    callbacks.current.onImageReady?.(source instanceof HTMLImageElement ? source : null);
  }, []);
  const [picturePair, setPicturePairState] = useState<SlidePicturePair | null>(null);
  const picturePairRef = useRef(picturePair);
  const setPicturePair = useCallback((pair: SlidePicturePair | null) => {
    picturePairRef.current = pair;
    setPicturePairState(pair);
  }, []);
  const choosePair = useCallback((targetId: string, from: PictureSource, to: PictureSource, replacement: boolean): SlidePicturePair => ({
    targetId, from, to, replacement,
    settings: normalizeBackgroundTransition(chooser.current?.(`slideshow/${transitionOwner}/${transitionIntent.current}`) ?? selectionRef.current),
  }), [transitionOwner]);
  // A video-to-video handoff retains pixels, never a second decoder. The hold
  // remains visible while the replacement decodes and until its effect ends.
  const [cutFrame, setCutFrameState] = useState<CutFrame | null>(null);
  const cutFrameRef = useRef(cutFrame);
  const setCutFrame = useCallback((frame: CutFrame | null) => {
    cutFrameRef.current = frame;
    setCutFrameState(frame);
  }, []);
  useEffect(() => {
    if (currentSourceRef.current && !cutFrameRef.current) publishSource(currentSourceRef.current.source);
  }, [onMediaReady, onImageReady, publishSource]);
  const intervalMs = intervalSec * 1000;
  const [items, setItems] = useState<BackgroundMediaItem[]>([]);
  const itemsRef = useRef(items);
  const itemIdsRef = useRef('');
  const shuffleRef = useRef(shuffle);
  const orderRef = useRef(order);
  // The refs mirror the slide states synchronously: advance() can run from a
  // timer before a pending commit's effects flush.
  const [current, setCurrentState] = useState<BackgroundMediaItem | null>(null);
  const currentRef = useRef(current);
  const setCurrent = useCallback((item: BackgroundMediaItem | null) => {
    if (currentRef.current?.id !== item?.id) resetVideoPacing();
    if (currentSourceRef.current?.id !== item?.id) currentSourceRef.current = null;
    if (!item) publishSource(null);
    currentRef.current = item;
    setCurrentState(item);
  }, [publishSource, resetVideoPacing]);
  const [incoming, setIncomingState] = useState<BackgroundMediaItem | null>(null);
  const incomingRef = useRef(incoming);
  const setIncoming = useCallback((item: BackgroundMediaItem | null) => {
    incomingRef.current = item;
    setIncomingState(item);
  }, []);
  const currentId = current?.id;
  const incomingId = incoming?.id;
  const currentFrameReady = useCallback((source: PictureSource | null) => {
    if (!currentId || currentRef.current?.id !== currentId) return;
    if (source) { try { sourceDimensions(source); } catch { return; } }
    currentSourceRef.current = source ? { id: currentId, source } : null;
    const hold = cutFrameRef.current;
    if (hold?.targetId === currentId && source && !coveredRef.current
      && isPictureTransitionEffect(selectionRef.current.effect)) {
      if (picturePairRef.current?.targetId === currentId && picturePairRef.current.to === source) return;
      setPicturePair(choosePair(currentId, hold.source, source, true));
    } else if (!hold) {
      publishSource(source);
    }
  }, [currentId, publishSource, setPicturePair, choosePair]);
  const incomingFrameReady = useCallback((source: PictureSource | null) => {
    if (!incomingId || incomingRef.current?.id !== incomingId) return;
    if (source) { try { sourceDimensions(source); } catch { return; } }
    incomingSourceRef.current = source ? { id: incomingId, source } : null;
    const outgoing = currentSourceRef.current;
    if (!source || !outgoing || outgoing.id !== currentRef.current?.id || coveredRef.current
      || !isPictureTransitionEffect(selectionRef.current.effect)) return;
    if (picturePairRef.current?.targetId === incomingId && picturePairRef.current.to === source) return;
    if (getSourceKey(outgoing.source) === getSourceKey(source)) return;
    try {
      setPicturePair(choosePair(incomingId, outgoingPicture(outgoing.source), source, false));
    } catch {
      // Snapshot failure retains the legacy fade; it is not a decode failure.
      setPicturePair(null);
    }
  }, [incomingId, setPicturePair, choosePair]);
  const videoRetiring = useCallback((video: HTMLVideoElement) => {
    // Retirement may run after currentRef already names the next keyed video.
    // Forward the retiring element itself before its src/decoder is released.
    callbacks.current.onVideoRetiring?.(video);
    if (currentSourceRef.current?.source === video) currentSourceRef.current = null;
    if (incomingSourceRef.current?.source === video) incomingSourceRef.current = null;
  }, []);
  const [incomingReady, setIncomingReady] = useState(false);
  // The video a cut swapped in, until it reaches canplay. A clip that stalls
  // there is failed like a stalled incoming layer, and the cadence waits on it.
  const [cutInId, setCutInState] = useState<string | null>(null);
  const [cutInReady, setCutInReady] = useState(false);
  const cutInRef = useRef(cutInId);
  const setCutIn = useCallback((id: string | null) => {
    cutInRef.current = id;
    setCutInState(id);
    setCutInReady(false);
  }, []);
  // The ended video an advance left on its last frame instead of replaying.
  const endedRef = useRef<{ video: HTMLVideoElement; id: string } | null>(null);
  // Assets the panel could not decode; cleared when the library changes.
  const failedRef = useRef<Set<string>>(new Set());
  const lapRef = useRef<BackgroundMediaItem[]>([]);
  const posRef = useRef(0);
  // The next advance rebuilds the lap from the slide on screen.
  const lapDirtyRef = useRef(true);
  // Clip lengths by asset id, from loadedmetadata on either layer.
  const durationsRef = useRef<Map<string, number>>(new Map());

  const refresh = useCallback(async () => {
    const lib = await fetchBackgroundMediaLibrary(deviceId);
    if (lib?.items) setItems(lib.items);
  }, [deviceId]);
  useEffect(() => { refresh(); }, [refresh]);
  // Every record write broadcasts; an import selects the new asset, so it is one.
  useTopicCallback('panel/device', true, (raw) => {
    const frame = raw as { deviceId?: string } | null;
    if (frame?.deviceId === deviceId) refresh();
  });

  const liveItems = useCallback(
    () => orderBackgroundMedia(itemsRef.current.filter(item => !failedRef.current.has(item.id)), orderRef.current),
    [],
  );

  const stage = useCallback((item: BackgroundMediaItem) => {
    if (!currentRef.current) {
      setCurrent(item);
      return;
    }
    if (item.id === currentRef.current.id || item.id === incomingRef.current?.id) return;
    transitionIntent.current++;
    const previousHold = cutFrameRef.current;
    setPicturePair(null);
    setCutFrame(null);
    incomingSourceRef.current = null;
    // Retire the old video before starting another decoder. A selected effect
    // captures the outgoing frame synchronously, before React unmounts it.
    if (isVideoItem(currentRef.current) && isVideoItem(item)) {
      const decoded = currentSourceRef.current;
      if (!coveredRef.current && isPictureTransitionEffect(selectionRef.current.effect)) {
        let snapshot = previousHold?.source;
        if (decoded?.id === currentRef.current.id) {
          try {
            snapshot = freezePictureSource(decoded.source);
          } catch {
            // Retain an existing hold, or use the established decoder cut.
          }
        }
        if (snapshot) setCutFrame({ targetId: item.id, source: snapshot });
      }
      setIncoming(null);
      setIncomingReady(false);
      setCutIn(item.id);
      setCurrent(item);
      return;
    }
    setCutIn(null);
    setIncoming(item);
    setIncomingReady(false);
  }, [setCurrent, setIncoming, setCutIn, setPicturePair, setCutFrame]);

  const advance = useCallback(() => {
    // A slide already on its way in keeps the cadence; the timer re-arms when it lands.
    if (incomingRef.current || (cutInRef.current && cutInRef.current === currentRef.current?.id)) return;
    const live = liveItems();
    const cur = currentRef.current;
    if (live.length === 0) {
      setPicturePair(null);
      setCutFrame(null);
      setCurrent(null);
      return;
    }
    let lap = lapRef.current;
    let pos = posRef.current + 1;
    if (lapDirtyRef.current) {
      lap = slideshowLap(live, shuffleRef.current, cur?.id ?? null);
      pos = cur && lap[0]?.id === cur.id ? 1 : 0;
      lapDirtyRef.current = false;
    }
    if (pos >= lap.length) {
      lap = slideshowLap(live, shuffleRef.current, null, cur?.id ?? null);
      pos = 0;
    }
    // A lap of two or more never holds the slide on screen at its head.
    if (cur && lap[pos]?.id === cur.id && lap.length > 1) pos = (pos + 1) % lap.length;
    lapRef.current = lap;
    posRef.current = pos;
    const next = lap[pos];
    if (next) stage(next);
  }, [liveItems, stage, setCurrent, setPicturePair, setCutFrame]);

  // Library changes: prune stale failures, start the cycle on first arrival,
  // or move on when the slide on screen is gone.
  useEffect(() => {
    itemsRef.current = items;
    const ids = new Set(items.map(item => item.id));
    const idKey = [...ids].sort().join('\n');
    if (idKey === itemIdsRef.current) return;
    itemIdsRef.current = idKey;
    for (const id of failedRef.current) if (!ids.has(id)) failedRef.current.delete(id);
    lapDirtyRef.current = true;
    const cur = currentRef.current;
    if (!cur) {
      const lap = slideshowLap(liveItems(), shuffleRef.current, startId);
      lapRef.current = lap;
      posRef.current = 0;
      lapDirtyRef.current = false;
      if (lap[0]) setCurrent(lap[0]);
      return;
    }
    if (!ids.has(cur.id)) {
      setIncoming(null);
      setCutIn(null);
      advance();
    }
  // startId has its own effect below; only a library change (re)starts here.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, liveItems, advance, setCurrent, setIncoming, setCutIn]);

  useEffect(() => {
    shuffleRef.current = shuffle;
    lapDirtyRef.current = true;
  }, [shuffle]);
  // Keyed on content: the theme rebuilds the array on every record refresh.
  const orderKey = order.join('\n');
  useEffect(() => {
    orderRef.current = order;
    lapDirtyRef.current = true;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderKey]);

  // A pick in the editor jumps the cycle to that slide.
  useEffect(() => {
    if (!startId || startId === currentRef.current?.id) return;
    const live = liveItems();
    const picked = live.find(item => item.id === startId);
    if (!picked) return;
    lapRef.current = slideshowLap(live, shuffleRef.current, startId);
    posRef.current = 0;
    lapDirtyRef.current = false;
    if (incomingRef.current?.id !== startId) setIncoming(null);
    stage(picked);
  }, [startId, liveItems, stage, setIncoming]);

  const [presentation, setPresentation] = useState(0);
  const promote = useCallback((expectedId?: string) => {
    const item = incomingRef.current;
    if (!item || (expectedId && item.id !== expectedId)) return;
    const decoded = incomingSourceRef.current;
    if (decoded?.id === item.id) {
      currentSourceRef.current = decoded;
      publishSource(decoded.source);
    } else { currentSourceRef.current = null; publishSource(null); }
    incomingSourceRef.current = null;
    endedRef.current = null;
    setPicturePair(null);
    setCutFrame(null);
    setCurrent(item);
    resetVideoPacing(decoded?.id === item.id ? decoded.source : undefined);
    setIncoming(null);
    setIncomingReady(false);
  }, [setCurrent, setIncoming, publishSource, setPicturePair, setCutFrame, resetVideoPacing]);
  const finishCut = useCallback(() => {
    const decoded = currentSourceRef.current;
    if (decoded && decoded.id === currentRef.current?.id) publishSource(decoded.source);
    resetVideoPacing(decoded?.source);
    endedRef.current = null;
    setPicturePair(null);
    setCutFrame(null);
    setCutIn(null);
    setPresentation(value => value + 1);
  }, [publishSource, setPicturePair, setCutFrame, setCutIn, resetVideoPacing]);
  const finishPicture = useCallback(() => {
    if (!picturePair || picturePairRef.current !== picturePair) return;
    if (picturePair.replacement) {
      if (currentRef.current?.id === picturePair.targetId) finishCut();
    } else promote(picturePair.targetId);
  }, [picturePair, finishCut, promote]);
  const customTransition = !covered && !!picturePair && isPictureTransitionEffect(selectedTransition.effect) && isPictureTransitionEffect(picturePair.settings.effect)
    && (picturePair.replacement ? cutInReady && cutInId === current?.id
      : incomingReady && picturePair.targetId === incoming?.id);
  const activeDuration = picturePair?.settings.durationMs ?? selectedTransition.durationMs;
  useEffect(() => {
    if (!incoming || !incomingReady) return;
    if (selectedTransition.effect === 'none') { promote(); return; }
    const timer = setTimeout(() => promote(incoming.id), customTransition ? activeDuration + 6000 : FADE_CEILING_MS);
    return () => clearTimeout(timer);
  }, [incoming, incomingReady, promote, customTransition, selectedTransition.effect, activeDuration]);
  useEffect(() => {
    if (!customTransition || !picturePair?.replacement) return;
    const timer = setTimeout(finishPicture, activeDuration + 6000);
    return () => clearTimeout(timer);
  }, [customTransition, picturePair, finishPicture, activeDuration]);
  useEffect(() => {
    if (!covered && isPictureTransitionEffect(selectedTransition.effect)) return;
    if (cutFrameRef.current && cutInReady) finishCut();
    else {
      setPicturePair(null);
      setCutFrame(null);
    }
  }, [covered, selectedTransition.effect, cutInReady, finishCut, setPicturePair, setCutFrame]);

  const failIncoming = useCallback(() => {
    const item = incomingRef.current;
    if (!item) return;
    failedRef.current.add(item.id);
    incomingSourceRef.current = null;
    setPicturePair(null);
    setIncoming(null);
    setIncomingReady(false);
    lapDirtyRef.current = true;
    advance();
    // The failed layer was the only way out of an ended video: with nothing
    // else staged, a held last frame would never move again.
    const ended = endedRef.current;
    if (ended && !covered && !incomingRef.current && currentRef.current?.id === ended.id) {
      endedRef.current = null;
      replay(ended.video);
    }
  }, [advance, setIncoming, covered, setPicturePair]);
  // A covered video is paused and may never reach canplay, so it is not timed out.
  useEffect(() => {
    if (covered || !incoming || incomingReady) return;
    const timer = setTimeout(failIncoming, LOAD_CEILING_MS);
    return () => clearTimeout(timer);
  }, [covered, incoming, incomingReady, failIncoming]);

  const failCurrent = useCallback(() => {
    const item = currentRef.current;
    if (!item) return;
    failedRef.current.add(item.id);
    // Drop it from the lap in place so the cycle continues after it, not from the head.
    const at = lapDirtyRef.current ? -1 : lapRef.current.findIndex(lapItem => lapItem.id === item.id);
    if (at >= 0) {
      lapRef.current = lapRef.current.filter(lapItem => lapItem.id !== item.id);
      posRef.current = at - 1;
    } else {
      lapDirtyRef.current = true;
    }
    setCutIn(null);
    setPicturePair(null);
    advance();
  }, [advance, setCutIn, setPicturePair]);
  useEffect(() => {
    if (covered || !cutInId || cutInReady || cutInId !== current?.id) return;
    const timer = setTimeout(failCurrent, LOAD_CEILING_MS);
    return () => clearTimeout(timer);
  }, [covered, cutInId, cutInReady, current, failCurrent]);

  const liveCount = items.filter(item => !failedRef.current.has(item.id)).length;
  const isVideo = isVideoItem(current);
  // A paced video's own ended handler moves the slideshow on; the tick stays
  // off so a still that follows gets its full interval.
  const videoPaced = isVideo && finishVideos && liveCount > 1;

  useEffect(() => {
    if (covered || !current || incoming || cutInId || videoPaced || liveCount < 2) return;
    const timer = setTimeout(advance, intervalMs);
    return () => clearTimeout(timer);
  }, [covered, current, incoming, cutInId, videoPaced, liveCount, intervalMs, advance, presentation]);

  // A live incoming video may already be part-way through a play at promotion.
  // Count its visible tail first, then full plays, without restarting the clip.
  useEffect(() => {
    endedRef.current = null;
  }, [current]);
  const ceilingRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const armCeiling = useCallback((durationMs: number) => {
    if (ceilingRef.current) clearTimeout(ceilingRef.current);
    ceilingRef.current = setTimeout(advance, Math.max(durationMs * 2, intervalMs) + VIDEO_STALL_GRACE_MS);
  }, [advance, intervalMs]);
  useEffect(() => {
    if (covered || !videoPaced || !current || incoming || cutInId) return;
    armCeiling(durationsRef.current.get(current.id) ?? 0);
    return () => {
      if (ceilingRef.current) clearTimeout(ceilingRef.current);
    };
  }, [covered, videoPaced, current, incoming, cutInId, armCeiling, presentation]);

  const onVideoMetadata = useCallback((id: string, video: HTMLVideoElement) => {
    const durationMs = Number.isFinite(video.duration) && video.duration > 0 ? video.duration * 1000 : 0;
    durationsRef.current.set(id, durationMs);
    if (videoPaced && !covered && !incomingRef.current && !cutInRef.current
      && currentRef.current?.id === id) armCeiling(durationMs);
  }, [videoPaced, covered, armCeiling]);

  const onVideoEnded = useCallback((video: HTMLVideoElement) => {
    if (covered) return;
    if (cutFrameRef.current) { replay(video); return; }
    if (picturePairRef.current && incomingRef.current) return;
    // An unknown or zero duration cannot be paced; treat it as done.
    const durationMs = Number.isFinite(video.duration) && video.duration > 0 ? video.duration * 1000 : Infinity;
    playedMsRef.current += firstPlayMsRef.current ?? durationMs;
    firstPlayMsRef.current = null;
    if (videoPaced && playedMsRef.current >= intervalMs) {
      const before = currentRef.current;
      advance();
      // Moving on: a cut already swapped the slide, a crossfade holds the last frame.
      if (currentRef.current !== before || incomingRef.current) {
        if (before && currentRef.current === before) endedRef.current = { video, id: before.id };
        return;
      }
    }
    replay(video);
    if (videoPaced) armCeiling(durationMs === Infinity ? 0 : durationMs);
  }, [covered, videoPaced, intervalMs, advance, armCeiling]);

  if (!current) return <PanelBackgroundSolid opacity={opacity} />;
  // The stack carries the background opacity so two overlapping layers never
  // composite denser than one.
  return (
    <div className={styles.backgroundMediaStack} style={{ opacity }} aria-hidden="true">
      <PanelBackgroundMedia
        key={current.id}
        id={current.id}
        deviceId={deviceId}
        type={current.type}
        alpha={current.alpha}
        opacity={1}
        loop={!videoPaced}
        covered={covered}
        playbackHeld={customTransition && !picturePair?.replacement && isVideo}
        onLoaded={() => {
          if (cutInRef.current !== current.id || currentRef.current?.id !== current.id) return;
          if (cutFrameRef.current?.targetId === current.id && picturePairRef.current) setCutInReady(true);
          else { setCutFrame(null); setCutIn(null); }
        }}
        onMediaReady={currentFrameReady}
        onVideoRetiring={videoRetiring}
        onFailed={() => { if (currentRef.current?.id === current.id) failCurrent(); }}
        onVideoMetadata={video => onVideoMetadata(current.id, video)}
        onVideoEnded={video => { if (currentRef.current?.id === current.id) onVideoEnded(video); }}
      />
      {incoming && (
        <PanelBackgroundMedia
          key={incoming.id}
          id={incoming.id}
          deviceId={deviceId}
          type={incoming.type}
          alpha={incoming.alpha}
          opacity={1}
          ready={incomingReady}
          covered={covered}
          onLoaded={() => { if (incomingRef.current?.id === incoming.id) setIncomingReady(true); }}
          onFadedIn={customTransition || selectedTransition.effect === 'none' ? undefined : () => promote(incoming.id)}
          onMediaReady={incomingFrameReady}
          onVideoRetiring={videoRetiring}
          onFailed={() => { if (incomingRef.current?.id === incoming.id) failIncoming(); }}
          onVideoMetadata={video => onVideoMetadata(incoming.id, video)}
          onVideoEnded={video => { if (!covered && incomingRef.current?.id === incoming.id) replay(video); }}
        />
      )}
      {cutFrame && !customTransition && <div className={transitionStyles.slideshowPaint} data-slideshow-picture-hold>
        <PictureFramePreview source={cutFrame.source} className={transitionStyles.image} />
      </div>}
      {customTransition && <div className={transitionStyles.slideshowPaint} data-slideshow-picture-transition>
        <PictureFramePreview source={picturePair!.from} className={transitionStyles.image} />
        <PictureTransition from={picturePair!.from}
          to={picturePair!.to} settings={picturePair!.settings} onComplete={finishPicture} onFailed={finishPicture} />
      </div>}
    </div>
  );
}
