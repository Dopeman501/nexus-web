import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { putKeyReaction, type KeyReaction } from '../../../api/keyReactive';

export interface TypeReactiveScope {
  /** Profile/device generation, including same-id profile reloads. */
  key: string;
  /** Server token captured atomically with the initial config. */
  epoch?: string;
  /** Card geometry captured with the config and preview. */
  layoutRevision?: string;
  /** The host retires the old owner before unmounting it on a scope change. */
  isCurrent?: () => boolean;
}

export interface TypeReactiveConfig {
  config: KeyReaction;
  update: (patch: Partial<KeyReaction>) => void;
  flushSave: () => Promise<void>;
  current: () => KeyReaction;
  isCurrent: () => boolean;
  epoch?: string;
  layoutRevision?: string;
}

interface Owner {
  cardId: string;
  scopeKey?: string;
  epoch?: string;
  layoutRevision?: string;
  externalCurrent?: () => boolean;
  config: KeyReaction;
  edit: number;
  dirty: boolean;
  retired: boolean;
  mounted: boolean;
  timer: ReturnType<typeof setTimeout> | null;
  saving: Promise<void> | null;
  writes: Set<AbortController>;
}

const clearTimer = (owner: Owner) => {
  if (owner.timer !== null) clearTimeout(owner.timer);
  owner.timer = null;
};
const retire = (owner: Owner) => {
  owner.retired = true;
  owner.dirty = false;
  clearTimer(owner);
  owner.writes.forEach(write => write.abort());
};

/** One profile/device owns its debounced latest intent and at most one PUT.
 * Normal close flushes; scope retirement drops old work and aborts requests.
 * Server epoch/projection checks protect a PUT already transmitted before retirement. */
export function useTypeReactiveConfig(cardId: string, initialConfig: KeyReaction, scope?: TypeReactiveScope): TypeReactiveConfig {
  const ownerRef = useRef<Owner | null>(null);
  if (!ownerRef.current || ownerRef.current.cardId !== cardId || ownerRef.current.scopeKey !== scope?.key
    || ownerRef.current.epoch !== scope?.epoch || ownerRef.current.layoutRevision !== scope?.layoutRevision) {
    ownerRef.current = { cardId, scopeKey: scope?.key, epoch: scope?.epoch, layoutRevision: scope?.layoutRevision, externalCurrent: scope?.isCurrent,
      config: initialConfig, edit: 0, dirty: false, retired: false, mounted: true, timer: null, saving: null, writes: new Set() };
  }
  const owner = ownerRef.current;
  owner.externalCurrent = scope?.isCurrent;
  const [view, setView] = useState({ owner, config: initialConfig });
  const isCurrent = useCallback(() => !owner.retired && ownerRef.current === owner && owner.externalCurrent?.() !== false, [owner]);

  const flushSave = useCallback(function flush(): Promise<void> {
    clearTimer(owner);
    if (!isCurrent()) return Promise.resolve();
    if (owner.saving) return owner.saving.then(flush);
    if (!owner.dirty) return Promise.resolve();
    owner.dirty = false;
    const edit = owner.edit;
    const abort = new AbortController();
    owner.writes.add(abort);
    const pending = owner.layoutRevision !== undefined
      ? putKeyReaction(cardId, owner.config, owner.epoch, abort.signal, owner.layoutRevision)
      : owner.scopeKey === undefined && owner.epoch === undefined
      ? putKeyReaction(cardId, owner.config)
      : putKeyReaction(cardId, owner.config, owner.epoch, abort.signal);
    const keepPending = () => { if (isCurrent() && edit === owner.edit) owner.dirty = true; };
    const saving = pending.then(saved => {
      if (!saved) { keepPending(); return; }
      if (!isCurrent() || edit !== owner.edit) return;
      owner.config = saved;
      if (owner.mounted) setView({ owner, config: saved });
    }).catch(keepPending).finally(() => {
      owner.writes.delete(abort);
      if (owner.saving === saving) owner.saving = null;
    });
    owner.saving = saving;
    return saving;
  }, [cardId, owner, isCurrent]);

  const update = useCallback((patch: Partial<KeyReaction>) => {
    if (!isCurrent()) return;
    owner.config = { ...owner.config, ...patch };
    owner.edit++;
    owner.dirty = true;
    setView({ owner, config: owner.config });
    clearTimer(owner);
    owner.timer = setTimeout(() => { void flushSave(); }, 250);
  }, [owner, isCurrent, flushSave]);

  useLayoutEffect(() => {
    owner.mounted = true;
    return () => {
      owner.mounted = false;
      if (isCurrent()) void flushSave();
      else retire(owner);
    };
  }, [owner, isCurrent, flushSave]);

  const current = useCallback(() => owner.config, [owner]);
  return { config: view.owner === owner ? view.config : owner.config, update, flushSave, current, isCurrent,
    epoch: owner.epoch, layoutRevision: owner.layoutRevision };
}
