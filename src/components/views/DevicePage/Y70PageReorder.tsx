import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useTranslation } from '../../../lib/i18n';
import type { PanelLayout } from '../../../panel/types';
import { stackNeighbours, type StackNeighbour } from './pageReorderModel';
import { usePageReorderGesture } from './usePageReorderGesture';
import { useReorderFrame, type ReorderFrame } from './useReorderFrame';
import styles from './Y70PageReorder.module.scss';

interface Y70PageReorderProps {
  enabled: boolean;
  ownerKey: string;
  layout: PanelLayout;
  pageId: string;
  children: ReactNode;
  onCommit(pageId: string, to: number, originalOrder: readonly string[]): Promise<boolean>;
  onBusyChange?(busy: boolean): void;
}

function useReducedMotion() {
  const [reduced, setReduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return reduced;
}

function GlassCard({ card, frame, spread, active, reduced }: {
  card: StackNeighbour; frame: ReorderFrame; spread: number; active: boolean; reduced: boolean;
}) {
  const [entered, setEntered] = useState(false);
  useLayoutEffect(() => {
    if (!active || reduced) return;
    const frameId = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(frameId);
  }, [active, reduced]);
  const visible = active && (entered || reduced);
  const style: CSSProperties = {
    left: frame.left, top: frame.top, width: frame.width, height: frame.height,
    zIndex: 4 - card.distance, opacity: visible ? 1 : 0,
    transform: `translate(${visible ? card.offset * frame.width * spread : 0}px, 0) scale(${visible ? card.scale : 0.95})`,
  };
  return <div className={styles.glass} style={style} data-reorder-glass={card.id} data-depth={card.distance} aria-hidden="true" />;
}

/** One live preview and inert neighbours: no extra widget/media instances. */
function ReorderPreview({ enabled, ownerKey, layout, pageId, children, onCommit, onBusyChange }: Y70PageReorderProps) {
  const { t } = useTranslation();
  const rootRef = useRef<HTMLDivElement>(null);
  const busyRef = useRef(false);
  const cancelRef = useRef<() => void>(() => {});
  const statusId = useId();
  const instructionsId = `${statusId}-instructions`;
  const reduced = useReducedMotion();
  const { frame, bounds, origin, measure } = useReorderFrame(rootRef, busyRef, cancelRef, ownerKey);
  const ids = useMemo(() => layout.pages.map(page => page.id), [layout.pages]);
  const selected = layout.pages.find(page => page.id === pageId);
  const available = enabled && ids.length > 1 && selected !== undefined && frame.width > 0 && frame.height > 0;
  const [outcome, setOutcome] = useState<'saved' | 'failed' | null>(null);
  const commitEpoch = useRef(0);
  useLayoutEffect(() => {
    commitEpoch.current += 1;
    setOutcome(null);
    return () => { commitEpoch.current += 1; };
  }, [ownerKey]);
  const commit = useCallback(async (id: string, to: number, order: readonly string[]) => {
    const epoch = commitEpoch.current;
    let saved = false;
    try {
      saved = await onCommit(id, to, order);
    } catch { /* The failed outcome is reported below, and the original order is retained. */ }
    if (epoch === commitEpoch.current) setOutcome(saved ? 'saved' : 'failed');
    return saved;
  }, [onCommit]);
  const gesture = usePageReorderGesture({ enabled: available, ownerKey, pageId, pageIds: ids,
    frameWidth: frame.width, bounds, reducedMotion: reduced, onCommit: commit, onBusyChange });
  const busy = gesture.phase !== 'idle';
  const tracking = gesture.phase === 'grabbed';
  const stackVisible = tracking || gesture.phase === 'saving';
  useLayoutEffect(() => {
    busyRef.current = busy;
    cancelRef.current = gesture.cancel;
    if (!busy) measure();
  }, [busy, gesture.cancel, measure]);
  useEffect(() => { if (tracking) setOutcome(null); }, [tracking]);

  const originalIndex = ids.indexOf(pageId);
  const destination = busy ? gesture.destination : originalIndex;
  const cards = stackNeighbours(ids, pageId, destination);
  const centerX = origin.left + frame.left + frame.width / 2;
  const room = Math.max(0, Math.min(centerX - bounds.left, bounds.right - centerX) - 12);
  const spread = Math.min(1, Math.max(0.12, (room - frame.width * 0.26) / Math.max(1, frame.width * 1.42)));
  const label = selected?.label || t('devices.panels.reorder.page', { n: originalIndex + 1 });
  const x = tracking ? gesture.dx : 0;
  const y = tracking ? gesture.dy : 0;
  const direction = Math.sign(destination - originalIndex);
  const cueOffset = Math.max(-room + 8, Math.min(room - 8,
    (destination - originalIndex) * frame.width * 0.55 + direction * frame.width * 0.38));
  const caption = tracking ? t('devices.panels.reorder.moving', { page: label, position: gesture.destination + 1, total: ids.length })
    : gesture.phase === 'saving' ? t('devices.panels.reorder.saving')
      : outcome === 'saved' ? t('devices.panels.reorder.saved')
        : outcome === 'failed' ? t('devices.panels.reorder.failed') : t('devices.panels.reorder.unchanged');

  return (
    <div ref={rootRef} className={styles.stage} data-page-reorder-phase={gesture.phase} data-reduced-motion={reduced || undefined}>
      {busy && <div className={styles.backdrop} data-leaving={!stackVisible || undefined} style={{
        left: bounds.left, top: bounds.top, width: bounds.right - bounds.left, height: bounds.bottom - bounds.top,
      }} aria-hidden="true" />}
      {available && cards.map(card => <GlassCard key={card.id} card={card} frame={frame} spread={spread} active={stackVisible} reduced={reduced} />)}
      {busy && gesture.destination !== originalIndex && <div className={styles.insertion} data-reorder-insertion={gesture.destination}
        style={{ left: frame.left + frame.width / 2 + cueOffset,
          top: frame.top + frame.height * 0.08, height: frame.height * 0.84 }} aria-hidden="true" />}
      <div className={styles.live} data-reorder-live data-lifted={busy || undefined} style={{
        transform: busy ? `translate(${x}px, ${y}px)` : undefined,
        transition: tracking || reduced ? 'none' : undefined,
        pointerEvents: busy ? 'none' : undefined,
      }}>{children}</div>
      {available && (['left', 'right'] as const).map(corner => (
        <button key={corner} type="button" className={styles.handle} data-reorder-corner={corner}
          style={{ left: frame.left + (corner === 'left' ? -6 : frame.width - 30) + x, top: frame.top - 6 + y,
            transition: tracking || reduced ? 'none' : undefined }}
          aria-label={t('devices.panels.reorder.handle', { page: label, position: originalIndex + 1, total: ids.length,
            corner: t(`devices.panels.reorder.${corner}`) })}
          aria-describedby={`${instructionsId} ${statusId}`} aria-pressed={gesture.corner === corner && tracking}
          aria-disabled={gesture.phase === 'saving' || gesture.phase === 'settling' || undefined}
          onPointerDown={event => {
            if (gesture.phase === 'idle' && event.isPrimary && event.button === 0) event.currentTarget.focus({ preventScroll: true });
            gesture.onPointerDown(event, corner);
          }} onPointerMove={gesture.onPointerMove}
          onPointerUp={gesture.onPointerUp} onPointerCancel={gesture.onPointerCancel} onLostPointerCapture={gesture.onLostPointerCapture}
          onKeyDown={event => gesture.onKeyDown(event, corner)}>
          <span aria-hidden="true" />
        </button>
      ))}
      <div id={statusId} className={styles.status} role="status" aria-live="polite" aria-atomic="true">{busy || outcome ? caption : ''}</div>
      <div id={instructionsId} className={styles.status}>{t('devices.panels.reorder.instructions')}</div>
    </div>
  );
}

export function Y70PageReorder(props: Y70PageReorderProps) {
  if (!props.enabled && props.layout.surface !== 'y70') return props.children;
  return <ReorderPreview {...props} />;
}
