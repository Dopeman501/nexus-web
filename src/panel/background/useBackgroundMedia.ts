import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchBackgroundMediaLibrary, backgroundMediaThumbnailPath, onBackgroundMediaChanged, type BackgroundMediaItem } from '../../api/panelBackgroundMedia';
import { fetchServiceBlob } from '../../api/service';

interface ThumbnailOwner { active: boolean; urls: Set<string> }

function revokeThumbnail(owner: ThumbnailOwner, url: string) {
  if (owner.urls.delete(url)) URL.revokeObjectURL(url);
}

export function useBackgroundMedia(deviceId: string) {
  const [items, setItems] = useState<BackgroundMediaItem[]>([]);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const thumbsRef = useRef<Record<string, string>>({});
  const ownerRef = useRef<ThumbnailOwner | null>(null);

  const refresh = useCallback(async () => {
    const lib = await fetchBackgroundMediaLibrary(deviceId);
    if (lib?.items) setItems(lib.items);
  }, [deviceId]);

  useEffect(() => { refresh(); }, [refresh]);

  // A commit or delete from any entry point (canvas quick edit, another picker, the panel's own editor) changes this library too.
  useEffect(() => onBackgroundMediaChanged(deviceId, () => { void refresh(); }), [deviceId, refresh]);

  useEffect(() => {
    thumbsRef.current = thumbs;
  }, [thumbs]);

  useEffect(() => {
    const owner: ThumbnailOwner = { active: true, urls: new Set() };
    ownerRef.current = owner;
    return () => {
      owner.active = false;
      // Ownership starts at URL creation, even if React never commits the
      // queued thumbnail updater. A replay gets its own independent owner.
      for (const url of owner.urls) revokeThumbnail(owner, url);
      if (ownerRef.current === owner) {
        ownerRef.current = null;
        thumbsRef.current = {};
      }
    };
  }, []);

  // Prune thumbnails whose item disappeared.
  useEffect(() => {
    const owner = ownerRef.current;
    if (!owner) return;
    const itemIds = new Set(items.map(item => item.id));
    setThumbs(prev => {
      if (!owner.active || ownerRef.current !== owner) return prev;
      let changed = false;
      const next = { ...prev };
      for (const [id, url] of Object.entries(prev)) {
        if (!itemIds.has(id)) {
          revokeThumbnail(owner, url);
          delete next[id];
          changed = true;
        }
      }
      if (changed) thumbsRef.current = next;
      return changed ? next : prev;
    });
  }, [items]);

  // Lazily fetch thumbnails.
  useEffect(() => {
    const owner = ownerRef.current;
    if (!owner) return;
    let cancelled = false;
    (async () => {
      for (const item of items) {
        if (thumbsRef.current[item.id]) continue;
        const blob = await fetchServiceBlob(backgroundMediaThumbnailPath(deviceId, item.id), { mayBeCached: true });
        if (cancelled || !owner.active || ownerRef.current !== owner) return;
        if (blob) {
          const url = URL.createObjectURL(blob);
          owner.urls.add(url);
          setThumbs(prev => {
            if (!owner.active || ownerRef.current !== owner) {
              revokeThumbnail(owner, url);
              return prev;
            }
            if (prev[item.id]) {
              revokeThumbnail(owner, url);
              return prev;
            }
            const next = { ...prev, [item.id]: url };
            thumbsRef.current = next;
            return next;
          });
        }
      }
    })();
    return () => { cancelled = true; };
  }, [items, deviceId]);

  const removeLocal = useCallback((id: string) => {
    const owner = ownerRef.current;
    if (!owner?.active) return;
    setItems(prev => prev.filter(item => item.id !== id));
    setThumbs(prev => {
      if (!owner.active || ownerRef.current !== owner) return prev;
      const url = prev[id];
      if (url) revokeThumbnail(owner, url);
      const next = { ...prev };
      delete next[id];
      thumbsRef.current = next;
      return next;
    });
  }, []);

  return { items, thumbs, refresh, removeLocal };
}
