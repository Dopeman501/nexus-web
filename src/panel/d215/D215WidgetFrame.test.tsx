import { act, fireEvent, render, screen } from '@testing-library/react';
import { useEffect, useState, type ReactNode } from 'react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { D215WidgetFrame } from './D215WidgetFrame';
import type { D215WidgetState } from './d215Widget';

vi.mock('../../lib/i18n', () => ({
  useTranslation: () => ({ t: (key: string, args?: { name?: string }) => args?.name ? `${key}:${args.name}` : key }),
}));

const capture = vi.fn();
const release = vi.fn();
const mounted = vi.fn();
const disposed = vi.fn();
let canvas = { width: 1000, height: 500 };

beforeAll(() => {
  Element.prototype.setPointerCapture = capture;
  Element.prototype.releasePointerCapture = release;
  Element.prototype.hasPointerCapture = () => true;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
    return this.dataset.d215WidgetCanvas !== undefined ? new DOMRect(0, 0, canvas.width, canvas.height) : new DOMRect(0, 0, 200, 100);
  });
});
beforeEach(() => { vi.clearAllMocks(); canvas = { width: 1000, height: 500 }; });

function LiveWidget() {
  useEffect(() => { mounted(); return () => { disposed(); }; }, []);
  return <div data-testid="live-widget" />;
}
const initial = (): D215WidgetState => ({ enabled: true, x: 0.3, y: 0.5, scale: 0.4 });
const press = (element: Element, x: number, y: number, pointerId = 1) => fireEvent.pointerDown(element, { clientX: x, clientY: y, pointerId, button: 0 });
const move = (element: Element, x: number, y: number, pointerId = 1) => fireEvent.pointerMove(element, { clientX: x, clientY: y, pointerId });
const up = (element: Element, x: number, y: number, pointerId = 1) => fireEvent.pointerUp(element, { clientX: x, clientY: y, pointerId });

function mount(state = initial(), extra: { editing?: boolean; selected?: boolean; deviceId?: string; children?: ReactNode } = {}) {
  const onChange = vi.fn();
  const onSelect = vi.fn();
  const props = { state, editing: true, selected: true, label: 'Aquarium', deviceId: 'd215', children: <LiveWidget />, onChange, onSelect, ...extra };
  const view = render(<D215WidgetFrame {...props} />);
  const frame = () => view.container.querySelector<HTMLElement>('[data-d215-widget-frame]')!;
  const content = () => view.container.querySelector<HTMLElement>('[data-d215-widget-content]')!;
  return { ...view, props, frame, content, onChange, onSelect };
}

describe('D215WidgetFrame rendering and ownership', () => {
  it('renders one full-native canvas uniformly scaled inside a clipped rectangle', () => {
    const { frame, content } = mount();
    expect(screen.getAllByTestId('live-widget')).toHaveLength(1);
    expect(frame()).toHaveStyle({ left: '100px', top: '150px', width: '400px', height: '200px' });
    expect(content()).toHaveStyle({ width: '1000px', height: '500px', transform: 'scale(0.4)' });
    expect(mounted).toHaveBeenCalledTimes(1);
  });

  it('moves/resizes the host without remounting its live child and unmounts it when disabled', () => {
    const { props, rerender } = mount();
    rerender(<D215WidgetFrame {...props} state={{ ...initial(), x: 0.6, scale: 0.6 }} />);
    expect(mounted).toHaveBeenCalledTimes(1);
    expect(disposed).not.toHaveBeenCalled();
    rerender(<D215WidgetFrame {...props} state={{ ...initial(), enabled: false }} />);
    expect(screen.queryByTestId('live-widget')).not.toBeInTheDocument();
    expect(disposed).toHaveBeenCalledTimes(1);
  });

  it('keeps runtime content free of handles, selection and gesture writes', () => {
    const { frame, onChange, onSelect } = mount(initial(), { editing: false });
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    press(frame(), 300, 250);
    move(frame(), 500, 250);
    up(frame(), 500, 250);
    expect(onChange).not.toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('captures editing presses before an existing widget can start its own gesture', () => {
    const childPress = vi.fn();
    const { onSelect, content } = mount(initial(), { children: <button onPointerDown={childPress}>Existing tile</button> });
    press(screen.getByRole('button', { name: 'Existing tile' }), 300, 250);
    expect(childPress).not.toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalled();
    expect(content()).toHaveStyle({ pointerEvents: 'none' });
  });
});

describe('D215WidgetFrame gestures', () => {
  it('keeps a selected playlist stand-in mounted while dragging instead of opening settings and replacing its key', () => {
    const configured = vi.fn();
    const changed = vi.fn();
    function PlaylistHarness() {
      const [id, setId] = useState('playlist:d215:clock');
      return <D215WidgetFrame key={id} state={initial()} selected editing deviceId="d215"
        onChange={changed} onSelect={() => { configured(); setId('retained-clock'); }}>
        <LiveWidget />
      </D215WidgetFrame>;
    }
    const { container } = render(<PlaylistHarness />);
    const frame = container.querySelector<HTMLElement>('[data-d215-widget-frame]')!;
    press(frame, 300, 250);
    expect(configured).not.toHaveBeenCalled();
    move(frame, 500, 250);
    expect(frame).toHaveStyle({ left: '300px' });
    up(frame, 500, 250);
    fireEvent.click(frame);
    expect(changed).toHaveBeenCalledTimes(1);
    expect(configured).not.toHaveBeenCalled();
    expect(mounted).toHaveBeenCalledTimes(1);
    expect(disposed).not.toHaveBeenCalled();
  });

  it('opens settings on an ordinary no-drag click only after its release, and on Enter', () => {
    const { frame, onSelect } = mount();
    press(frame(), 300, 250);
    expect(onSelect).not.toHaveBeenCalled();
    up(frame(), 300, 250);
    expect(onSelect).not.toHaveBeenCalled();
    fireEvent.click(frame());
    expect(onSelect).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(frame(), { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledTimes(2);
  });

  it('shows alignment guides on the live draft and saves once on completion', () => {
    const { frame, container, onChange } = mount();
    press(frame(), 300, 250);
    move(frame(), 499, 250);
    expect(frame()).toHaveStyle({ left: '300px', top: '150px' });
    expect(container.querySelector('[data-d215-widget-guide-axis="vertical"]')).toHaveStyle({ left: '500px' });
    expect(onChange).not.toHaveBeenCalled();
    up(frame(), 499, 250);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({ ...initial(), x: 0.5 });
    expect(container.querySelector('[data-d215-widget-guide-axis]')).not.toBeInTheDocument();
    expect(release).toHaveBeenCalledWith(1);
  });

  it('preserves aspect and the opposite corner while resizing, with no interim save', () => {
    const { frame, content, onChange, onSelect } = mount();
    const handle = screen.getByRole('button', { name: /panel.freeform.handle.bottomRight/ });
    press(handle, 500, 350);
    move(handle, 600, 400);
    expect(frame()).toHaveStyle({ left: '100px', top: '150px', width: '500px', height: '250px' });
    expect(content()).toHaveStyle({ transform: 'scale(0.5)' });
    expect(onChange).not.toHaveBeenCalled();
    up(handle, 600, 400);
    fireEvent.click(handle);
    expect(onChange).toHaveBeenCalledWith({ ...initial(), x: 0.35, y: 0.55, scale: 0.5 });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('ignores a simple click and unrelated pointer events', () => {
    const { frame, onChange } = mount();
    press(frame(), 300, 250);
    move(frame(), 500, 250, 2);
    up(frame(), 300, 250);
    expect(onChange).not.toHaveBeenCalled();
  });

  it.each(['pointercancel', 'escape', 'blur'] as const)('cancels on %s and restores the saved bounds', signal => {
    const { frame, onChange } = mount();
    press(frame(), 300, 250);
    move(frame(), 500, 250);
    if (signal === 'pointercancel') fireEvent.pointerCancel(frame(), { pointerId: 1 });
    if (signal === 'escape') fireEvent.keyDown(window, { key: 'Escape' });
    if (signal === 'blur') fireEvent.blur(window);
    expect(frame()).toHaveStyle({ left: '100px' });
    expect(onChange).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledWith(1);
  });

  it('rejects a late completion after a record or saved-frame replacement', () => {
    const { frame, props, rerender, onChange } = mount();
    press(frame(), 300, 250);
    move(frame(), 500, 250);
    rerender(<D215WidgetFrame {...props} deviceId="other" state={{ ...initial(), x: 0.7 }} />);
    up(frame(), 500, 250);
    expect(onChange).not.toHaveBeenCalled();
    expect(frame()).toHaveStyle({ left: '500px' });
    expect(release).toHaveBeenCalledWith(1);
  });

  it('cancels and re-fits to the changed canvas orientation without remounting its child', () => {
    const { frame, content, onChange } = mount();
    press(frame(), 300, 250);
    move(frame(), 500, 250);
    canvas = { width: 500, height: 1000 };
    act(() => window.dispatchEvent(new Event('resize')));
    expect(frame()).toHaveStyle({ left: '50px', top: '300px', width: '200px', height: '400px' });
    expect(content()).toHaveStyle({ width: '500px', height: '1000px' });
    expect(onChange).not.toHaveBeenCalled();
    expect(mounted).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledWith(1);
  });

  it('releases capture on unmount and when editing is turned off', () => {
    const { frame, props, rerender, unmount, onChange } = mount();
    press(frame(), 300, 250);
    move(frame(), 500, 250);
    rerender(<D215WidgetFrame {...props} editing={false} />);
    expect(release).toHaveBeenCalledTimes(1);
    rerender(<D215WidgetFrame {...props} />);
    press(frame(), 300, 250);
    unmount();
    expect(release).toHaveBeenCalledTimes(2);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('moves and resizes by keyboard, with Shift for coarse steps', () => {
    const { frame, onChange, onSelect } = mount();
    fireEvent.keyDown(frame(), { key: 'ArrowRight' });
    expect(onChange.mock.calls[0][0].x).toBeCloseTo(0.301);
    fireEvent.keyDown(screen.getByRole('button', { name: /panel.freeform.handle.bottomRight/ }), { key: 'ArrowDown', shiftKey: true });
    expect(onChange.mock.calls[1][0].scale).toBeCloseTo(0.42);
    expect(onSelect).not.toHaveBeenCalled();
  });
});
