import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PanelLayout, PanelWidget } from '../../../panel/types';
import { BLANK_PAGE_ID, removeWidgetById } from '../../../panel/engine/panelLayoutOps';

// The y70 editor capacity (PanelDevicePage.editorCapacity), used by the iframe
// echo path below to mirror an on-device delete.
const Y70_EDITOR_CAP = { gridCols: 4, pageRows: 16 };

// Drive the real PanelDevicePage page-arrow derivation against a 3-page layout
// and a delete that prunes the active last page. Heavy leaves (catalog, theme,
// the iframe preview) are stubbed; the layout engine + arrow logic are real.

const fetchPanelDevicesMock = vi.fn();
const patchPanelDeviceMock = vi.fn();
const topicHandlers = new Map<string, (raw: unknown) => void>();

vi.mock('../../../api/service', () => ({
  fetchService: vi.fn().mockResolvedValue(null),
  postService: vi.fn().mockResolvedValue(null),
}));
vi.mock('../../../api/displays', () => ({
  demoteDisplayPanel: vi.fn().mockResolvedValue(null),
  fetchDisplays: vi.fn().mockResolvedValue({ displays: [] }),
  fetchDisplayTopology: vi.fn().mockResolvedValue(null),
  rotateDisplay: vi.fn().mockResolvedValue(null),
  setDisplayBrightness: vi.fn().mockResolvedValue(null),
}));
vi.mock('../../../api/profiles', () => ({
  fetchPreferences: vi.fn().mockResolvedValue({ panel: { autoLaunch: false, reserveMonitor: true } }),
  savePreferences: vi.fn().mockResolvedValue(null),
}));
vi.mock('./PanelPresetToolbar', () => ({ PanelPresetToolbar: () => null }));
vi.mock('./Y70PageReorder', () => ({
  Y70PageReorder: (props: { children: React.ReactNode; enabled: boolean; pageId: string; layout: PanelLayout; ownerKey: string;
    onBusyChange: (busy: boolean) => void; onCommit: (id: string, to: number, ids: string[]) => Promise<boolean> }) => (
    <div data-testid="reorder" data-order={props.layout.pages.map(page => page.id).join(',')} data-owner={props.ownerKey}>
      {props.children}
      {props.enabled && <button data-testid="reorder-to-first" onClick={async () => {
        props.onBusyChange(true);
        try { await props.onCommit(props.pageId, 0, props.layout.pages.map(page => page.id)); }
        finally { props.onBusyChange(false); }
      }}>Move displayed page to first</button>}
    </div>
  ),
}));
vi.mock('../../../api/panel', () => ({
  fetchPanelDeviceWithStatus: vi.fn().mockResolvedValue({ found: false, status: 404 }),
  allocatePanelDevice: vi.fn().mockResolvedValue({ id: 'dev1' }),
  fetchPanelDevice: vi.fn().mockResolvedValue(null),
  fetchPanelDevices: (...a: unknown[]) => fetchPanelDevicesMock(...a),
  patchPanelDevice: (...a: unknown[]) => patchPanelDeviceMock(...a),
}));
vi.mock('../../../hooks/useMultiplexSocket', () => ({
  useTopicCallback: (topic: string, enabled: boolean, handler: (raw: unknown) => void) => { if (enabled) topicHandlers.set(topic, handler); },
  useMultiplex: () => ({ connected: true }),
}));
vi.mock('../../../panel/engine/panelSync', () => ({
  broadcastLayoutChanged: vi.fn(),
}));
vi.mock('../../../panel/theme/panelTheme', () => ({
  usePanelTheme: () => ({
    theme: { themeSyncWithDesktop: false, themeMode: 'dark', appThemeMode: 'dark', appResolvedThemeMode: 'dark', gaugeGradient: [] },
    commitThemeSync: vi.fn(), commitThemeMode: vi.fn(), commitAccentSync: vi.fn(),
    previewAccent: vi.fn(), commitAccent: vi.fn(), previewBackground: vi.fn(),
    commitBackground: vi.fn(), commitBackgroundMode: vi.fn(), commitBackgroundEffect: vi.fn(),
    commitBackgroundTemplate: vi.fn(), previewBackgroundEffectState: vi.fn(), commitBackgroundEffectState: vi.fn(),
    previewBackgroundOpacity: vi.fn(), commitBackgroundOpacity: vi.fn(), previewWidgetOpacity: vi.fn(),
    commitWidgetOpacity: vi.fn(), commitWidgetLabels: vi.fn(), commitBackgroundFrost: vi.fn(),
  }),
  buildPanelThemeVars: () => ({}),
  panelAccentColor: () => '#2563eb',
  useResolvedPanelThemeMode: () => 'dark',
}));
vi.mock('../../../panel/editor/PanelWidgetCatalog', () => ({
  PanelWidgetCatalog: (props: { onAdd: (type: string, size: string) => void }) => (
    <button data-testid="catalog-add" onClick={() => props.onAdd('cooling', '2x2')}>add</button>
  ),
}));
vi.mock('../../../panel/editor/PanelThemeSettings', () => ({
  PanelThemeSettings: () => <div data-testid="theme" />,
}));
// Stub the widget registry so the inline settings preview + normalize use a
// lightweight app def (the real CoolingWidget needs UiSettingsProvider).
vi.mock('../../../panel/widgets/registry', () => ({
  lookupApp: (type: string) => ({
    meta: { type, i18nKey: 'k', sizes: ['2x2', '4x4'], defaultSize: '2x2', icon: () => null },
    Widget: () => <div data-testid="widget-preview" />,
    Settings: undefined,
  }),
  sizesForSurface: () => ['2x2', '4x4'],
  // 'hidden' stands in for a widget the panel filters out on this surface.
  appAvailableForSurface: (meta: { type: string }) => meta.type !== 'hidden',
}));

// Stub the iframe preview: expose a click target per widget (Path A: opens the
// inline settings → trash) and a direct echo hook (Path B: iframe-side delete).
vi.mock('./PanelEmbedFrame', () => ({
  PanelEmbedFrame: (props: {
    layout: PanelLayout;
    onWidgetClicked: (w: PanelWidget) => void;
    onLayoutChange: (l: PanelLayout) => void;
  }) => (
    <div
      data-testid="embed"
      data-active-page={props.layout.activePageId}
      data-page-count={props.layout.pages.length}
    >
      {/* The iframe swipes back off the blank page and echoes the page it lands on. */}
      <button
        data-testid="swipe-to-p3"
        onClick={() => props.onLayoutChange({ ...props.layout, activePageId: 'p3' })}
      >swipe</button>
      {props.layout.pages.flatMap(p => p.widgets).map(w => (
        <button key={w.id} data-testid={`click-${w.id}`} onClick={() => props.onWidgetClicked(w)}>{w.id}</button>
      ))}
      {props.layout.pages.flatMap(p => p.widgets).map(w => (
        // Path B: the iframe deletes on-device and echoes the new layout up.
        <button
          key={`echo-${w.id}`}
          data-testid={`echo-delete-${w.id}`}
          onClick={() => props.onLayoutChange(removeWidgetById(props.layout, w.id, Y70_EDITOR_CAP))}
        >{w.id}</button>
      ))}
    </div>
  ),
}));

import { PanelDevicePage } from './PanelDevicePage';
import type { PanelDevice } from '../../../panel/device/panelDevices';

function cool(id: string): PanelWidget {
  return { id, type: 'cooling', size: '2x2', col: 0, row: 0 };
}

const LAYOUT_3PAGES: PanelLayout = {
  layoutSchemaVersion: 2,
  surface: 'y70',
  pages: [
    { id: 'p1', widgets: [cool('a')] },
    { id: 'p2', widgets: [cool('b')] },
    { id: 'p3', widgets: [cool('c')] },
  ],
  activePageId: 'p1',
};

const DEVICE: PanelDevice = {
  id: 'dev1',
  name: 'Y70',
  sourceId: 'y70',
  connectionKind: 'simulated',
  surfaceProfileKey: 'y70',
  runtimeSurface: 'y70',
  capabilities: { surface: 'y70', touch: true } as PanelDevice['capabilities'],
} as PanelDevice;

beforeEach(() => {
  topicHandlers.clear();
  localStorage.setItem('nexus_simulated_panel_records', JSON.stringify({ y70: 'dev1' }));
  fetchPanelDevicesMock.mockReset();
  patchPanelDeviceMock.mockReset().mockResolvedValue({ ok: true });
  fetchPanelDevicesMock.mockResolvedValue({
    devices: [{ id: 'dev1', capabilities: { surface: 'y70', touch: true }, layout: LAYOUT_3PAGES, reserveMonitor: true }],
  });
});

afterEach(() => vi.restoreAllMocks());

const prevDisabled = () => (screen.getByLabelText('devices.panels.prevPage') as HTMLButtonElement).disabled;
const nextDisabled = () => (screen.getByLabelText('devices.panels.nextPage') as HTMLButtonElement).disabled;
const embed = () => screen.getByTestId('embed');

describe('Y70 Home control', () => {
  it('orders a delayed Home save before subsequent navigation, keeping the newest page displayed', async () => {
    await loadAndGoToLastPage();
    let settle!: (value: object) => void;
    patchPanelDeviceMock.mockImplementationOnce(() => new Promise(resolve => { settle = resolve; }));
    const before = patchPanelDeviceMock.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'devices.panels.setHome' }));
    fireEvent.click(screen.getByLabelText('devices.panels.prevPage'));
    expect(embed().dataset.activePage).toBe('p2');
    expect(patchPanelDeviceMock.mock.calls.length - before).toBe(1);
    await act(async () => { settle({ ok: true }); });
    const last = patchPanelDeviceMock.mock.calls.at(-1)?.[1].layout as PanelLayout;
    expect(last.activePageId).toBe('p2');
    expect(last.homePageId).toBe('p3');
    expect(embed().dataset.activePage).toBe('p2');
  });
  it('sets the displayed real page as Home without changing the page order or current selection', async () => {
    await loadAndGoToLastPage();
    const before = patchPanelDeviceMock.mock.calls.length;
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'devices.panels.setHome' })); });
    const saved = patchPanelDeviceMock.mock.calls.slice(before).at(-1)?.[1].layout as PanelLayout;
    expect(saved.homePageId).toBe('p3');
    expect(saved.activePageId).toBe('p3');
    expect(saved.pages).toEqual(LAYOUT_3PAGES.pages);
    expect(screen.getByRole('button', { name: 'devices.panels.setHome' })).toHaveAttribute('aria-pressed', 'true');
    await act(async () => { fireEvent.click(screen.getByLabelText('devices.panels.prevPage')); });
    expect(screen.getByRole('button', { name: 'devices.panels.setHome' })).toHaveAttribute('aria-pressed', 'false');
    expect(patchPanelDeviceMock.mock.calls.at(-1)?.[1].layout.homePageId).toBe('p3');
  });

  it('disables on the render-only blank page and while Home is saving', async () => {
    await loadAndGoToLastPage();
    let settle!: (value: null) => void;
    patchPanelDeviceMock.mockImplementationOnce(() => new Promise(resolve => { settle = resolve; }));
    fireEvent.click(screen.getByRole('button', { name: 'devices.panels.setHome' }));
    expect(screen.getByRole('button', { name: 'devices.panels.setHome' })).toBeDisabled();
    await act(async () => { settle(null); });
    expect(screen.getByRole('button', { name: 'devices.panels.setHome' })).toHaveAttribute('aria-pressed', 'false');
    await act(async () => { fireEvent.click(screen.getByLabelText('devices.panels.nextPage')); });
    expect(screen.getByRole('button', { name: 'devices.panels.setHome' })).toBeDisabled();
  });

  it('restores the previous Home when saving fails', async () => {
    await loadAndGoToLastPage();
    patchPanelDeviceMock.mockRejectedValueOnce(new Error('offline'));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'devices.panels.setHome' })); });
    expect(screen.getByRole('button', { name: 'devices.panels.setHome' })).toHaveAttribute('aria-pressed', 'false');
    await act(async () => { fireEvent.click(screen.getByLabelText('devices.panels.prevPage')); });
    expect(patchPanelDeviceMock.mock.calls.at(-1)?.[1].layout.homePageId).toBeUndefined();
  });
});

describe('Y70 reordered layout persistence', () => {
  it.each(['null', 'rejected'])('keeps the prior layout locked through a %s scope read and retries successfully', async failure => {
    await loadAndGoToLastPage();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      if (failure === 'null') fetchPanelDevicesMock.mockResolvedValueOnce(null);
      else fetchPanelDevicesMock.mockRejectedValueOnce(new Error('temporarily offline'));
      await act(async () => { topicHandlers.get('prefs')?.({}); await vi.advanceTimersByTimeAsync(1); });
      expect(screen.getByTestId('reorder')).toHaveAttribute('data-order', 'p1,p2,p3');
      expect(embed().dataset.activePage).toBe('p3');
      expect(screen.queryByTestId('reorder-to-first')).toBeNull();
      await act(async () => { await vi.advanceTimersByTimeAsync(500); });
      expect(screen.getByTestId('reorder-to-first')).toBeInTheDocument();
      expect(screen.getByTestId('reorder')).toHaveAttribute('data-order', 'p1,p2,p3');
    } finally { vi.useRealTimers(); }
  });

  it('bounds automatic scope retries and offers a working manual retry without discarding pages', async () => {
    await loadAndGoToLastPage();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const before = fetchPanelDevicesMock.mock.calls.length;
      fetchPanelDevicesMock.mockResolvedValue(null);
      act(() => { topicHandlers.get('prefs')?.({}); });
      await act(async () => { await vi.advanceTimersByTimeAsync(1); });
      for (const delay of [500, 1500, 3000]) {
        await act(async () => { await vi.advanceTimersByTimeAsync(delay); });
      }
      expect(fetchPanelDevicesMock.mock.calls.length - before).toBe(4);
      expect(screen.getByText('devices.panels.scopeLoadFailed')).toBeInTheDocument();
      expect(screen.getByTestId('reorder')).toHaveAttribute('data-order', 'p1,p2,p3');
      fetchPanelDevicesMock.mockResolvedValue({ devices: [{ id: 'dev1', capabilities: { surface: 'y70', touch: true }, layout: LAYOUT_3PAGES }] });
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'common.retry' })); });
      expect(screen.getByTestId('reorder-to-first')).toBeInTheDocument();
      expect(screen.queryByText('devices.panels.scopeLoadFailed')).toBeNull();
    } finally { vi.useRealTimers(); }
  });
  it('retires the gesture scope on profile prefs changes until the new record is loaded', async () => {
    await loadAndGoToLastPage();
    const owner = screen.getByTestId('reorder').dataset.owner;
    let settle!: (value: unknown) => void;
    fetchPanelDevicesMock.mockImplementationOnce(() => new Promise(resolve => { settle = resolve; }));
    act(() => { topicHandlers.get('prefs')?.({}); });
    expect(screen.getByTestId('reorder').dataset.owner).not.toBe(owner);
    expect(screen.queryByTestId('reorder-to-first')).toBeNull();
    await act(async () => { settle({ devices: [{ id: 'dev1', capabilities: { surface: 'y70', touch: true }, layout: LAYOUT_3PAGES }] }); });
    expect(screen.getByTestId('reorder-to-first')).toBeInTheDocument();
  });
  it('saves complete pages in the new order while retaining the displayed page identity', async () => {
    await loadAndGoToLastPage();
    const before = patchPanelDeviceMock.mock.calls.length;
    await act(async () => { fireEvent.click(screen.getByTestId('reorder-to-first')); });
    const saved = patchPanelDeviceMock.mock.calls.slice(before).at(-1)?.[1].layout as PanelLayout;
    expect(saved.pages.map(page => page.id)).toEqual(['p3', 'p1', 'p2']);
    expect(saved.pages).toEqual([LAYOUT_3PAGES.pages[2], LAYOUT_3PAGES.pages[0], LAYOUT_3PAGES.pages[1]]);
    expect(saved.activePageId).toBe('p3');
    expect(embed().dataset.activePage).toBe('p3');
    expect(prevDisabled()).toBe(true);
  });
  it('keeps original order and selection on failure and blocks conflicting navigation during save', async () => {
    await loadAndGoToLastPage();
    let settle!: (value: null) => void;
    patchPanelDeviceMock.mockImplementationOnce(() => new Promise(resolve => { settle = resolve; }));
    fireEvent.click(screen.getByTestId('reorder-to-first'));
    expect(prevDisabled()).toBe(true);
    expect(screen.getByTestId('reorder')).toHaveAttribute('data-order', 'p1,p2,p3');
    await act(async () => { settle(null); });
    expect(screen.getByTestId('reorder')).toHaveAttribute('data-order', 'p1,p2,p3');
    expect(embed().dataset.activePage).toBe('p3');
    expect(prevDisabled()).toBe(false);
  });
});

async function loadAndGoToLastPage() {
  render(<PanelDevicePage device={DEVICE} />);
  await waitFor(() => screen.getByLabelText('devices.panels.nextPage'));
  // Navigate p1 -> p3 via the desktop next arrow.
  await act(async () => { fireEvent.click(screen.getByLabelText('devices.panels.nextPage')); });
  await act(async () => { fireEvent.click(screen.getByLabelText('devices.panels.nextPage')); });
  await waitFor(() => expect(embed().dataset.activePage).toBe('p3'));
  expect(prevDisabled()).toBe(false);
  // p3 has content, so next leads on to the blank page.
  expect(nextDisabled()).toBe(false);
}

describe('PanelDevicePage page arrows after deleting the last widget on the last page', () => {
  it('Path A (inline settings trash): left arrow stays enabled, right disabled', async () => {
    await loadAndGoToLastPage();
    // Open the widget's inline settings, then remove it.
    await act(async () => { fireEvent.click(screen.getByTestId('click-c')); });
    await waitFor(() => screen.getByLabelText('devices.panels.widgetSettings.remove'));
    await act(async () => { fireEvent.click(screen.getByLabelText('devices.panels.widgetSettings.remove')); });
    // Now 2 pages remain, showing page 2 (index 1): can still go left.
    await waitFor(() => {
      expect(embed().dataset.activePage).toBe('p2');
      expect(prevDisabled()).toBe(false);
    });
  });

  it('Path B (iframe echoes an on-device delete): left arrow stays enabled, right disabled', async () => {
    await loadAndGoToLastPage();
    await act(async () => { fireEvent.click(screen.getByTestId('echo-delete-c')); });
    await waitFor(() => {
      expect(embed().dataset.activePage).toBe('p2');
      expect(prevDisabled()).toBe(false);
    });
  });
});

const patchedActivePages = () => patchPanelDeviceMock.mock.calls
  .map(([, patch]) => (patch as { layout?: PanelLayout }).layout?.activePageId)
  .filter(Boolean);

describe('PanelDevicePage blank page', () => {
  it('steps onto the blank page after the last page and back, storing it for the panel', async () => {
    await loadAndGoToLastPage();
    await act(async () => { fireEvent.click(screen.getByLabelText('devices.panels.nextPage')); });
    await waitFor(() => expect(embed().dataset.activePage).toBe(BLANK_PAGE_ID));
    expect(nextDisabled()).toBe(true);
    expect(prevDisabled()).toBe(false);
    // The physical panel follows the stored page; no page is created.
    await waitFor(() => expect(patchedActivePages().at(-1)).toBe(BLANK_PAGE_ID));
    expect(embed().dataset.pageCount).toBe('3');

    await act(async () => { fireEvent.click(screen.getByLabelText('devices.panels.prevPage')); });
    await waitFor(() => expect(embed().dataset.activePage).toBe('p3'));
    await waitFor(() => expect(patchedActivePages().at(-1)).toBe('p3'));
  });

  it('creates the page when a widget is added on the blank page', async () => {
    await loadAndGoToLastPage();
    await act(async () => { fireEvent.click(screen.getByLabelText('devices.panels.nextPage')); });
    await waitFor(() => expect(embed().dataset.activePage).toBe(BLANK_PAGE_ID));

    await act(async () => { fireEvent.click(screen.getByTestId('catalog-add')); });
    await waitFor(() => expect(embed().dataset.pageCount).toBe('4'));
    expect(['p1', 'p2', 'p3', BLANK_PAGE_ID]).not.toContain(embed().dataset.activePage);
  });

  it('follows the preview off the blank page', async () => {
    await loadAndGoToLastPage();
    await act(async () => { fireEvent.click(screen.getByLabelText('devices.panels.nextPage')); });
    await waitFor(() => expect(embed().dataset.activePage).toBe(BLANK_PAGE_ID));
    await act(async () => { fireEvent.click(screen.getByTestId('swipe-to-p3')); });
    await waitFor(() => expect(embed().dataset.activePage).toBe('p3'));
    expect(nextDisabled()).toBe(false);
    // The next add lands on the shown page instead of opening a new one.
    await act(async () => { fireEvent.click(screen.getByTestId('catalog-add')); });
    await waitFor(() => expect(embed().dataset.activePage).toBe('p3'));
    expect(embed().dataset.pageCount).toBe('3');
  });

  it('adds on the shown page when not on the blank page', async () => {
    await loadAndGoToLastPage();
    await act(async () => { fireEvent.click(screen.getByTestId('catalog-add')); });
    await waitFor(() => expect(embed().dataset.activePage).toBe('p3'));
    expect(embed().dataset.pageCount).toBe('3');
  });

  // Load-time normalization drops widgets the surface cannot show, so the
  // device page and the panel agree on whether the last page has content.
  it('offers no blank page after a last page the panel renders empty', async () => {
    fetchPanelDevicesMock.mockResolvedValue({
      devices: [{
        id: 'dev1',
        capabilities: { surface: 'y70', touch: true },
        layout: { ...LAYOUT_3PAGES, activePageId: 'p3', pages: [...LAYOUT_3PAGES.pages.slice(0, 2), { id: 'p3', widgets: [{ ...cool('c'), type: 'hidden' }] }] },
        reserveMonitor: true,
      }],
    });
    render(<PanelDevicePage device={DEVICE} />);
    await waitFor(() => expect(embed().dataset.activePage).toBe('p3'));
    expect(nextDisabled()).toBe(true);
    expect(prevDisabled()).toBe(false);
  });
});
