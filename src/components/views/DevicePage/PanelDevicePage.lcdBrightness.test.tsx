import { act, render, screen, waitFor, fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The Lian Li AIO LCDs (Galahad II, HydroShift) take a backlight command, so
// their settings tab carries the same brightness slider the Q-series hub gets.
// The service stamps supportsBrightness on the record and the row keys off
// that, not off a model list. The value lives on the record, so a write is a
// broadcast to every subscribed panel client - hence commit-only persistence.

const fetchPanelDevicesMock = vi.fn();
const patchPanelDeviceMock = vi.fn();

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
  PanelWidgetCatalog: () => <div data-testid="catalog" />,
}));
vi.mock('../../../panel/editor/PanelThemeSettings', () => ({
  PanelThemeSettings: () => <div data-testid="theme" />,
}));
vi.mock('../../../panel/widgets/registry', () => ({
  lookupApp: (type: string) => ({
    meta: { type, i18nKey: 'k', sizes: ['2x2'], defaultSize: '2x2', icon: () => null },
    Widget: () => <div data-testid="widget-preview" />,
    Settings: undefined,
  }),
  sizesForSurface: () => ['2x2'],
  appAvailableForSurface: () => true,
}));
vi.mock('./PanelEmbedFrame', () => ({
  PanelEmbedFrame: () => <div data-testid="embed" />,
}));

import { PanelDevicePage } from './PanelDevicePage';
import { fetchService, postService } from '../../../api/service';
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

const record = (supportsBrightness: boolean, lcdBrightness?: number) => ({
  devices: [{
    id: 'rec1',
    lcdBrightness,
    capabilities: {
      surface: 'lcd-round', touch: false, family: 'lianli-galahad2-lcd', supportsBrightness,
    },
  }],
});

beforeEach(() => {
  fetchPanelDevicesMock.mockReset();
  patchPanelDeviceMock.mockReset().mockResolvedValue({ ok: true });
});

afterEach(() => vi.restoreAllMocks());

// No I18nProvider is mounted, so t() returns the raw key; querying by key
// keeps this independent of copy.
const SETTINGS_TAB = 'devices.y70.tab.settings';
const BRIGHTNESS_LABEL = 'devices.y70.brightness';

async function openSettingsTab() {
  const tab = await screen.findByRole('tab', { name: SETTINGS_TAB });
  await act(async () => { fireEvent.click(tab); });
}

describe('PanelDevicePage cooler-LCD brightness', () => {
  it('starts at full backlight when the record carries no setting', async () => {
    fetchPanelDevicesMock.mockResolvedValue(record(true));
    render(<PanelDevicePage device={DEVICE} />);
    await openSettingsTab();

    const slider = await screen.findByRole('slider', { name: BRIGHTNESS_LABEL }) as HTMLInputElement;
    expect(slider.value).toBe('100');
  });

  it('reads the record value and persists on commit as lcdBrightness', async () => {
    fetchPanelDevicesMock.mockResolvedValue(record(true, 40));
    render(<PanelDevicePage device={DEVICE} />);
    await openSettingsTab();

    const slider = await screen.findByRole('slider', { name: BRIGHTNESS_LABEL }) as HTMLInputElement;
    expect(slider.value).toBe('40');

    fireEvent.change(slider, { target: { value: '65' } });
    fireEvent.keyUp(slider);

    await waitFor(() => expect(patchPanelDeviceMock).toHaveBeenCalledWith('rec1', { lcdBrightness: 65 }));
    // Exactly once: the slider fires onChange(commit) AND onCommit for a typed
    // edit, so persisting from both would double the write this rework exists
    // to cut.
    expect(patchPanelDeviceMock).toHaveBeenCalledTimes(1);
  });

  it('previews a drag without writing the record on every tick', async () => {
    fetchPanelDevicesMock.mockResolvedValue(record(true, 40));
    render(<PanelDevicePage device={DEVICE} />);
    await openSettingsTab();

    const slider = await screen.findByRole('slider', { name: BRIGHTNESS_LABEL }) as HTMLInputElement;
    fireEvent.change(slider, { target: { value: '50' } });
    fireEvent.change(slider, { target: { value: '60' } });

    // A record write fans out a broadcast to every subscribed panel client, so
    // the intermediate steps must stay local.
    expect(slider.value).toBe('60');
    expect(patchPanelDeviceMock).not.toHaveBeenCalled();
  });

  it('never shows the row for a cooler LCD with no backlight command', async () => {
    fetchPanelDevicesMock.mockResolvedValue(record(false));
    render(<PanelDevicePage device={DEVICE} />);
    await openSettingsTab();

    // The mounting section still renders, so the tab is open and the slider's
    // absence is the capability gate rather than an unrendered tab.
    expect(await screen.findByRole('switch', { name: 'devices.lcd.flip180' })).toBeInTheDocument();
    expect(screen.queryByRole('slider', { name: BRIGHTNESS_LABEL })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'devices.jungle-leopard-d215.restart.label' })).toBeNull();
  });
});

describe('PanelDevicePage D215 brightness', () => {
  const d215: PanelDevice = {
    ...DEVICE,
    id: 'stream:portrait',
    sourceId: 'jungle-leopard-d215',
    family: 'jungle-leopard-d215',
    name: 'Jungle Leopard D215',
    runtimeSurface: 'lcd-portrait',
    connectionKind: 'usb-display',
    panelRecordId: 'portrait',
  };
  const path = '/panel/devices/portrait/d215-brightness';
  const copy = 'devices.jungle-leopard-d215.brightness';
  const preset = (value: number) => screen.getByRole('button', { name: `${value}%` });
  const readBrightness = vi.fn();

  function setRecord(surface: 'lcd-portrait' | 'lcd-wide') {
    fetchPanelDevicesMock.mockResolvedValue({
      devices: [{ id: 'portrait', lcdBrightness: 100, capabilities: {
        surface, family: 'jungle-leopard-d215', touch: false, supportsBrightness: true,
      } }],
    });
  }

  beforeEach(() => {
    readBrightness.mockReset();
    vi.mocked(fetchService).mockReset().mockImplementation(route => route === path ? readBrightness() : Promise.resolve(null));
    vi.mocked(postService).mockReset().mockResolvedValue(null);
    setRecord('lcd-portrait');
  });

  it.each(['lcd-portrait', 'lcd-wide'] as const)('uses the same record on %s, with no automatic write and no generic slider', async surface => {
    setRecord(surface);
    readBrightness.mockResolvedValue({ status: 'confirmed', value: 80 });
    render(<PanelDevicePage device={{ ...d215, runtimeSurface: surface }} />);
    expect(fetchService).not.toHaveBeenCalledWith(path, expect.anything());
    await openSettingsTab();

    await waitFor(() => expect(preset(80)).toHaveAttribute('aria-pressed', 'true'));
    expect(screen.getByRole('button', { name: 'devices.jungle-leopard-d215.restart.label' })).toBeEnabled();
    expect(fetchService).toHaveBeenCalledWith(path, expect.any(AbortSignal));
    expect(preset(100)).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByRole('slider', { name: BRIGHTNESS_LABEL })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'devices.panels.resetHardware.button' })).not.toBeInTheDocument();
    expect(postService).not.toHaveBeenCalled();
    expect(patchPanelDeviceMock).not.toHaveBeenCalled();
  });

  it.each([20, 40, 60, 80, 100])('sets preset %i after confirmed hardware readback', async value => {
    readBrightness.mockResolvedValue({ status: 'confirmed', value: value === 100 ? 80 : 100 });
    let complete!: (result: unknown) => void;
    vi.mocked(postService).mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
    render(<PanelDevicePage device={d215} />);
    await openSettingsTab();
    await waitFor(() => expect(preset(value)).toBeEnabled());
    expect(screen.getAllByRole('button', { name: /^(20|40|60|80|100)%$/ }).map(button => button.textContent))
      .toEqual(['20%', '40%', '60%', '80%', '100%']);

    fireEvent.click(preset(value));
    expect(postService).toHaveBeenCalledWith(path, { value }, expect.any(AbortSignal));
    for (const level of [20, 40, 60, 80, 100]) expect(preset(level)).toBeDisabled();
    expect(preset(value)).toHaveAttribute('aria-pressed', 'false');
    await act(async () => { complete({ status: 'confirmed', value }); });

    expect(screen.getByRole('status')).toHaveTextContent(`${value}%`);
    expect(preset(value)).toHaveAttribute('aria-pressed', 'true');
    expect(preset(value)).toBeDisabled();
    expect(preset(value === 100 ? 80 : 100)).toBeEnabled();
    expect(patchPanelDeviceMock).not.toHaveBeenCalled();
  });

  it('waits for hardware readback and preserves the reported value on mismatch', async () => {
    readBrightness.mockResolvedValue({ status: 'confirmed', value: 80 });
    let complete!: (result: unknown) => void;
    vi.mocked(postService).mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
    render(<PanelDevicePage device={d215} />);
    await openSettingsTab();
    await waitFor(() => expect(preset(100)).toBeEnabled());

    fireEvent.click(preset(100));
    expect(postService).toHaveBeenCalledWith(path, { value: 100 }, expect.any(AbortSignal));
    expect(screen.getByText(`${copy}.writing`)).toBeInTheDocument();
    expect(preset(100)).toHaveAttribute('aria-pressed', 'false');
    expect(preset(80)).toBeDisabled();
    expect(preset(100)).toBeDisabled();
    await act(async () => { complete({ status: 'mismatch', value: 92 }); });

    expect(screen.getByText(`${copy}.mismatch`)).toBeInTheDocument();
    expect(screen.getByRole('status').textContent).toContain('92%');
    expect(preset(80)).toHaveAttribute('aria-pressed', 'false');
    expect(preset(100)).toHaveAttribute('aria-pressed', 'false');
    expect(preset(100)).toBeEnabled();
  });

  it('requires a fresh confirmed read before writing again when brightness is unknown', async () => {
    readBrightness
      .mockResolvedValueOnce({ status: 'confirmed', value: 80 })
      .mockResolvedValueOnce({ status: 'unavailable', value: null })
      .mockResolvedValueOnce({ status: 'confirmed', value: 100 });
    vi.mocked(postService).mockResolvedValueOnce({ status: 'failed', value: null });
    render(<PanelDevicePage device={d215} />);
    await openSettingsTab();
    await waitFor(() => expect(preset(100)).toBeEnabled());
    fireEvent.click(preset(100));

    await screen.findByText(`${copy}.failed`);
    expect(screen.getByText(`${copy}.unknown`)).toBeInTheDocument();
    expect(preset(80)).toHaveAttribute('aria-pressed', 'false');
    expect(preset(100)).toBeDisabled();
    const refresh = () => fireEvent.click(screen.getByRole('button', { name: 'diagnostics.refresh' }));
    refresh();
    await screen.findByText(`${copy}.unavailable`);
    expect(preset(100)).toBeDisabled();
    refresh();
    await waitFor(() => expect(preset(100)).toHaveAttribute('aria-pressed', 'true'));
    expect(preset(80)).toBeEnabled();
    expect(postService).toHaveBeenCalledTimes(1);
  });

  it('discards a late write result after reopening the settings and reading a new value', async () => {
    readBrightness.mockResolvedValueOnce({ status: 'confirmed', value: 80 })
      .mockResolvedValueOnce({ status: 'confirmed', value: 100 });
    let complete!: (result: unknown) => void;
    vi.mocked(postService).mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
    render(<PanelDevicePage device={d215} />);
    await openSettingsTab();
    fireEvent.click(preset(100));
    fireEvent.click(screen.getByRole('tab', { name: 'devices.y70.tab.widgets' }));
    await openSettingsTab();
    await waitFor(() => expect(preset(100)).toHaveAttribute('aria-pressed', 'true'));

    await act(async () => { complete({ status: 'mismatch', value: 80 }); });
    expect(preset(100)).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByText(`${copy}.mismatch`)).not.toBeInTheDocument();
  });
});
