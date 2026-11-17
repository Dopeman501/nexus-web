import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchLightingColorAdjust, setLightingColorAdjust, NEUTRAL_COLOR_ADJUST, type LightingColorAdjust } from '../../../../api/lighting';

/** Owns read/write retirement for device calibration and its independent Red Shift toggle. */
export function useDeviceColorAdjust(profileKey: string, online: boolean) {
  const scope = `${profileKey}:${online}`;
  const currentScope = useRef({ scope });
  if (currentScope.current.scope !== scope) currentScope.current = { scope };
  const owner = currentScope.current;
  const generation = useRef(0);
  const alive = useRef(true);
  const pending = useRef(new Set<string>());
  const adjustmentsRef = useRef<Record<string, LightingColorAdjust>>({});
  const [adjustments, setAdjustments] = useState<Record<string, LightingColorAdjust>>({});
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState(false);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    generation.current++;
    adjustmentsRef.current = {};
    pending.current = new Set();
    setAdjustments({});
    setReady(false);
    setPendingIds(new Set());
    setError(false);
  }, [scope]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const refresh = useCallback(async () => {
    if (!online || pending.current.size > 0) return;
    const request = ++generation.current;
    try {
      const data = await fetchLightingColorAdjust();
      if (!alive.current || currentScope.current !== owner || request !== generation.current || !data?.adjustments) return;
      adjustmentsRef.current = data.adjustments;
      setAdjustments(data.adjustments);
      setReady(true);
    } catch { /* Keep the last acknowledged state until the next refresh. */ }
  }, [owner, online]);

  const toggleRedShift = useCallback(async (id: string) => {
    const stored = adjustmentsRef.current[id] ?? NEUTRAL_COLOR_ADJUST;
    if (!online || currentScope.current !== owner || pending.current.has(id) || !ready) return;
    const redShift = stored.redShift !== true;
    generation.current++;
    pending.current = new Set([...pending.current, id]);
    setPendingIds(pending.current);
    setError(false);
    try {
      const result = await setLightingColorAdjust([id], { redShift });
      if (!alive.current || currentScope.current !== owner) return;
      if (!result || result.error) { setError(true); return; }
      adjustmentsRef.current = { ...adjustmentsRef.current, [id]: { ...(adjustmentsRef.current[id] ?? NEUTRAL_COLOR_ADJUST), redShift } };
      setAdjustments(adjustmentsRef.current);
    } catch {
      if (alive.current && currentScope.current === owner) setError(true);
    } finally {
      if (alive.current && currentScope.current === owner) {
        pending.current = new Set([...pending.current].filter(value => value !== id));
        setPendingIds(pending.current);
      }
    }
  }, [owner, online, ready]);

  return { adjustments, pendingIds, error, ready: ready && online, refresh, toggleRedShift };
}
