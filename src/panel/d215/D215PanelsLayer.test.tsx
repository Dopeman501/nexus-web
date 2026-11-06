import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WidgetProps } from '../widgets/types';
import { PanelOpaqueProvider, useReportOpaque } from '../widgets/common/PanelOpaqueContext';
import { D215PanelsLayer } from './D215PanelsLayer';
import type { D215PanelsState } from './d215PanelTypes';

const registry = vi.hoisted(() => ({ available: vi.fn(), hidden: new Set<string>() }));

vi.mock('../../lib/i18n', () => ({
  useTranslation: () => ({ t: (key: string, args?: { name?: string }) => args?.name ? `${key}:${args.name}` : key }),
}));

vi.mock('../widgets/registry', () => ({
  lookupApp: (type: string) => type === 'unknown' || registry.hidden.has(type) ? undefined : {
    meta: { type, i18nKey: `panel.widget.${type}`, round: type !== 'deck', singleInstance: type === 'solo' },
    Widget: ({ widget, surface, deviceId }: WidgetProps) => {
      useReportOpaque(widget.id, widget.type === 'gallery');
      return <div data-testid={`widget-${widget.id}`} data-size={widget.size} data-surface={surface} data-device={deviceId}>
        {JSON.stringify(widget.config)}
      </div>;
    },
  },
  appAvailableForSurface: (meta: { round: boolean }, surface: string) => {
    registry.available(surface);
    return meta.round && surface === 'lcd-round';
  },
}));

const capture = vi.fn();
const releaseCapture = vi.fn();

beforeAll(() => {
  Element.prototype.setPointerCapture = capture;
  Element.prototype.releasePointerCapture = releaseCapture;
  Element.prototype.hasPointerCapture = () => true;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
    return new DOMRect(0, 0, this.dataset.d215PanelsCanvas !== undefined ? 1000 : 200,
      this.dataset.d215PanelsCanvas !== undefined ? 500 : 200);
  });
});

const state = (): D215PanelsState => ({
  enabled: true,
  items: [
    { id: 'a', type: 'monitoring', x: 0.3, y: 0.5, diameter: 0.4, config: { label: 'CPU' } },
    { id: 'b', type: 'monitoring', x: 0.8, y: 0.5, diameter: 0.4, config: { label: 'GPU' } },
  ],
});

const press = (element: Element, x: number, y: number, pointerId = 1) => fireEvent.pointerDown(element, {
  clientX: x, clientY: y, pointerId, button: 0, pointerType: 'mouse',
});
const move = (element: Element, x: number, y: number, pointerId = 1) => fireEvent.pointerMove(element, { clientX: x, clientY: y, pointerId });
const up = (element: Element, x: number, y: number, pointerId = 1) => fireEvent.pointerUp(element, { clientX: x, clientY: y, pointerId });

function mount(panels = state(), options: { editing?: boolean; selectedId?: string | null; deviceId?: string } = {}) {
  const onChange = vi.fn();
  const onSelect = vi.fn();
  const props = { panels, editing: true, selectedId: 'a', deviceId: 'd215', onChange, onSelect, ...options };
  const view = render(<D215PanelsLayer {...props} />);
  const circle = (id: string) => view.container.querySelector<HTMLElement>(`[data-d215-panel-id="${id}"]`)!;
  return { ...view, props, onChange, onSelect, circle };
}

beforeEach(() => {
  vi.clearAllMocks();
  registry.hidden.clear();
});

describe('D215PanelsLayer rendering', () => {
  it('draws independent backgrounds in clipped circle containers and removes them when disabled', () => {
    const panels = { ...state(), backgroundsEnabled: true, items: state().items.map((item, index) => ({ ...item,
      background: { mode: 'solid' as const, color: index === 0 ? '#ff0000' : '#0000ff', opacity: 0.7 } })) };
    const { circle, rerender, props } = mount(panels);
    expect(circle('a').querySelector('[data-d215-panel-background]')).toHaveStyle({ '--panel-background-solid': '#ff0000' });
    expect(circle('b').querySelector('[data-d215-panel-background]')).toHaveStyle({ '--panel-background-solid': '#0000ff' });
    expect(circle('a').querySelector('[data-panel-bg-layer]')).toHaveStyle({ '--panel-background-opacity': '0.7' });
    rerender(<D215PanelsLayer {...props} panels={{ ...panels, backgroundsEnabled: false }} />);
    expect(circle('a').querySelector('[data-d215-panel-background]')).toBeNull();
    expect(circle('a')).toHaveAttribute('data-backgrounds', 'false');
    expect(screen.getByTestId('widget-a')).toBeInTheDocument();
  });

  it('renders simultaneous independent round widgets using square bounds and the device identity', () => {
    const { circle } = mount();
    expect(screen.getByTestId('widget-a')).toHaveTextContent('CPU');
    expect(screen.getByTestId('widget-b')).toHaveTextContent('GPU');
    expect(screen.getByTestId('widget-a')).toHaveAttribute('data-size', '2x2round');
    expect(screen.getByTestId('widget-a')).toHaveAttribute('data-surface', 'lcd-round');
    expect(screen.getByTestId('widget-a')).toHaveAttribute('data-device', 'd215');
    expect(circle('a').style.width).toBe('200px');
    expect(circle('a').style.height).toBe('200px');
    expect(circle('a').style.left).toBe('200px');
    expect(circle('a').style.top).toBe('150px');
    expect(registry.available).toHaveBeenCalledWith('lcd-round');
  });

  it('never executes unknown or incompatible round widgets', () => {
    const panels = state();
    panels.items = panels.items.map((item, index) => ({ ...item, type: index === 0 ? 'unknown' : 'deck' }));
    const { container } = mount(panels);
    expect(container.querySelectorAll('[data-d215-panel-id]')).toHaveLength(0);
    expect(screen.queryByTestId('widget-a')).not.toBeInTheDocument();
  });

  it('bounds rendering to six circles even before receiving-state normalization', () => {
    const panels = { enabled: true, items: Array.from({ length: 7 }, (_, index) => ({ ...state().items[0], id: `circle-${index}` })) };
    const { container } = mount(panels);
    expect(container.querySelectorAll('[data-d215-panel-id]')).toHaveLength(6);
  });

  it('executes only one imported instance of a single-instance app without discarding its stored settings', () => {
    const panels = state();
    panels.items = [
      ...panels.items,
      { ...panels.items[0], id: 'solo-one', type: 'solo', config: { label: 'first' } },
      { ...panels.items[0], id: 'solo-two', type: 'solo', config: { label: 'retained duplicate' } },
    ];
    const { container, onChange } = mount(panels);
    expect(container.querySelectorAll('[data-d215-panel-id]')).toHaveLength(3);
    expect(screen.getByTestId('widget-a')).toBeInTheDocument();
    expect(screen.getByTestId('widget-b')).toBeInTheDocument();
    expect(screen.getByTestId('widget-solo-one')).toHaveTextContent('first');
    expect(screen.queryByTestId('widget-solo-two')).not.toBeInTheDocument();
    expect(panels.items[3].config).toEqual({ label: 'retained duplicate' });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('does not let an opaque circle suppress the whole display background', () => {
    const panels = state();
    const reportOpaque = vi.fn();
    panels.items = [{ ...panels.items[0], type: 'gallery' }];
    render(<PanelOpaqueProvider value={reportOpaque}><D215PanelsLayer panels={panels} /></PanelOpaqueProvider>);
    expect(screen.getByTestId('widget-a')).toBeInTheDocument();
    expect(reportOpaque).not.toHaveBeenCalled();
  });

  it('has no edit handles, movement or selection on the real display', () => {
    const { circle, onChange, onSelect } = mount(state(), { editing: false });
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    press(circle('a'), 300, 250);
    move(circle('a'), 500, 250);
    up(circle('a'), 500, 250);
    expect(onChange).not.toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('renders nothing when Panels mode is disabled', () => {
    const { container } = mount({ ...state(), enabled: false });
    expect(container.querySelector('[data-d215-panel-id]')).not.toBeInTheDocument();
  });
});

describe('D215PanelsLayer movement and resizing', () => {
  it('shows matching-size guides during resize and saves the matched diameter once', () => {
    const panels = state();
    panels.items = panels.items.map(item => item.id === 'b' ? { ...item, diameter: 0.6 } : item);
    const { circle, container, onChange } = mount(panels);
    const handle = circle('a').querySelector('[data-corner="se"]')!;
    press(handle, 400, 350);
    move(handle, 499, 449);
    expect(circle('a')).toHaveStyle({ width: '300px', height: '300px' });
    expect(container.querySelector('[data-d215-guide-axis="vertical"]')).not.toBeNull();
    expect(container.querySelector('[data-d215-guide-axis="horizontal"]')).not.toBeNull();
    expect(container.querySelector('[data-d215-matching-size]')).toHaveStyle({ width: '300px', height: '300px' });
    expect(onChange).not.toHaveBeenCalled();
    up(handle, 499, 449);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0].items[0]).toMatchObject({ diameter: 0.6 });
    expect(container.querySelector('[data-d215-matching-size]')).toBeNull();
  });

  it('shows center guides while moving and commits exactly once on release', () => {
    const { circle, container, onChange, onSelect } = mount();
    const item = circle('a');
    press(item, 300, 250);
    move(item, 499, 250);
    expect(onSelect).toHaveBeenCalledWith('a');
    expect(item.style.left).toBe('400px');
    expect(container.querySelector('[data-d215-guide-axis="vertical"]')).toHaveStyle({ left: '500px' });
    expect(onChange).not.toHaveBeenCalled();
    up(item, 499, 250);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0].items[0]).toMatchObject({ id: 'a', x: 0.5, y: 0.5, diameter: 0.4, config: { label: 'CPU' } });
    expect(onChange.mock.calls[0][0].items[1]).toEqual(state().items[1]);
    expect(container.querySelector('[data-d215-guide-axis]')).not.toBeInTheDocument();
    expect(releaseCapture).toHaveBeenCalledWith(1);
  });

  it('does not save a simple selection click or another pointer’s movement', () => {
    const { circle, onChange, onSelect } = mount();
    press(circle('a'), 300, 250);
    move(circle('a'), 500, 250, 2);
    up(circle('a'), 300, 250);
    expect(onSelect).toHaveBeenCalledWith('a');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('does not snap to an unavailable circle that is not being drawn', () => {
    const panels = state();
    panels.items = panels.items.map(item => item.id === 'b' ? { ...item, type: 'unknown' } : item);
    const { circle, container } = mount(panels);
    press(circle('a'), 300, 250);
    move(circle('a'), 799, 250);
    expect(parseFloat(circle('a').style.left)).toBeCloseTo(699);
    expect(container.querySelector('[data-d215-guide-axis="vertical"]')).not.toBeInTheDocument();
  });

  it('resizes to a square from its selected corner, preserving the opposite corner', () => {
    const { circle, onChange } = mount();
    const handle = screen.getByRole('button', { name: /panel.freeform.handle.bottomRight/ });
    press(handle, 400, 350);
    move(handle, 450, 400);
    expect(circle('a').style.width).toBe('250px');
    expect(circle('a').style.height).toBe('250px');
    expect(circle('a').style.left).toBe('200px');
    expect(circle('a').style.top).toBe('150px');
    expect(onChange).not.toHaveBeenCalled();
    up(handle, 450, 400);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0].items[0]).toMatchObject({ x: 0.325, y: 0.55, diameter: 0.5 });
  });

  it.each(['pointercancel', 'escape', 'blur'] as const)('cancels a draft on %s without saving', signal => {
    const { circle, onChange, container } = mount();
    const item = circle('a');
    press(item, 300, 250);
    move(item, 500, 250);
    if (signal === 'pointercancel') fireEvent.pointerCancel(item, { pointerId: 1 });
    if (signal === 'escape') fireEvent.keyDown(window, { key: 'Escape' });
    if (signal === 'blur') fireEvent.blur(window);
    expect(item.style.left).toBe('200px');
    expect(onChange).not.toHaveBeenCalled();
    expect(container.querySelector('[data-d215-guide-axis]')).not.toBeInTheDocument();
    expect(releaseCapture).toHaveBeenCalledWith(1);
  });

  it('discards an old gesture when external state or device identity changes', () => {
    const { circle, props, rerender, onChange } = mount();
    press(circle('a'), 300, 250);
    move(circle('a'), 500, 250);
    const replacement = { ...state(), items: state().items.map(item => ({ ...item, x: 0.6 })) };
    rerender(<D215PanelsLayer {...props} panels={replacement} deviceId="replacement" />);
    up(circle('a'), 500, 250);
    expect(onChange).not.toHaveBeenCalled();
    expect(circle('a').style.left).toBe('500px');
  });

  it('releases pointer capture when unmounted during a gesture', () => {
    const { circle, unmount, onChange } = mount();
    press(circle('a'), 300, 250);
    move(circle('a'), 500, 250);
    unmount();
    expect(releaseCapture).toHaveBeenCalledWith(1);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('cancels when a widget disappears from the registry during a gesture', () => {
    const { circle, props, rerender, onChange } = mount();
    press(circle('a'), 300, 250);
    move(circle('a'), 500, 250);
    registry.hidden.add('monitoring');
    rerender(<D215PanelsLayer {...props} />);
    expect(releaseCapture).toHaveBeenCalledWith(1);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('moves with keyboard arrows and supports coarse Shift movement', () => {
    const { circle, onChange } = mount();
    fireEvent.keyDown(circle('a'), { key: 'ArrowRight' });
    expect(onChange.mock.calls[0][0].items[0].x).toBeCloseTo(0.301);
    fireEvent.keyDown(circle('a'), { key: 'ArrowDown', shiftKey: true });
    expect(onChange.mock.calls[1][0].items[0].y).toBeCloseTo(0.52);
  });

  it('resizes a selected corner with the keyboard without moving other circles', () => {
    const { onChange } = mount();
    fireEvent.keyDown(screen.getByRole('button', { name: /panel.freeform.handle.bottomRight/ }), { key: 'ArrowRight', shiftKey: true });
    expect(onChange.mock.calls[0][0].items[0].diameter).toBeCloseTo(0.42);
    expect(onChange.mock.calls[0][0].items[1]).toEqual(state().items[1]);
  });

  it('responds to a canvas resize and clamps the whole circle inside its new bounds', () => {
    const { circle } = mount({ enabled: true, items: [{ ...state().items[0], x: 1, y: 1, diameter: 1 }] });
    expect(circle('a').style.left).toBe('500px');
    expect(circle('a').style.top).toBe('0px');
    expect(circle('a').style.width).toBe('500px');
    act(() => window.dispatchEvent(new Event('resize')));
    expect(circle('a').style.height).toBe('500px');
  });
});
