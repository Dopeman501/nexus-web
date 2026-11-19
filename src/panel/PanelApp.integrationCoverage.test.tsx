import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useState, type ComponentProps } from 'react';
import type { DndContextProps, DragEndEvent, DragMoveEvent, DragOverEvent, DragStartEvent } from '@dnd-kit/core';
import type { PanelDevicePatch, PanelDeviceRecord } from '../api/panel';
import type { PanelLayout, PanelWidget } from './types';

const fetchMock = vi.fn();
const patchMock = vi.fn();
const patchCapsMock = vi.fn();
const dnd = vi.hoisted(() => ({ current: null as DndContextProps | null }));
const displayTargets = vi.hoisted(() => ({
  targets: [] as { id: string; name: string; number: string }[], add: vi.fn(),
}));
const animateDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'animate');

vi.mock('../api/panel', async importOriginal => ({
  ...await importOriginal<typeof import('../api/panel')>(),
  fetchPanelDeviceWithStatus: (...args: unknown[]) => fetchMock(...args),
  patchPanelDeviceWithStatus: (...args: unknown[]) => patchMock(...args),
  patchPanelDevice: (...args: unknown[]) => patchCapsMock(...args),
}));
vi.mock('../hooks/useMultiplexSocket', async importOriginal => ({
  ...await importOriginal<typeof import('../hooks/useMultiplexSocket')>(),
  useMultiplex: () => null, useTopic: () => null, useTopicCallback: () => {},
}));
vi.mock('../hooks/useServiceStatus', async importOriginal => ({
  ...await importOriginal<typeof import('../hooks/useServiceStatus')>(),
  useServiceStatus: () => ({ state: 'online', ping: { platform: 'windows' } }),
}));
vi.mock('./engine/panelSync', () => ({
  broadcastLayoutChanged: vi.fn(), onLayoutChanged: () => () => {},
}));
vi.mock('./engine/useDisplayTargets', () => ({
  useDisplayTargets: () => ({ targets: displayTargets.targets, addToDisplay: displayTargets.add }),
}));
// The public drag-event source is the integration boundary here. Keep the
// real context/cells, layout operations, preview, persistence and retirement.
// Pointer-sensor activation itself belongs to its existing input tests.
vi.mock('@dnd-kit/core', async importOriginal => {
  const actual = await importOriginal<typeof import('@dnd-kit/core')>();
  const Context = actual.DndContext;
  return { ...actual, DndContext: (props: DndContextProps) => {
    dnd.current = props;
    return <Context {...props} />;
  } };
});

import PanelApp, { PanelContent, PanelEmbeddedContent } from './PanelApp';
import { UiSettingsProvider, useUiSettings } from '../hooks/useUiSettings';
import { webViewHost, type WebViewHostSnapshot } from './webview/webViewHost';
import * as serviceApi from '../api/service';
import * as displayApi from '../api/displays';
import { BLANK_PAGE_ID } from './engine/panelLayoutOps';

const clock = (id: string, row = 0): PanelWidget => ({
  id, type: 'clock', size: '2x2', col: 0, row,
  config: { design: 'digital', showDate: true, showSeconds: true, preserved: 'keep' },
});
const initialLayout = (): PanelLayout => ({
  layoutSchemaVersion: 2, surface: 'monitor', activePageId: 'p0',
  pages: [{ id: 'p0', widgets: [clock('w1'), clock('w2', 2)] }],
});
let stored: PanelDeviceRecord;
let controlledWrites: PanelLayout[] = [];

const tile = (id = 'w1') => document.querySelector<HTMLElement>(`[data-panel-widget-id="${id}"]`)!;
const frame = () => document.querySelector<HTMLElement>('[data-freeform-frame]');
const root = () => document.querySelector<HTMLElement>('.panel-root[data-surface="monitor"]')!;
const layouts = (): PanelLayout[] => patchMock.mock.calls
  .map(([, patch]) => (patch as PanelDevicePatch).layout)
  .filter((layout): layout is PanelLayout => !!layout);
const savedWidget = (id = 'w1') => layouts().at(-1)?.pages.flatMap(page => page.widgets).find(widget => widget.id === id);

async function settle(ms = 500) { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); }
async function mount(extra: Partial<PanelDeviceRecord> = {}) {
  stored = {
    id: 'disp-rec', displayName: 'Panel integration fixture', firstSeenAt: 0, lastSeenAt: 0,
    displayId: 'disp1', backdrop: 'theme', widgetsLocked: false, alwaysOnTop: false,
    layout: initialLayout(), capabilities: { surface: 'monitor', touch: false, dpi: 94,
      cssWidth: 1920, cssHeight: 1200, dpr: 1 }, ...extra,
  };
  fetchMock.mockImplementation(async () => ({ found: true, record: stored }));
  patchMock.mockImplementation(async (_id: string, patch: PanelDevicePatch) => {
    stored = { ...stored, ...patch } as PanelDeviceRecord;
    return { ok: true, record: stored };
  });
  render(<UiSettingsProvider serviceOnline manageDom={false}><PanelApp deviceId="disp-rec" /></UiSettingsProvider>);
  await waitFor(() => expect(tile()).not.toBeNull());
  await settle(1000);
  patchMock.mockClear();
}
async function mountContent(props: Partial<ComponentProps<typeof PanelContent>>, layout = initialLayout()) {
  function Content() {
    const [current, setCurrent] = useState(layout);
    const { settings } = useUiSettings();
    const layoutState = { layout: current, loaded: true, setLayout: (next: PanelLayout) => {
      controlledWrites.push(next); setCurrent(next);
    } };
    return <>
      <output data-testid="pinned-apps">{settings.pinnedSidebarApps.join(',')}</output>
      {props.embedded && props.surface === 'desktop'
        ? <PanelEmbeddedContent layoutState={layoutState} onSectionNavigate={props.onSectionNavigate} />
        : <PanelContent surface="monitor" {...props} layoutState={layoutState} />}
    </>;
  }
  render(<UiSettingsProvider serviceOnline manageDom={false}><Content /></UiSettingsProvider>);
  await waitFor(() => expect(tile()).not.toBeNull());
  await settle(1000);
  controlledWrites = [];
}
async function menu(id = 'w1') {
  fireEvent.contextMenu(tile(id), { clientX: 50, clientY: 50 });
  await screen.findByRole('button', { name: 'panel.widget.menu.remove', hidden: true });
}
async function edit(id = 'w1') {
  await menu(id);
  fireEvent.click(screen.getByRole('button', { name: 'panel.widget.menu.edit', hidden: true }));
  await screen.findByRole('dialog', { name: 'panel.widget.clock' });
  await settle(150);
}
async function resizeMode() {
  await menu();
  fireEvent.click(screen.getByRole('button', { name: 'panel.widget.menu.resize', hidden: true }));
  await settle(150);
  expect(frame()).not.toBeNull();
}
function dragEvent(id: string, target: string | null, delta = { x: 100, y: 0 }) {
  return {
    active: { id, data: { current: {} }, rect: { current: { initial: null, translated: null } } },
    over: target ? { id: target, data: { current: {} }, rect: tile()?.getBoundingClientRect(), disabled: false } : null,
    activatorEvent: new MouseEvent('pointerdown', { clientX: 50, clientY: 50 }), delta, collisions: [],
  } as unknown as DragStartEvent & DragMoveEvent & DragOverEvent & DragEndEvent;
}
async function beginDrag(id = 'w1', target = 'empty:p0:2:0') {
  const event = dragEvent(id, target);
  await act(async () => dnd.current?.onDragStart?.(event));
  await act(async () => dnd.current?.onDragMove?.({ ...event, delta: { x: 1, y: 0 } }));
  expect(tile(id).className).not.toContain('cellDragSource');
  await act(async () => dnd.current?.onDragMove?.(event));
  expect(tile(id).className).toContain('cellDragSource');
  await act(async () => dnd.current?.onDragOver?.(event));
  return event;
}

beforeEach(() => {
  fetchMock.mockReset(); patchMock.mockReset(); patchCapsMock.mockReset().mockResolvedValue(null);
  dnd.current = null;
  controlledWrites = [];
  displayTargets.targets = [];
  displayTargets.add.mockReset().mockResolvedValue(true);
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 404 })));
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: 1920 });
  Object.defineProperty(window, 'innerHeight', { configurable: true, writable: true, value: 1200 });
  Object.defineProperty(window, 'devicePixelRatio', { configurable: true, writable: true, value: 1 });
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(() => ({
    x: 0, y: 0, top: 0, left: 0, right: 1920, bottom: 1200, width: 1920, height: 1200, toJSON: () => ({}),
  }));
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(200);
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(200);
  Element.prototype.setPointerCapture = vi.fn();
  Object.defineProperty(Element.prototype, 'animate', { configurable: true, value: () => {
    const animation = { onfinish: null as (() => void) | null, oncancel: null as (() => void) | null };
    queueMicrotask(() => animation.onfinish?.());
    return animation;
  } });
});
afterEach(() => {
  cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks();
  if (animateDescriptor) Object.defineProperty(Element.prototype, 'animate', animateDescriptor);
  else Reflect.deleteProperty(Element.prototype, 'animate');
});

describe('PanelApp editing and layout integration', () => {
  it('merges successive real editor changes without losing stored config or sibling placement', async () => {
    await mount();
    const original = structuredClone(stored.layout);
    await edit();
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('switch', { name: 'panel.widget.clock.settings.showSeconds' }));
    fireEvent.click(within(dialog).getByRole('switch', { name: 'panel.widget.clock.settings.showDate' }));
    await settle();
    expect(savedWidget()?.config).toMatchObject({ showSeconds: false, showDate: false, preserved: 'keep' });
    expect(savedWidget('w2')).toEqual(original?.pages[0].widgets[1]);
    expect(original?.pages[0].widgets[0].config).toMatchObject({ showSeconds: true, showDate: true });
    fireEvent.click(within(dialog).getByRole('button', { name: 'app.window.close' }));
    await settle();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('resizes through the open editor, preserves its dock, then removes that widget and closes the editor', async () => {
    await mount();
    await edit();
    fireEvent.click(screen.getByRole('button', { name: 'panel.editor.size 4x2' }));
    await settle();
    expect(savedWidget()?.size).toBe('4x2');
    expect(screen.getByRole('dialog')).toHaveAttribute('data-docked', 'true');
    fireEvent.resize(window);
    fireEvent(window, new Event('orientationchange'));
    fireEvent.click(screen.getByRole('button', { name: 'panel.editor.removeWidget' }));
    await settle();
    expect(tile()).toBeNull();
    expect(tile('w2')).not.toBeNull();
    expect(savedWidget()).toBeUndefined();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('keeps a forbidden save visible in the editor and clears the notice after a later successful edit', async () => {
    await mount();
    await edit();
    patchMock.mockResolvedValueOnce({ ok: false, status: 403, msg: 'deck_action_requires_desktop' });
    fireEvent.click(screen.getByRole('switch', { name: 'panel.widget.clock.settings.showSeconds' }));
    await settle();
    expect(screen.getByText('panel.settings.deck.saveForbidden').closest('[role="status"]')).not.toBeNull();
    fireEvent.click(screen.getByRole('switch', { name: 'panel.widget.clock.settings.showDate' }));
    await settle();
    expect(screen.queryByText('panel.settings.deck.saveForbidden')).toBeNull();
    expect(savedWidget()?.config).toMatchObject({ showDate: false });
  });

  it('treats the current menu size as a no-op and persists a different size', async () => {
    await mount({ backdrop: 'desktop', clickThrough: false });
    await menu();
    fireEvent.click(screen.getByRole('button', { name: '2x2', hidden: true }));
    await settle();
    expect(layouts()).toHaveLength(0);
    await menu();
    fireEvent.click(screen.getByRole('button', { name: '4x2', hidden: true }));
    await settle();
    expect(savedWidget()?.size).toBe('4x2');
    expect(tile('w2')).not.toBeNull();
  });

  it('sends panel-wide lock and stacking intent to the owning record without changing its layout', async () => {
    await mount({ backdrop: 'desktop', clickThrough: false });
    await menu();
    fireEvent.click(screen.getByRole('button', { name: 'panel.widget.menu.lockWidgets', hidden: true }));
    expect(patchCapsMock).toHaveBeenCalledWith('disp-rec', { widgetsLocked: true });
    await settle();
    await menu();
    fireEvent.click(screen.getByRole('button', { name: 'panel.widget.menu.alwaysOnTop', hidden: true }));
    expect(patchCapsMock).toHaveBeenCalledWith('disp-rec', { alwaysOnTop: true });
    expect(layouts()).toHaveLength(0);
  });

  it('adds a chosen catalog widget once and keeps the existing instances and their settings', async () => {
    await mount();
    const original = structuredClone(stored.layout);
    await menu();
    fireEvent.click(screen.getByRole('button', { name: 'panel.widget.menu.addWidget', hidden: true }));
    const catalog = await screen.findByRole('dialog', { name: 'panel.editor.addWidgetTitle' });
    fireEvent.click(within(catalog).getByRole('button', { name: 'panel.widget.calendar' }));
    await settle();
    const widgets = layouts().at(-1)!.pages.flatMap(page => page.widgets);
    expect(widgets).toHaveLength(3);
    expect(widgets.filter(widget => widget.type === 'calendar')).toHaveLength(1);
    expect(widgets.find(widget => widget.id === 'w1')).toEqual(original?.pages[0].widgets[0]);
    expect(widgets.find(widget => widget.id === 'w2')).toEqual(original?.pages[0].widgets[1]);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('sets and clears the immersive-on-load preference through the touch-capable editor', async () => {
    await mount({ capabilities: { surface: 'monitor', touch: true, dpi: 94, cssWidth: 1920, cssHeight: 1200, dpr: 1 } });
    await edit();
    fireEvent.click(screen.getByRole('switch', { name: 'panel.editor.immersiveOnLoad' }));
    await settle();
    expect(layouts().at(-1)?.immersiveOnLoadWidgetId).toBe('w1');
    fireEvent.click(screen.getByRole('switch', { name: 'panel.editor.immersiveOnLoad' }));
    await settle();
    expect(layouts()).toHaveLength(2);
    expect(layouts().at(-1)?.immersiveOnLoadWidgetId ?? null).toBeNull();
    expect(screen.getByRole('switch', { name: 'panel.editor.immersiveOnLoad' })).not.toBeChecked();
    expect(savedWidget()?.config).toMatchObject({ preserved: 'keep' });
  });

  it.each(['pagehide', 'visibilitychange'] as const)('puts away the panel tray on %s', async event => {
    await mount({ backdrop: 'desktop', clickThrough: true });
    await menu();
    fireEvent.click(screen.getByRole('button', { name: 'panel.actions.label', hidden: true }));
    const tray = document.querySelector('aside[aria-label="panel.actions.label"]');
    expect(tray).toHaveAttribute('data-state', 'open');
    if (event === 'visibilitychange') {
      vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
      fireEvent(document, new Event(event));
    } else fireEvent(window, new Event(event));
    await settle();
    expect(tray).toHaveAttribute('data-state', 'closed');
    expect(layouts()).toHaveLength(0);
  });
});

describe('PanelApp resize-mode input boundaries', () => {
  it.each(['Escape', 'outside-cancel', 'outside-click', 'tile-tap'] as const)(
    'exits with %s without changing the stored widget or opening its editor', async exit => {
      await mount();
      await resizeMode();
      if (exit === 'Escape') fireEvent.keyDown(document, { key: 'Escape' });
      else if (exit === 'tile-tap') {
        fireEvent.pointerDown(tile(), { pointerId: 1, clientX: 10, clientY: 10 });
        fireEvent.pointerUp(tile(), { pointerId: 1, clientX: 10, clientY: 10 });
        fireEvent.click(tile(), { detail: 1 });
      } else {
        fireEvent.pointerDown(root(), { pointerId: 1 });
        if (exit === 'outside-cancel') fireEvent.pointerCancel(root(), { pointerId: 1 });
        else {
          fireEvent.pointerUp(root(), { pointerId: 1 });
          fireEvent.click(root(), { detail: 1 });
        }
      }
      await settle();
      expect(frame()).toBeNull();
      expect(layouts()).toHaveLength(0);
      expect(screen.queryByRole('dialog')).toBeNull();
    },
  );

  it('commits a keyboard corner step and keeps the resized widget selectable', async () => {
    await mount();
    await resizeMode();
    const corner = screen.getByRole('button', { name: 'panel.freeform.handle.bottomRight' });
    fireEvent.keyDown(corner, { key: 'ArrowRight' });
    await settle();
    expect(savedWidget()?.size).toBe('4x2');
    expect(frame()).not.toBeNull();
    fireEvent.keyDown(document, { key: 'Escape' });
    await settle();
    await edit();
    expect(screen.getByRole('dialog')).not.toBeNull();
  });

  it('cancels an uncompleted corner gesture on unmount without saving a draft', async () => {
    await mount();
    await resizeMode();
    const corner = screen.getByRole('button', { name: 'panel.freeform.handle.bottomRight' });
    fireEvent.pointerDown(corner, { pointerId: 1, button: 0, pointerType: 'mouse', clientX: 10, clientY: 10 });
    fireEvent.pointerMove(corner, { pointerId: 1, clientX: 500, clientY: 10 });
    cleanup();
    await settle();
    expect(layouts()).toHaveLength(0);
  });
});

describe('PanelApp drag-event integration', () => {
  it('persists a valid drop to an empty cell without replacing widget identities or config', async () => {
    await mount();
    const original = structuredClone(stored.layout);
    const event = await beginDrag();
    await act(async () => dnd.current?.onDragEnd?.(event));
    await settle();
    expect(savedWidget()).toMatchObject({ id: 'w1', col: 2, row: 0, config: original?.pages[0].widgets[0].config });
    expect(savedWidget('w2')?.id).toBe('w2');
    expect(original?.pages[0].widgets[0].col).toBe(0);
    expect(tile().className).not.toContain('cellDragSource');
  });

  it.each([null, 'w1', 'not-a-target', 'empty:missing-page:0:0'])(
    'preserves the layout when a drag ends over %s', async target => {
      await mount();
      const event = await beginDrag('w1', target ?? 'empty:p0:2:0');
      await act(async () => dnd.current?.onDragEnd?.({ ...event, over: target ? { ...event.over!, id: target } : null }));
      await settle();
      expect(layouts()).toHaveLength(0);
      expect(tile().dataset.panelCellCol).toBe('0');
      expect(tile('w2')).not.toBeNull();
    },
  );

  it('cancels an armed and moved drag without persisting its make-room preview', async () => {
    await mount();
    await beginDrag('w1', 'w2');
    await act(async () => dnd.current?.onDragCancel?.(dragEvent('w1', 'w2')));
    await settle();
    expect(layouts()).toHaveLength(0);
    expect(tile().dataset.panelCellRow).toBe('0');
    expect(tile('w2').dataset.panelCellRow).toBe('2');
    expect(tile().className).not.toContain('cellDragSource');
  });

  it('commits a dragged widget to its temporary new page and preserves the Home identity', async () => {
    const layout = { ...initialLayout(), surface: 'y70' as const, homePageId: 'p0' };
    await mountContent({ surface: 'y70', deviceTouch: true, shortSideSlots: 4 }, layout);
    const before = new Set(Array.from(document.querySelectorAll<HTMLElement>('[data-panel-page-id]'), page => page.dataset.panelPageId));
    const event = await beginDrag();
    const phantom = Array.from(document.querySelectorAll<HTMLElement>('[data-panel-page-id]'))
      .map(page => page.dataset.panelPageId!).find(id => !before.has(id) && id !== BLANK_PAGE_ID);
    expect(phantom).toBeTruthy();
    const drop = { ...event, over: { ...event.over!, id: `empty:${phantom}:0:0` } };
    await act(async () => dnd.current?.onDragOver?.(drop));
    await act(async () => dnd.current?.onDragEnd?.(drop));
    await settle();
    const saved = controlledWrites.at(-1)!;
    expect(saved.homePageId).toBe('p0');
    expect(saved.pages).toHaveLength(2);
    expect(saved.pages.find(page => page.id === phantom)?.widgets.map(widget => widget.id)).toEqual(['w1']);
    expect(saved.pages.find(page => page.id === 'p0')?.widgets.map(widget => widget.id)).toEqual(['w2']);
  });
});

describe('PanelApp dashboard and preview boundaries', () => {
  it('opens the dashboard app, changes sidebar pins, and copies the authored widget to a selected display', async () => {
    displayTargets.targets = [{ id: 'display-two', name: 'Fixture monitor', number: '2' }];
    const navigate = vi.fn();
    const layout = { ...initialLayout(), surface: 'desktop' as const,
      pages: [{ id: 'p0', widgets: [{ ...clock('w1'), type: 'monitoring' }] }] };
    await mountContent({ surface: 'desktop', embedded: true, onSectionNavigate: navigate }, layout);
    await menu();
    fireEvent.click(screen.getByRole('button', { name: 'featureDisabled.widget.open', hidden: true }));
    expect(navigate).toHaveBeenCalledWith('monitoring', undefined);
    await settle();
    await menu();
    fireEvent.click(screen.getByRole('button', { name: 'sidebar.unpin', hidden: true }));
    await settle();
    expect(screen.getByTestId('pinned-apps').textContent?.split(',')).not.toContain('monitoring');
    await menu();
    fireEvent.click(screen.getByRole('button', { name: 'sidebar.pin', hidden: true }));
    await settle();
    expect(screen.getByTestId('pinned-apps').textContent?.split(',')).toContain('monitoring');
    await menu();
    fireEvent.click(screen.getByRole('button', { name: 'panel.widget.menu.addToDisplay', hidden: true }));
    expect(displayTargets.add).toHaveBeenCalledWith('display-two', layout.pages[0].widgets[0]);
    expect(controlledWrites).toHaveLength(0);
  });

  it('forwards preview edit and background intent to the parent without opening a second editor', async () => {
    const selected = vi.fn(), background = vi.fn(), backgroundMenu = vi.fn();
    await mountContent({ simulator: true, genericDisplayOverride: true,
      onSimulatorWidgetClicked: selected, onSimulatorBackgroundClicked: background,
      onSimulatorBackgroundMenu: backgroundMenu });
    await menu();
    fireEvent.click(screen.getByRole('button', { name: 'panel.widget.menu.edit', hidden: true }));
    expect(selected).toHaveBeenCalledWith('w1');
    expect(screen.queryByRole('dialog')).toBeNull();
    await settle();
    fireEvent.pointerMove(root(), { clientX: 400, clientY: 400 });
    fireEvent.pointerDown(root(), { clientX: 400, clientY: 400 });
    fireEvent.click(root(), { clientX: 400, clientY: 400 });
    expect(background).toHaveBeenCalledTimes(1);
    expect(backgroundMenu).toHaveBeenCalledWith({ x: 400, y: 400 });
    fireEvent.pointerLeave(root());
    expect(controlledWrites).toHaveLength(0);
  });

  it('ends preview resize mode on window blur without storing an unchanged layout', async () => {
    await mountContent({ simulator: true, genericDisplayOverride: true });
    await resizeMode();
    fireEvent.blur(window);
    await settle();
    expect(frame()).toBeNull();
    expect(controlledWrites).toHaveLength(0);
  });

  it('does not offer a stacking change over a solid backdrop', async () => {
    await mount({ backdrop: 'theme' });
    await menu();
    const item = screen.getByRole('button', { name: 'panel.widget.menu.alwaysOnTop', hidden: true });
    expect(item).toBeDisabled();
    fireEvent.click(item);
    expect(patchCapsMock).not.toHaveBeenCalledWith('disp-rec', { alwaysOnTop: true });
    expect(layouts()).toHaveLength(0);
  });
});

describe('PanelApp Web View menu capability boundary', () => {
  const webLayout = (): PanelLayout => ({ ...initialLayout(), pages: [{ id: 'p0', widgets: [{
    ...clock('w1'), type: 'web-view', size: '4x2', config: { url: 'https://example.com/fixture' },
  }] }] });
  const snapshot = (navControls = true): WebViewHostSnapshot => ({
    status: 'supported', interactive: true, contextMenu: true, navControls, maxViews: 4, overLimit: [],
    views: { w1: { state: 'loaded', canGoBack: true, canGoForward: true, away: true } },
  });

  it('routes only the advertised navigation actions to the matching native view', async () => {
    vi.spyOn(webViewHost, 'getSnapshot').mockReturnValue(snapshot());
    const command = vi.spyOn(webViewHost, 'sendCommand').mockImplementation(() => {});
    await mount({ layout: webLayout() });
    for (const action of ['back', 'forward', 'home'] as const) {
      await menu();
      fireEvent.click(screen.getByRole('button', { name: `panel.widget.web-view.${action}`, hidden: true }));
      expect(command).toHaveBeenLastCalledWith('w1', action);
      await settle(150);
    }
    expect(layouts()).toHaveLength(0);
  });

  it.each(['legacy', 'unsupported', 'missing-view'] as const)('limits the menu for a %s host', async mode => {
    const state = snapshot(mode !== 'legacy');
    vi.spyOn(webViewHost, 'getSnapshot').mockReturnValue(mode === 'unsupported' ? { ...state, status: 'unsupported' }
      : mode === 'missing-view' ? { ...state, views: {} } : state);
    await mount({ layout: webLayout() });
    await menu();
    expect(screen.queryByRole('button', { name: 'panel.widget.web-view.back', hidden: true }) !== null).toBe(mode === 'legacy');
    expect(screen.queryByRole('button', { name: 'panel.widget.web-view.forward', hidden: true })).toBeNull();
    expect(screen.queryByRole('button', { name: 'panel.widget.web-view.home', hidden: true })).toBeNull();
    expect(layouts()).toHaveLength(0);
  });

  it('opens a configured site externally without mutating its view or widget settings', async () => {
    const open = vi.spyOn(serviceApi, 'postService').mockResolvedValue(null);
    await mount({ layout: webLayout() });
    await menu();
    fireEvent.click(screen.getByRole('button', { name: 'featureDisabled.widget.open', hidden: true }));
    expect(open).toHaveBeenCalledWith('/system/open-url', { url: 'https://example.com/fixture' });
    expect(layouts()).toHaveLength(0);
  });

  it('opens a touch-capable kiosk app through its explicit app action', async () => {
    const open = vi.spyOn(displayApi, 'openAppAt').mockResolvedValue(null);
    await mount({ capabilities: { surface: 'monitor', touch: true, dpi: 94, cssWidth: 1920, cssHeight: 1200, dpr: 1 } });
    await menu();
    fireEvent.click(screen.getByRole('button', { name: 'openInApp.open', hidden: true }));
    expect(open).toHaveBeenCalledWith('/system/clock');
    expect(screen.queryByRole('button', { name: 'panel.immersive.close', hidden: true })).toBeNull();
  });
});
