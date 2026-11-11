import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchPins, setLightingPaused, setPins } from '../../../api/lighting';

export function lightingPickAccepted(result: unknown): boolean {
  return !!result && !(typeof result === 'object' && 'error' in result && result.error);
}

/** No device rail: explicit picks release pins, as on the simple Lighting page.
 * One request runs at a time; only the newest waiting intent is retained. */
export function useLightingQuickPick(paused: boolean, reconcile: () => Promise<void>) {
  const [failed, setFailed] = useState(false);
  const latest = useRef({ paused, reconcile });
  latest.current = { paused, reconcile };
  const mounted = useRef(false);
  const running = useRef(false);
  const pending = useRef<((current: () => boolean) => Promise<boolean>) | null>(null);
  const epoch = useRef(0);
  const cancel = useCallback(() => { ++epoch.current; pending.current = null; setFailed(false); }, []);
  useEffect(() => {
    const version = epoch;
    mounted.current = true;
    return () => { mounted.current = false; ++version.current; pending.current = null; };
  }, []);

  const pick = useCallback((apply: (current: () => boolean) => Promise<boolean>) => {
    pending.current = apply;
    if (running.current) return;
    running.current = true;
    void (async () => {
      try {
        while (mounted.current && pending.current) {
          const next = pending.current;
          const mine = epoch.current;
          const current = () => mounted.current && mine === epoch.current;
          pending.current = null;
          setFailed(false);
          try {
            const pins = await fetchPins();
            if (!current()) continue;
            if (!pins) throw new Error('Lighting pins unavailable');
            if (latest.current.paused) {
              const resumed = await setLightingPaused(false);
              if (!current()) continue;
              if (!lightingPickAccepted(resumed)) throw new Error('Lighting resume refused');
            }
            const accepted = await next(current);
            if (!current()) continue;
            if (!accepted) throw new Error('Lighting pick refused');
            const ids = Object.keys(pins);
            if (ids.length && !await setPins(ids, null)) throw new Error('Lighting pins refused');
          } catch {
            if (!current()) continue;
            setFailed(true);
            // Refresh optimistic UI; never retry an uncertain settings write.
            await latest.current.reconcile().catch(() => {});
          }
        }
      } finally {
        running.current = false;
      }
    })();
  }, []);

  return { pick, failed, cancel };
}
