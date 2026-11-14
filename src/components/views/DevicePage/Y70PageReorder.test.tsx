import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PanelLayout } from '../../../panel/types';
import { Y70PageReorder } from './Y70PageReorder';

const layout: PanelLayout = { layoutSchemaVersion: 2, surface: 'y70', homePageId: 'p3', activePageId: 'p3',
  pages: Array.from({ length: 7 }, (_, i) => ({ id: `p${i}`, label: `Screen ${i}`, widgets: [] })) };
const rect = (left: number, top: number, width: number, height: number): DOMRect => ({
  left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}),
});
beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
    return this.hasAttribute('data-panel-preview-frame') ? rect(400, 50, 200, 700) : rect(0, 0, 1000, 800);
  });
  HTMLElement.prototype.setPointerCapture = vi.fn();
  HTMLElement.prototype.hasPointerCapture = vi.fn().mockReturnValue(false);
  HTMLElement.prototype.releasePointerCapture = vi.fn();
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
function mount(stored = layout) {
  const commit = vi.fn().mockResolvedValue(true);
  const busy = vi.fn();
  const view = render(<Y70PageReorder enabled ownerKey="y70" layout={stored} pageId="p3" onCommit={commit} onBusyChange={busy}>
    <div data-panel-preview-frame><button>Existing widget</button><iframe title="live preview" /></div>
  </Y70PageReorder>);
  return { ...view, commit, busy };
}
function pointer(target: Element, type: string, x: number, y: number) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, { pointerId: { value: 1 }, pointerType: { value: 'mouse' }, isPrimary: { value: true },
    button: { value: 0 }, buttons: { value: type === 'pointerup' ? 0 : 1 }, clientX: { value: x }, clientY: { value: y } });
  act(() => { target.dispatchEvent(event); });
}
describe('Y70 reorder preview', () => {
  it('does not announce a late save from a retired owner in the new profile', async () => {
    let settle!: (value: boolean) => void;
    const pending = new Promise<boolean>(resolve => { settle = resolve; });
    const view = render(<Y70PageReorder enabled ownerKey="old" layout={layout} pageId="p3" onCommit={() => pending}>
      <div data-panel-preview-frame><iframe title="existing live preview" /></div>
    </Y70PageReorder>);
    const handle = screen.getAllByRole('button', { name: /devices.panels.reorder.handle/ })[0];
    pointer(handle, 'pointerdown', 405, 55); pointer(handle, 'pointermove', 535, 75); pointer(handle, 'pointerup', 535, 75);
    view.rerender(<Y70PageReorder enabled ownerKey="new" layout={layout} pageId="p3" onCommit={async () => true}>
      <div data-panel-preview-frame><iframe title="existing live preview" /></div>
    </Y70PageReorder>);
    await act(async () => { settle(true); });
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });
  it('opens a real-neighbour glass stack from either corner, retaining exactly one live preview', () => {
    const { container, commit } = mount();
    const frame = container.querySelector('iframe');
    const handles = screen.getAllByRole('button', { name: /devices.panels.reorder.handle/ });
    expect(handles).toHaveLength(2);
    pointer(handles[1], 'pointerdown', 595, 55);
    expect(container.querySelector('[data-page-reorder-phase]')).toHaveAttribute('data-page-reorder-phase', 'grabbed');
    expect(container.querySelectorAll('[data-reorder-glass]')).toHaveLength(6);
    expect(container.querySelectorAll('[data-reorder-glass] iframe')).toHaveLength(0);
    expect(container.querySelector('iframe')).toBe(frame);
    pointer(handles[1], 'pointerup', 595, 55);
    expect(commit).not.toHaveBeenCalled();
  });
  it('translates the complete live preview with the pointer and commits only once on a changed drop', async () => {
    const { container, commit } = mount();
    const handle = screen.getAllByRole('button', { name: /devices.panels.reorder.handle/ })[0];
    pointer(handle, 'pointerdown', 405, 55);
    pointer(handle, 'pointermove', 535, 75);
    expect(container.querySelector('[data-reorder-live]')).toHaveStyle({ transform: 'translate(130px, 20px)' });
    await act(async () => { pointer(handle, 'pointerup', 535, 75); });
    expect(commit).toHaveBeenCalledExactlyOnceWith('p3', 4, layout.pages.map(page => page.id));
  });
  it('keeps ordinary widget interaction available outside the two handles', () => {
    const { container, commit } = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Existing widget' }));
    expect(container.querySelector('[data-page-reorder-phase]')).toHaveAttribute('data-page-reorder-phase', 'idle');
    expect(commit).not.toHaveBeenCalled();
  });
  it('has no reorder handles for one page or the transient blank page', () => {
    mount({ ...layout, pages: [layout.pages[0]] });
    expect(screen.queryByRole('button', { name: /devices.panels.reorder.handle/ })).toBeNull();
  });
});
