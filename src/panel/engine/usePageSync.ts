import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { PanelLayout } from '../types';
import { BLANK_PAGE_ID } from './panelLayoutOps';
import { resolveHomePage } from './homePage';

// Owns the active page index and keeps it in sync with layout.activePageId so
// the device-page preview, the on-device panel, and sibling tabs track the same
// page. Also exposes refs the dnd handlers + collision detector read without
// re-subscribing.
export function usePageSync(params: {
  loaded: boolean;
  kioskBehavior: boolean;
  paginatedLayout: PanelLayout;
  layout: PanelLayout;
  setLayout: (next: PanelLayout) => void;
  pageCount: number;
  pageDragging: boolean;
  // Rendered index of the trailing blank page, -1 when none is rendered.
  blankPageIndex: number;
  // Ids of the pages actually rendered, when some stored pages are hidden (Restricted mode drops empty ones). Indexes then map against these.
  shownPageIds?: readonly string[];
}) {
  const { loaded, kioskBehavior, paginatedLayout, layout, setLayout, pageCount, pageDragging, blankPageIndex, shownPageIds } = params;
  const [activePageIndex, setActivePageIndex] = useState(0);
  useEffect(() => {
    if (activePageIndex > pageCount - 1) setActivePageIndex(pageCount - 1);
  }, [activePageIndex, pageCount]);
  // Read in dnd handlers (edge-advance) without restarting the pointermove
  // subscription on every page change.
  const pageCountRef = useRef(pageCount);
  useEffect(() => { pageCountRef.current = pageCount; }, [pageCount]);
  // Active page index mirrored to a ref so the once-built collision detector
  // reads it without rebuilding. The detector locks the snap target to this
  // page; the pager's edge-advance dwell handles cross-page navigation, so
  // the snap never picks a cell on another page from a drifting rect.
  const activePageIndexRef = useRef(activePageIndex);
  useEffect(() => { activePageIndexRef.current = activePageIndex; }, [activePageIndex]);

  const renderedPageIds = useMemo(() => {
    const ids = shownPageIds ? [...shownPageIds] : paginatedLayout.pages.map(page => page.id);
    if (blankPageIndex >= 0) ids.splice(blankPageIndex, 0, BLANK_PAGE_ID);
    return ids;
  }, [shownPageIds, paginatedLayout.pages, blankPageIndex]);
  const previousPageIdsRef = useRef(renderedPageIds);
  // Reordering changes an index without changing activePageId. Remap the page
  // actually shown locally, independently of incoming-selection protection.
  // The external-selection effect below still wins if both change together.
  useLayoutEffect(() => {
    if (pageDragging) return;
    const previous = previousPageIdsRef.current;
    previousPageIdsRef.current = renderedPageIds;
    if (!loaded || (previous.length === renderedPageIds.length && previous.every((id, i) => id === renderedPageIds[i]))) return;
    const id = previous[activePageIndex];
    const next = renderedPageIds.indexOf(id);
    if (next >= 0 && next !== activePageIndex) setActivePageIndex(next);
  }, [loaded, pageDragging, renderedPageIds, activePageIndex]);

  // --- Current-page sync via layout.activePageId ---------------------------
  // The active page rides in the layout so the device-page preview, the
  // on-device panel, and sibling tabs track the same page (propagated by the
  // panel/device refetch path, same as widget moves). Page changes never
  // survive a relaunch: a fresh Y70 starts at Home, other surfaces at page one.
  //
  // Honoring an external page (effect below) and persisting a local page
  // (handlePageChange) are kept strictly apart. An earlier version reacted to
  // activePageIndex with a *write* effect; because setActivePageIndex hadn't
  // applied yet in the same commit, that effect read the stale index and wrote
  // the previous page back, ping-ponging the two effects. The persist now
  // lives at the pager's onActiveChange, which fires only on a user swipe and
  // carries the new index explicitly, so no effect both reads the index and
  // writes the layout from it.
  const pageBootRef = useRef(false);
  // Track the incoming selection separately from local intent. A new callback
  // or geometry render must not reinterpret the pre-save source as a remote
  // navigation while the Home/startup write is still awaiting its echo.
  const lastSourcePageIdRef = useRef<string | undefined>(undefined);
  useLayoutEffect(() => {
    if (!loaded || pageDragging) return;
    const pages = paginatedLayout.pages;
    if (pages.length === 0) return;
    // A stored blank page resolves to the last rendered page: the blank page
    // itself, or the last page where none renders.
    const indexOf = (id: string) => (id === BLANK_PAGE_ID
      ? (blankPageIndex >= 0 ? blankPageIndex : pages.length - 1)
      : shownPageIds ? shownPageIds.indexOf(id) : pages.findIndex(p => p.id === id));
    if (!pageBootRef.current) {
      pageBootRef.current = true;
      lastSourcePageIdRef.current = layout.activePageId;
      if (kioskBehavior && (pages.length > 1 || layout.activePageId === BLANK_PAGE_ID)) {
        // Resolve only reachable real pages. Restricted mode may hide Home;
        // that must not turn a stored index into a different page identity.
        const homeId = resolveHomePage(paginatedLayout)?.id;
        const homeIndex = homeId ? indexOf(homeId) : -1;
        const startupId = homeIndex >= 0 ? homeId : shownPageIds?.[0] ?? pages[0].id;
        const startupIndex = Math.max(0, startupId ? indexOf(startupId) : 0);
        setActivePageIndex(startupIndex);
        if (layout.activePageId !== startupId) setLayout({ ...layout, activePageId: startupId });
      } else {
        // Viewer (device-page preview / simulator) or single-page kiosk: adopt
        // whatever page the record already points at.
        const idx = layout.activePageId ? indexOf(layout.activePageId) : 0;
        if (idx > 0) setActivePageIndex(idx);
      }
      return;
    }
    // Post-boot: honor a page change pushed from another client only. Skipped
    // during a drag so edge-advance owns the page.
    const target = layout.activePageId;
    if (!target || target === lastSourcePageIdRef.current) return;
    const idx = indexOf(target);
    if (idx < 0) return; // wait until a newly received page is rendered
    lastSourcePageIdRef.current = target;
    setActivePageIndex(idx);
  }, [loaded, kioskBehavior, paginatedLayout, layout, pageDragging, setLayout, blankPageIndex, shownPageIds]);

  // Persist a user-driven page change (swipe) into the layout so other clients
  // follow. Carries the new index from the pager so it never reads a stale
  // render value. Only the receiving effect updates the observed source ID.
  const handlePageChange = useCallback((idx: number) => {
    setActivePageIndex(idx);
    const pages = shownPageIds ? shownPageIds.map(id => ({ id })) : paginatedLayout.pages;
    if (pages.length <= 1 && blankPageIndex < 0) return;
    const id = idx === blankPageIndex ? BLANK_PAGE_ID : pages[Math.min(Math.max(idx, 0), pages.length - 1)]?.id;
    if (!id) return;
    if (layout.activePageId !== id) setLayout({ ...layout, activePageId: id });
  }, [paginatedLayout, layout, setLayout, blankPageIndex, shownPageIds]);

  return { activePageIndex, setActivePageIndex, activePageIndexRef, pageCountRef, handlePageChange };
}
