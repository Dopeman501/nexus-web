import { act, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PanelPager } from './PanelPager';

afterEach(() => vi.restoreAllMocks());
describe('PanelPager reordered page geometry', () => {
  it('suppresses travelling across other pages while the same page moves to a new slot', () => {
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { frames.push(callback); return frames.length; });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(300);
    const renderPage = (page: { id: string }) => <span>{page.id}</span>;
    const view = render(<PanelPager pages={[{ id: 'a' }, { id: 'b' }]} activeIndex={1} onActiveChange={() => {}} renderPage={renderPage} />);
    view.rerender(<PanelPager pages={[{ id: 'b' }, { id: 'a' }]} activeIndex={0} onActiveChange={() => {}} renderPage={renderPage} />);
    const track = view.container.querySelector('[data-state]')!;
    expect(track).toHaveAttribute('data-order-changing', 'true');
    expect(view.container.querySelector('[data-panel-page-id="b"]')).toHaveAttribute('aria-hidden', 'false');
    act(() => { frames.forEach(callback => callback(1)); });
    expect(track).not.toHaveAttribute('data-order-changing');
  });
});
