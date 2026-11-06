import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PanelLayout, PanelWidget, PanelWidgetSize } from './types';
import * as widgetRegistry from './widgets/registry';
import { useReportOpaque } from './widgets/common/PanelOpaqueContext';
import type { WidgetProps } from './widgets/types';

vi.mock('./background/PanelBackgroundShader', () => ({
  PanelBackgroundShader: ({ covered }: { covered?: boolean }) => <div data-testid="test-shader" data-covered={String(covered)} />,
}));

// The kiosk composition end to end: PanelApp -> usePanelRecord ->
// usePanelLayout -> PanelContent's repagination, with only the transport
// mocked. A hook-level test cannot box this bug: the write lives in
// PanelContent's effect, the layout hook only carries it.
const fetchMock = vi.fn();
const patchMock = vi.fn();
const patchCapsMock = vi.fn();

vi.mock('../api/panel', async importOriginal => ({
  ...await importOriginal<typeof import('../api/panel')>(),
  fetchPanelDeviceWithStatus: (...args: unknown[]) => fetchMock(...args),
  patchPanelDeviceWithStatus: (...args: unknown[]) => patchMock(...args),
  patchPanelDevice: (...args: unknown[]) => patchCapsMock(...args),
}));

vi.mock('../hooks/useMultiplexSocket', async importOriginal => ({
  ...await importOriginal<typeof import('../hooks/useMultiplexSocket')>(),
  useMultiplex: () => null,
  useTopic: () => null,
  useTopicCallback: () => {},
}));

vi.mock('./engine/panelSync', () => ({
  broadcastLayoutChanged: vi.fn(),
  onLayoutChanged: () => () => {},
}));

import PanelApp from './PanelApp';
import { UiSettingsProvider } from '../hooks/useUiSettings';

// A Y70 layout that fills its 4x16 portrait column exactly, in the storage
// order a real record carried (settings.json from a support bundle). The
// calendar sits between the clock and the 4x4 stack - the placement the
// write-back destroys.
const widget = (id: string, type: string, size: PanelWidgetSize, row: number): PanelWidget => ({
  id, type, size, col: 0, row, config: {},
});
const STORED: PanelLayout = {
  layoutSchemaVersion: 2,
  surface: 'y70',
  activePageId: 'page-1',
  pages: [{
    id: 'page-1',
    widgets: [
      widget('w-clock', 'clock', '4x2', 0),
      widget('w-cooling', 'cooling', '4x4', 12),
      widget('w-monitoring', 'monitoring', '4x4', 8),
      widget('w-calendar', 'calendar', '4x2', 2),
      widget('w-weather', 'weather', '4x4', 4),
    ],
  }],
};

const recordWith = (layout: PanelLayout) => ({
  id: 'y70-1',
  displayName: 'Y70',
  firstSeenAt: 0,
  lastSeenAt: 0,
  layout,
  capabilities: { surface: 'y70', touch: true, dpi: 337, cssWidth: 1100, cssHeight: 3840, dpr: 1 },
});

function setViewport(width: number, height: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width });
  Object.defineProperty(window, 'innerHeight', { configurable: true, writable: true, value: height });
  Object.defineProperty(window, 'devicePixelRatio', { configurable: true, writable: true, value: 1 });
  // jsdom has no layout: the panel root measures 0x0 and the grid would fall
  // back to a 1x1 canvas. Report the viewport as every element's rect so
  // useRuntimePanelGrid solves the same capacity the kiosk window would.
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(() => ({
    x: 0, y: 0, top: 0, left: 0, right: width, bottom: height, width, height, toJSON: () => ({}),
  }));
}

function gridCapacity(): { columns: number; rows: number } {
  const root = document.querySelector<HTMLElement>('.panel-root');
  if (!root) throw new Error('panel root not mounted');
  return {
    columns: Number(root.style.getPropertyValue('--panel-columns')),
    rows: Number(root.style.getPropertyValue('--panel-rows')),
  };
}

// Rendered placement, from the cells' own data attributes, in reading order.
function renderedPlacements(): string {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-panel-widget-id]'))
    .map(el => ({
      id: el.dataset.panelWidgetId ?? '',
      col: Number(el.dataset.panelCellCol),
      row: Number(el.dataset.panelCellRow),
    }))
    .sort((a, b) => a.row - b.row || a.col - b.col)
    .map(c => `${c.id}@${c.col},${c.row}`)
    .join(' ');
}

const STORED_PORTRAIT = 'w-clock@0,0 w-calendar@0,2 w-weather@0,4 w-monitoring@0,8 w-cooling@0,12';

async function mountKiosk() {
  render(
    <UiSettingsProvider serviceOnline={true} manageDom={false}>
      <PanelApp deviceId="y70-1" />
    </UiSettingsProvider>,
  );
  await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  // Past the record fetch, the hydration render, and the patch debounce.
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1_000);
  });
}

// The record as the next kiosk would read it: the last layout PATCHed, else
// the stored one.
function recordLayoutNow(): PanelLayout {
  const written = patchMock.mock.calls
    .map(([, patch]) => (patch as { layout?: PanelLayout }).layout)
    .filter((l): l is PanelLayout => !!l);
  return written.length > 0 ? written[written.length - 1] : STORED;
}

beforeEach(() => {
  fetchMock.mockReset();
  patchMock.mockReset();
  patchCapsMock.mockReset();
  fetchMock.mockResolvedValue({ found: true, record: recordWith(STORED) });
  patchMock.mockResolvedValue({ ok: true, record: recordWith(STORED) });
  patchCapsMock.mockResolvedValue(null);
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 404 })));
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('kiosk layout write-back', () => {
  it('never mounts a second single-instance Widget worker from an imported overlap', async () => {
    setViewport(1680, 756);
    const original = widgetRegistry.lookupApp;
    const clock = original('clock')!;
    const ImportedInstance = () => <div data-testid="one-sdk-instance" />;
    vi.spyOn(widgetRegistry, 'lookupApp').mockImplementation(type => type === 'clock' ? {
      ...clock, meta: { ...clock.meta, singleInstance: true }, Widget: ImportedInstance,
    } : original(type));
    const stored: PanelLayout = { layoutSchemaVersion: 2, surface: 'lcd-wide',
      pages: [{ id: 'p', widgets: [widget('main', 'clock', '4x2', 0)] }],
      d215Widget: { enabled: true, x: 0.5, y: 0.5, scale: 0.6 },
      d215Panels: { enabled: true, items: [{ id: 'circle', type: 'clock', x: 0.7, y: 0.5, diameter: 0.4 }] },
    };
    fetchMock.mockResolvedValue({ found: true, record: { ...recordWith(stored), capabilities: {
      surface: 'lcd-wide', family: 'jungle-leopard-d215', touch: false, cssWidth: 1680, cssHeight: 756, dpr: 1,
    } } });
    await mountKiosk();
    expect(document.querySelectorAll('[data-testid="one-sdk-instance"]')).toHaveLength(1);
    expect(document.querySelector('[data-d215-panel-id="circle"]')).not.toBeNull();
    expect(document.querySelector('[data-panel-widget-id="main"]')).toBeNull();
    expect(stored.pages[0].widgets[0].id).toBe('main');
    expect(patchMock).not.toHaveBeenCalled();
  });

  it.each([[true, 1, true], [true, 0.6, false], [false, 1, false]] as const)(
    'only pauses the background for a visible full-canvas opaque Widget (enabled=%s, scale=%s)',
    async (enabled, scale, covered) => {
      setViewport(1680, 756);
      const original = widgetRegistry.lookupApp;
      const clock = original('clock')!;
      const OpaqueWidget = ({ widget }: WidgetProps) => {
        useReportOpaque(widget.id, true);
        return <div data-testid="opaque-widget" />;
      };
      vi.spyOn(widgetRegistry, 'lookupApp').mockImplementation(type => type === 'clock' ? {
        ...clock, Widget: OpaqueWidget,
      } : original(type));
      const stored: PanelLayout = { layoutSchemaVersion: 2, surface: 'lcd-wide',
        pages: [{ id: 'p', widgets: [widget('main', 'clock', '4x2', 0)] }],
        d215Widget: { enabled, x: 0.5, y: 0.5, scale }, d215Panels: { enabled: true, items: [] },
      };
      fetchMock.mockResolvedValue({ found: true, record: { ...recordWith(stored), backgroundMode: 'shader', capabilities: {
        surface: 'lcd-wide', family: 'jungle-leopard-d215', touch: false, cssWidth: 1680, cssHeight: 756, dpr: 1,
      } } });
      await mountKiosk();
      expect(document.querySelector('[data-testid="test-shader"]')).toHaveAttribute('data-covered', String(covered));
      expect(document.querySelectorAll('[data-testid="opaque-widget"]')).toHaveLength(enabled ? 1 : 0);
    },
  );

  it.each([
    [false, false], [true, false], [false, true], [true, true],
  ])('independently renders one Widget=%s and Panels=%s without writing the layout', async (widgetEnabled, panelsEnabled) => {
    setViewport(1680, 756);
    const stored = { layoutSchemaVersion: 2, surface: 'lcd-wide',
      pages: [{ id: 'main-page', widgets: [widget('main', 'clock', '4x2', 0)] }],
      d215Widget: { enabled: widgetEnabled, x: 0.4, y: 0.5, scale: 0.6 },
      d215Panels: { enabled: panelsEnabled, items: [{ id: 'circle', type: 'calendar', x: 0.7, y: 0.5, diameter: 0.4 }] },
    } as PanelLayout;
    fetchMock.mockResolvedValue({ found: true, record: { ...recordWith(stored), capabilities: {
      surface: 'lcd-wide', family: 'jungle-leopard-d215', touch: false, cssWidth: 1680, cssHeight: 756, dpr: 1,
    } } });
    await mountKiosk();
    expect(document.querySelectorAll('[data-panel-widget-id="main"]')).toHaveLength(widgetEnabled ? 1 : 0);
    expect(document.querySelectorAll('[data-d215-panel-id="circle"]')).toHaveLength(panelsEnabled ? 1 : 0);
    expect(document.querySelectorAll('[data-d215-widget-frame]')).toHaveLength(widgetEnabled ? 1 : 0);
    expect(patchMock).not.toHaveBeenCalled();
    expect(stored.pages[0].widgets).toHaveLength(1);
  });

  it.each([
    ['jungle-leopard-d215', true, 6],
    ['jungle-leopard-d215', false, 0],
    ['other-wide-lcd', true, 0],
  ] as const)('renders the saved circle mode only for %s with enabled=%s', async (family, enabled, count) => {
    setViewport(1680, 756);
    const circles = Array.from({ length: 6 }, (_, index) => ({ id: `circle-${index}`, type: 'clock',
      x: ((index % 3) + 0.5) / 3, y: (Math.floor(index / 3) + 0.5) / 2, diameter: 0.4,
      config: { showSeconds: index === 0 } }));
    const stored: PanelLayout = { layoutSchemaVersion: 2, surface: 'lcd-wide',
      pages: [{ id: 'main-page', widgets: [widget('main', 'clock', '4x2', 0)] }],
      d215Panels: { enabled, items: circles } };
    fetchMock.mockResolvedValue({ found: true, record: { ...recordWith(stored), capabilities: {
      surface: 'lcd-wide', family, touch: false, cssWidth: 1680, cssHeight: 756, dpr: 1,
    } } });
    await mountKiosk();
    expect(document.querySelectorAll('[data-d215-panel-id]')).toHaveLength(count);
    expect(document.querySelector('[data-panel-widget-id="main"]') !== null).toBe(count === 0);
    for (const circle of document.querySelectorAll<HTMLElement>('[data-d215-panel-id]')) {
      expect(circle.style.width).toBe(circle.style.height);
      expect(circle.querySelector('[data-size="2x2round"]')).not.toBeNull();
      expect(circle.querySelector('button')).toBeNull();
    }
    expect(patchMock).not.toHaveBeenCalled();
    expect(stored.d215Panels?.items).toHaveLength(6);
  });

  it('never writes a capacity-driven repagination back to the record (landscape Y70 kiosk)', async () => {
    // A display-topology reshuffle briefly hands the Y70 kiosk a 3840x1100
    // window (nexus-overlay: "panel kiosk monitor bounds changed ->
    // 3840x1100; recreating"). The grid transposes to 16x4 and the layout is
    // repacked column-major; that shape must stay render-only. Written back,
    // the portrait re-fit orders by the landscape rows and every 4x2 that
    // sat between 4x4s sinks to the bottom of the column.
    setViewport(3840, 1100);
    await mountKiosk();

    // The transient shape really was in effect for this render.
    expect(gridCapacity()).toEqual({ columns: 16, rows: 4 });
    expect(patchMock).not.toHaveBeenCalled();
  });

  it('never writes the stored layout back on a plain portrait boot either', async () => {
    setViewport(1100, 3840);
    await mountKiosk();

    expect(gridCapacity()).toEqual({ columns: 4, rows: 16 });
    expect(patchMock).not.toHaveBeenCalled();
  });

  it('renders the stored placement when the kiosk comes back portrait after a landscape boot', async () => {
    // The overlay recreates the kiosk on every bounds change, so this is two
    // mounts: one at the transient landscape bounds, then a portrait one
    // reading whatever the first left in the record.
    setViewport(3840, 1100);
    await mountKiosk();
    expect(gridCapacity()).toEqual({ columns: 16, rows: 4 });
    const recordAfterLandscape = recordWith(recordLayoutNow());
    cleanup();

    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ found: true, record: recordAfterLandscape });
    setViewport(1100, 3840);
    await mountKiosk();
    expect(gridCapacity()).toEqual({ columns: 4, rows: 16 });
    expect(renderedPlacements()).toBe(STORED_PORTRAIT);
  });
});
