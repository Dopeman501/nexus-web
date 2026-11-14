import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { PanelLayout } from '../types';
import { usePageSync } from './usePageSync';
import { BLANK_PAGE_ID } from './panelLayoutOps';

const seed = (): PanelLayout => ({
  surface: 'y70', layoutSchemaVersion: 2, homePageId: 'b', activePageId: 'c',
  pages: ['a', 'b', 'c'].map(id => ({ id, widgets: [] })),
});
function mount(options: { kiosk?: boolean; shown?: string[]; stored?: PanelLayout; loaded?: boolean } = {}) {
  const setLayout = vi.fn();
  const stored = options.stored ?? seed();
  const hook = renderHook(({ layout, loaded }) => usePageSync({
    loaded, kioskBehavior: options.kiosk ?? true, layout, paginatedLayout: layout, setLayout,
    pageCount: options.shown?.length ?? layout.pages.length + 1, pageDragging: false,
    blankPageIndex: options.shown ? -1 : layout.pages.length, shownPageIds: options.shown,
  }), { initialProps: { layout: stored, loaded: options.loaded ?? true } });
  return { ...hook, setLayout, stored };
}

describe('Y70 Home startup and navigation', () => {
  it('never treats a changed save callback as a new remote page before the Home echo arrives', () => {
    const stored = seed();
    const save = vi.fn();
    const { result } = renderHook(() => usePageSync({
      loaded: true, kioskBehavior: true, layout: stored, paginatedLayout: stored,
      setLayout: next => save(next), pageCount: 4, pageDragging: false, blankPageIndex: 3,
    }));
    expect(result.current.activePageIndex).toBe(1);
    expect(save).toHaveBeenCalledTimes(1);
  });
  it('starts the kiosk on Home and synchronizes that identity without changing page order', () => {
    const { result, setLayout, stored } = mount();
    expect(result.current.activePageIndex).toBe(1);
    expect(setLayout).toHaveBeenCalledExactlyOnceWith({ ...stored, activePageId: 'b' });
  });
  it('waits for hydration and adopts Home exactly once, leaving later navigation alone', () => {
    const { result, setLayout, rerender, stored } = mount({ loaded: false });
    expect(setLayout).not.toHaveBeenCalled();
    rerender({ layout: stored, loaded: true });
    expect(result.current.activePageIndex).toBe(1);
    rerender({ layout: { ...stored, activePageId: 'a' }, loaded: true });
    expect(result.current.activePageIndex).toBe(0);
    expect(setLayout).toHaveBeenCalledTimes(1);
  });
  it('a preview follows the displayed page instead of jumping Home', () => {
    const { result, setLayout } = mount({ kiosk: false });
    expect(result.current.activePageIndex).toBe(2);
    expect(setLayout).not.toHaveBeenCalled();
  });
  it.each([undefined, 'deleted', BLANK_PAGE_ID])('falls back to the first real page for %s Home', homePageId => {
    const { result, setLayout } = mount({ stored: { ...seed(), homePageId } });
    expect(result.current.activePageIndex).toBe(0);
    expect(setLayout.mock.calls[0][0].activePageId).toBe('a');
    expect(setLayout.mock.calls[0][0].homePageId).toBe(homePageId);
  });
  it('maps Home against shown pages and falls back when Home is hidden', () => {
    const shownHome = mount({ shown: ['b', 'c'] });
    expect(shownHome.result.current.activePageIndex).toBe(0);
    expect(shownHome.setLayout.mock.calls[0][0].activePageId).toBe('b');
    const hidden = mount({ shown: ['c'] });
    expect(hidden.result.current.activePageIndex).toBe(0);
    expect(hidden.setLayout).not.toHaveBeenCalled(); // already on the first reachable page
  });
  it('keeps other surfaces starting at page one', () => {
    const { result, setLayout } = mount({ stored: { ...seed(), surface: 'phone' } });
    expect(result.current.activePageIndex).toBe(0);
    expect(setLayout.mock.calls[0][0].activePageId).toBe('a');
  });
  it('returns to Home through the same user-navigation path without echoing another layout write', () => {
    const { result, setLayout, rerender, stored } = mount();
    rerender({ layout: { ...stored, activePageId: BLANK_PAGE_ID }, loaded: true });
    expect(result.current.activePageIndex).toBe(3);
    act(() => result.current.handlePageChange(1));
    expect(setLayout.mock.calls.at(-1)?.[0]).toEqual({ ...stored, activePageId: 'b' });
    rerender({ layout: { ...stored, activePageId: 'b' }, loaded: true });
    expect(setLayout).toHaveBeenCalledTimes(2);
  });
});
