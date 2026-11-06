import { act, render, screen, waitFor, fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Device-page composition integration; the editor and layout path stay real.

const fetchPanelDevicesMock = vi.fn();
const patchPanelDeviceMock = vi.fn();
const registryState = vi.hoisted(() => ({ soloSingleInstance: true }));

vi.mock('../../../api/service', () => ({
  fetchService: vi.fn().mockResolvedValue(null),
  postService: vi.fn().mockResolvedValue(null),
}));
vi.mock('../../../api/displays', () => ({
  demoteDisplayPanel: vi.fn().mockResolvedValue(null),
  fetchDisplays: vi.fn().mockResolvedValue({ displays: [] }),
  fetchDisplayTopology: vi.fn().mockResolvedValue({
    hostingSupported: false,
    rotationSupported: false,
    reserveSupported: false,
    positionsAvailable: false,
    revision: 1,
    displays: [],
    hint: '',
  }),
  fetchXeneonEdgeSettings: vi.fn().mockResolvedValue(null),
  rotateDisplay: vi.fn().mockResolvedValue(null),
  setDisplayBrightness: vi.fn().mockResolvedValue(null),
  setXeneonEdgeSettings: vi.fn().mockResolvedValue(null),
}));
vi.mock('../../../api/profiles', () => ({
  fetchPreferences: vi.fn().mockResolvedValue({ panel: { autoLaunch: false, reserveMonitor: true } }),
  savePreferences: vi.fn().mockResolvedValue(null),
}));
vi.mock('./PanelPresetToolbar', () => ({ PanelPresetToolbar: () => null }));
vi.mock('../../../api/panel', () => ({
  fetchPanelDeviceWithStatus: vi.fn().mockResolvedValue({ found: false, status: 404 }),
  allocatePanelDevice: vi.fn().mockResolvedValue({ id: 'rec1' }),
  fetchPanelDevice: vi.fn().mockResolvedValue(null),
  fetchPanelDevices: (...a: unknown[]) => fetchPanelDevicesMock(...a),
  patchPanelDevice: (...a: unknown[]) => patchPanelDeviceMock(...a),
}));
vi.mock('../../../hooks/useMultiplexSocket', () => ({
  useTopicCallback: () => {},
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
  PanelWidgetCatalog: ({ blockedTypeHints, onAdd }: { blockedTypeHints?: Record<string, string>; onAdd: (type: string, size: string) => unknown }) =>
    <div data-testid="catalog" data-blocked={JSON.stringify(blockedTypeHints)}>
      <button onClick={() => onAdd('app:solo', '4x2')}>Add single-instance app</button>
    </div>,
}));
vi.mock('../../../panel/editor/PanelThemeSettings', () => ({
  PanelThemeSettings: () => <div data-testid="theme" />,
}));
vi.mock('../../../panel/widgets/registry', () => ({
  lookupApp: (type: string) => ({
    meta: { type, i18nKey: 'k', sizes: ['2x2'], defaultSize: '2x2', singleInstance: type === 'app:solo' && registryState.soloSingleInstance, icon: () => null },
    Widget: () => <div data-testid="widget-preview" />,
    Settings: undefined,
  }),
  sizesForSurface: () => ['2x2'],
  appAvailableForSurface: () => true,
}));
vi.mock('./PanelEmbedFrame', () => ({
  PanelEmbedFrame: ({ deviceFamily, panelsEditing, layout }: { deviceFamily?: string; panelsEditing?: boolean; layout: PanelLayout }) => <div data-testid="embed" data-family={deviceFamily} data-editing={String(panelsEditing)} data-panels={JSON.stringify(layout.d215Panels)} data-layout={JSON.stringify(layout)} />,
}));

import { PanelDevicePage } from './PanelDevicePage';
import type { PanelLayout } from '../../../panel/types';
import type { PanelDevice } from '../../../panel/device/panelDevices';

const DEVICE: PanelDevice = {
  id: 'lianli-galahad2-lcd',
  name: 'Lian Li Galahad II LCD',
  connectionKind: 'usb',
  surfaceProfileKey: 'lcd-round',
  runtimeSurface: 'lcd-round',
  panelRecordId: 'rec1',
  capabilities: {
    layout: true, theme: true, displayControls: false, launchClose: false,
    pairing: false, presence: false, touch: false,
  },
} as PanelDevice;

beforeEach(() => {
  registryState.soloSingleInstance = true;
  fetchPanelDevicesMock.mockReset();
  patchPanelDeviceMock.mockReset().mockResolvedValue({ ok: true });
});
afterEach(() => vi.restoreAllMocks());
const COPY = 'devices.jungle-leopard-d215.panels';
const wide = { ...DEVICE, id: 'd215', family: 'jungle-leopard-d215', sourceId: 'jungle-leopard-d215', name: 'D215',
  runtimeSurface: 'lcd-wide', panelRecordId: 'rec1', previewSize: { width: 1680, height: 756 } } as PanelDevice;
const layout: PanelLayout = { layoutSchemaVersion: 2, surface: 'lcd-wide',
  pages: [{ id: 'page', widgets: [{ id: 'main', type: 'clock', size: '4x2', col: 0, row: 0 }] }],
  d215Panels: { enabled: true, items: [{ id: 'circle', type: 'clock', x: 0.5, y: 0.5, diameter: 0.4 }] } };
function record(family = 'jungle-leopard-d215') {
  return { devices: [{ id: 'rec1', layout, portrait: false, capabilities: { surface: 'lcd-wide', family, touch: false,
    cssWidth: 1680, cssHeight: 756, dpr: 1 } }] };
}

describe('D215 Panels tab integration', () => {
  it('reenables Widgets without activating a remembered playlist app already used by a circle', async () => {
    fetchPanelDevicesMock.mockResolvedValue({ devices: [{ ...record().devices[0], layout: {
      ...layout, widgetPlaylist: { enabled: true, interval: 15, shuffle: false, types: ['clock', 'app:solo'], order: ['clock', 'app:solo'] },
      d215Panels: { enabled: true, items: [{ ...layout.d215Panels!.items[0], type: 'app:solo' }] },
    } }] });
    render(<PanelDevicePage device={wide} />);
    fireEvent.click(await screen.findByRole('switch', { name: 'devices.jungle-leopard-d215.widgets.enabled' }));
    await waitFor(() => expect(patchPanelDeviceMock).toHaveBeenCalled());
    const saved = patchPanelDeviceMock.mock.lastCall?.[1].layout;
    expect(saved.d215Widget.enabled).toBe(true);
    expect(saved.widgetPlaylist.types).toEqual(['clock']);
    expect(saved.widgetPlaylist.order).toEqual(['clock', 'app:solo']);
    expect(saved.d215Panels.items[0].type).toBe('app:solo');
  });

  it('refreshes conflict feedback when an installed SDK manifest arrives after the layout', async () => {
    registryState.soloSingleInstance = false;
    fetchPanelDevicesMock.mockResolvedValue({ devices: [{ ...record().devices[0], layout: {
      ...layout, d215Panels: { enabled: true, items: [{ ...layout.d215Panels!.items[0], type: 'app:solo' }] },
    } }] });
    const view = render(<PanelDevicePage device={wide} />);
    await screen.findByRole('switch', { name: 'devices.jungle-leopard-d215.widgets.enabled' });
    expect(screen.getByTestId('catalog').getAttribute('data-blocked')).not.toContain('app:solo');
    registryState.soloSingleInstance = true;
    view.rerender(<PanelDevicePage device={wide} />);
    expect(screen.getByTestId('catalog').getAttribute('data-blocked')).toContain('app:solo');
    fireEvent.click(screen.getByRole('button', { name: 'Add single-instance app' }));
    expect(patchPanelDeviceMock).not.toHaveBeenCalled();
  });

  it('explains a single-instance circle conflict and refuses an invalid Widget selection before saving', async () => {
    fetchPanelDevicesMock.mockResolvedValue({ devices: [{ ...record().devices[0], layout: {
      ...layout, d215Panels: { enabled: true, items: [{ ...layout.d215Panels!.items[0], type: 'app:solo' }] },
    } }] });
    render(<PanelDevicePage device={wide} />);
    await waitFor(() => expect(screen.getByTestId('catalog').getAttribute('data-blocked')).toContain('app:solo'));
    expect(screen.getByTestId('catalog').getAttribute('data-blocked')).toContain('widgets.singleInstanceInPanels');
    fireEvent.click(screen.getByRole('button', { name: 'Add single-instance app' }));
    expect(patchPanelDeviceMock).not.toHaveBeenCalled();
  });

  it('offers an independent Widgets toggle above Playlist without the exclusive-mode card', async () => {
    fetchPanelDevicesMock.mockResolvedValue(record());
    render(<PanelDevicePage device={wide} />);
    const widgets = await screen.findByRole('switch', { name: 'devices.jungle-leopard-d215.widgets.enabled' });
    const playlist = screen.getByRole('switch', { name: 'panel.playlist.playlist' });
    expect(widgets.compareDocumentPosition(playlist) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(widgets).toHaveAttribute('aria-checked', 'false');
    expect(screen.queryByRole('button', { name: `${COPY}.showWidgets` })).not.toBeInTheDocument();
    const before = JSON.parse(screen.getByTestId('embed').getAttribute('data-layout')!);
    fireEvent.click(widgets);
    await waitFor(() => expect(patchPanelDeviceMock).toHaveBeenCalled());
    const saved = patchPanelDeviceMock.mock.lastCall?.[1].layout;
    expect(saved.d215Widget).toMatchObject({ enabled: true, x: 0.5, y: 0.5, scale: 0.6 });
    expect(saved.d215Panels).toEqual(layout.d215Panels);
    expect(saved.pages).toEqual(before.pages);
  });

  it('places Panels immediately after Widgets and forwards family and editor mode to the real preview', async () => {
    fetchPanelDevicesMock.mockResolvedValue(record());
    render(<PanelDevicePage device={wide} />);
    const panels = await screen.findByRole('tab', { name: `${COPY}.title` });
    expect(screen.getAllByRole('tab').slice(0, 3).map(tab => tab.textContent)).toEqual([
      'devices.y70.tab.widgets', `${COPY}.title`, 'devices.y70.tab.theme',
    ]);
    await act(async () => { fireEvent.click(panels); });
    await waitFor(() => expect(screen.getByTestId('embed')).toHaveAttribute('data-family', 'jungle-leopard-d215'));
    expect(screen.getByTestId('embed')).toHaveAttribute('data-editing', 'true');
    fireEvent.click(screen.getByRole('tab', { name: 'devices.y70.tab.theme' }));
    expect(screen.getByTestId('embed')).toHaveAttribute('data-editing', 'false');
  });

  it('persists Panels mode without changing the retained full-screen Widget', async () => {
    fetchPanelDevicesMock.mockResolvedValue(record());
    render(<PanelDevicePage device={wide} />);
    const panels = await screen.findByRole('tab', { name: `${COPY}.title` });
    await act(async () => { fireEvent.click(panels); });
    const toggle = await screen.findByRole('switch', { name: `${COPY}.enabled` });
    await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'true'));
    fireEvent.click(toggle);
    await waitFor(() => expect(patchPanelDeviceMock).toHaveBeenCalled());
    const patch = patchPanelDeviceMock.mock.lastCall?.[1];
    expect(patch.layout.d215Panels).toEqual({ ...layout.d215Panels, enabled: false });
    expect(patch.layout.pages[0].widgets[0]).toMatchObject({ id: 'main', type: 'clock' });
  });

  it('keeps the ordinary wide and round LCD menus unchanged', async () => {
    fetchPanelDevicesMock.mockResolvedValue(record('other-lcd'));
    render(<PanelDevicePage device={{ ...wide, family: 'other-lcd', sourceId: 'other-lcd' }} />);
    await screen.findByRole('tab', { name: 'devices.y70.tab.widgets' });
    expect(screen.queryByRole('tab', { name: `${COPY}.title` })).not.toBeInTheDocument();
  });
});
