import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { PanelLayout } from '../types';
import { usePageSync } from './usePageSync';
import { BLANK_PAGE_ID } from './panelLayoutOps';

const layoutOf = (ids: string[], activePageId = 'b'): PanelLayout => ({
  layoutSchemaVersion: 2, surface: 'y70', activePageId, homePageId: 'c',
  pages: ids.map(id => ({ id, widgets: [] })),
});
function mount(kioskBehavior = false) {
  const save = vi.fn();
  const view = renderHook(({ layout }) => usePageSync({
    loaded: true, kioskBehavior, layout, paginatedLayout: layout, setLayout: save,
    pageCount: layout.pages.length + 1, blankPageIndex: layout.pages.length, pageDragging: false,
  }), { initialProps: { layout: layoutOf(['a', 'b', 'c']) } });
  return { ...view, save };
}
describe('page identity across reorder', () => {
  it('keeps a viewer on the same page when its active ID moves to another index', () => {
    const { result, rerender, save } = mount();
    expect(result.current.activePageIndex).toBe(1);
    rerender({ layout: layoutOf(['b', 'c', 'a']) });
    expect(result.current.activePageIndex).toBe(0);
    expect(save).not.toHaveBeenCalled();
    act(() => result.current.handlePageChange(1));
    expect(save.mock.calls.at(-1)?.[0].activePageId).toBe('c');
  });
  it('keeps the kiosk on its displayed identity without resetting Home or writing during reorder', () => {
    const { result, rerender, save } = mount(true);
    expect(result.current.activePageIndex).toBe(2); // saved Home
    rerender({ layout: layoutOf(['a', 'b', 'c'], 'c') });
    const before = save.mock.calls.length;
    rerender({ layout: layoutOf(['c', 'a', 'b'], 'c') });
    expect(result.current.activePageIndex).toBe(0);
    expect(save).toHaveBeenCalledTimes(before);
  });
  it('honours an explicit external selection over the identity remap in the same update', () => {
    const { result, rerender } = mount();
    rerender({ layout: layoutOf(['b', 'c', 'a'], 'a') });
    expect(result.current.activePageIndex).toBe(2);
  });
  it('keeps the transient blank selection separate from real page identities', () => {
    const { result, rerender } = mount();
    rerender({ layout: layoutOf(['a', 'b', 'c'], BLANK_PAGE_ID) });
    expect(result.current.activePageIndex).toBe(3);
    rerender({ layout: layoutOf(['c', 'b', 'a'], BLANK_PAGE_ID) });
    expect(result.current.activePageIndex).toBe(3);
  });
});
