import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UnifiedDevice } from '../../../hooks/useUnifiedDevices';
import { fetchPanelDevices, type PanelDeviceRecord } from '../../../api/panel';
import { restartD215Screen, type D215RestartResult } from '../../../api/d215Restart';
import { DevicePage } from './DevicePage';

vi.mock('../../common/Toast/Toast', () => ({ useToast: () => ({ push: vi.fn() }) }));
vi.mock('../../../hooks/useConflictApps', () => ({ useConflictApps: () => ({ conflicts: [], ready: true }) }));
vi.mock('../../../api/panel', async importOriginal => ({
  ...(await importOriginal<typeof import('../../../api/panel')>()), fetchPanelDevices: vi.fn(),
}));
vi.mock('../../../api/d215Restart', () => ({ restartD215Screen: vi.fn() }));
vi.mock('../../../hooks/useUnifiedDevices', async importOriginal => ({
  ...(await importOriginal<typeof import('../../../hooks/useUnifiedDevices')>()),
  useUnifiedDevices: () => ({ unified: rows, controlDevice }),
}));

const FAMILY = 'jungle-leopard-d215';
const COPY = `devices.${FAMILY}`;
const controlDevice = vi.fn();
let rows: UnifiedDevice[];
const soft = () => screen.getByRole('button', { name: `${COPY}.recovery.control` });
const hard = () => screen.getByRole('button', { name: `${COPY}.restart.label` });
const record = (id = 'saved-d215'): PanelDeviceRecord => ({
  id, displayName: 'Jungle Leopard D215', firstSeenAt: 1, lastSeenAt: 1,
  capabilities: { family: FAMILY, surface: 'lcd-wide' },
});
function row(overrides: Partial<UnifiedDevice> = {}): UnifiedDevice {
  return {
    key: `curated-${FAMILY}`, curatedId: FAMILY, kind: 'curated',
    name: 'Jungle Leopard D215', shortName: 'Jungle Leopard D215', subtitle: '', category: 'display',
    iconSrc: '', connected: true, navigable: true, nexusControlEnabled: true,
    supportsNexusControl: true, experimental: true, requiresBeta: false,
    warning: 'The display connection failed. Reconnect it or retry Nexus Control.', ...overrides,
  };
}
function deferred<T>() {
  let resolve!: (result: T) => void;
  return { promise: new Promise<T>(complete => { resolve = complete; }), resolve: (result: T) => resolve(result) };
}
const open = () => render(<DevicePage deviceKey={rows[0].key} serviceOnline />);

beforeEach(() => {
  rows = [row()];
  controlDevice.mockReset().mockResolvedValue(true);
  vi.mocked(fetchPanelDevices).mockReset().mockResolvedValue({ devices: [record()] });
  vi.mocked(restartD215Screen).mockReset().mockResolvedValue({ status: 'restarted' });
});
afterEach(() => { vi.useRealTimers(); });

describe('D215 connection-failed recovery actions', () => {
  it('offers both explicit actions on the failed page without sending requests on mount', () => {
    open();
    expect(screen.getByText(rows[0].warning!)).toBeInTheDocument();
    expect(soft()).toBeEnabled();
    expect(hard()).toBeEnabled();
    expect(controlDevice).not.toHaveBeenCalled();
    expect(fetchPanelDevices).not.toHaveBeenCalled();
    expect(restartD215Screen).not.toHaveBeenCalled();
  });

  it('restarts only D215 control with one enabled request and blocks both actions while pending', async () => {
    const pending = deferred<boolean>();
    controlDevice.mockReturnValue(pending.promise);
    open();
    fireEvent.click(soft());
    const busy = screen.getByRole('button', { name: `${COPY}.recovery.restartingControl` });
    expect(busy).toBeDisabled();
    expect(hard()).toBeDisabled();
    fireEvent.click(busy);
    fireEvent.click(hard());
    expect(controlDevice).toHaveBeenCalledExactlyOnceWith(FAMILY, true);
    await act(async () => pending.resolve(true));
    expect(await screen.findByText(`${COPY}.recovery.controlRequested`)).toBeInTheDocument();
    expect(soft()).toBeEnabled();
    expect(hard()).toBeEnabled();
    expect(restartD215Screen).not.toHaveBeenCalled();
  });

  it.each([false, new Error('offline')])('reports a rejected control retry without automatically retrying (%s)', async result => {
    if (result instanceof Error) controlDevice.mockRejectedValue(result);
    else controlDevice.mockResolvedValue(result);
    open();
    fireEvent.click(soft());
    expect(await screen.findByText(`${COPY}.recovery.controlFailed`)).toBeInTheDocument();
    expect(soft()).toBeEnabled();
    expect(controlDevice).toHaveBeenCalledTimes(1);
  });

  it('uses the saved record without requiring a healthy stream and locks both buttons during lookup', async () => {
    const lookup = deferred<{ devices: PanelDeviceRecord[] }>();
    const pending = deferred<D215RestartResult>();
    vi.mocked(fetchPanelDevices).mockReturnValue(lookup.promise);
    vi.mocked(restartD215Screen).mockReturnValue(pending.promise);
    open();
    fireEvent.click(hard());
    expect(soft()).toBeDisabled();
    const busy = screen.getByRole('button', { name: `${COPY}.restart.restarting` });
    expect(busy).toBeDisabled();
    fireEvent.click(busy);
    await act(async () => lookup.resolve({ devices: [record()] }));
    expect(restartD215Screen).toHaveBeenCalledExactlyOnceWith('saved-d215', expect.any(AbortSignal));
    await act(async () => pending.resolve({ status: 'restarted' }));
    expect(await screen.findByText(`${COPY}.restart.restarted`)).toBeInTheDocument();
    expect(hard()).toBeEnabled();
    expect(controlDevice).not.toHaveBeenCalled();
  });

  it.each(['busy', 'unavailable', 'failed', 'uncertain'] as const)('reuses hard-restart %s feedback without automatic retries', async status => {
    vi.mocked(restartD215Screen).mockResolvedValue({ status });
    open(); fireEvent.click(hard());
    expect(await screen.findByText(`${COPY}.restart.${status}`)).toBeInTheDocument();
    expect(hard()).toBeEnabled();
    expect(restartD215Screen).toHaveBeenCalledTimes(1);
  });

  it.each([
    [], [record(), record('another-d215')],
    [{ ...record(), capabilities: { family: 'other', surface: 'lcd-wide' as const } }],
    [{ ...record(), capabilities: { family: FAMILY, surface: 'monitor' as const } }],
  ].map(devices => ({ devices })))('refuses missing, ambiguous or incompatible records ($devices)', async ({ devices }) => {
    vi.mocked(fetchPanelDevices).mockResolvedValue({ devices });
    open(); fireEvent.click(hard());
    expect(await screen.findByText(`${COPY}.restart.unavailable`)).toBeInTheDocument();
    expect(restartD215Screen).not.toHaveBeenCalled();
  });

  it('handles lookup failure separately from an uncertain restart reply', async () => {
    vi.mocked(fetchPanelDevices).mockRejectedValueOnce(new Error('offline'));
    vi.mocked(restartD215Screen).mockRejectedValueOnce(new Error('lost reply'));
    open(); fireEvent.click(hard());
    expect(await screen.findByText(`${COPY}.restart.unavailable`)).toBeInTheDocument();
    fireEvent.click(hard());
    expect(await screen.findByText(`${COPY}.restart.uncertain`)).toBeInTheDocument();
    expect(restartD215Screen).toHaveBeenCalledTimes(1);
  });

  it('releases both actions after a hung control request and ignores its late reply', async () => {
    vi.useFakeTimers();
    const pending = deferred<boolean>();
    controlDevice.mockReturnValue(pending.promise);
    open(); fireEvent.click(soft());
    await act(async () => vi.advanceTimersByTimeAsync(10_000));
    expect(screen.getByText(`${COPY}.recovery.controlFailed`)).toBeInTheDocument();
    expect(soft()).toBeEnabled(); expect(hard()).toBeEnabled();
    await act(async () => pending.resolve(true));
    expect(screen.getByText(`${COPY}.recovery.controlFailed`)).toBeInTheDocument();
    expect(controlDevice).toHaveBeenCalledTimes(1);
  });

  it('times out a hung record lookup without sending a restart when the lookup eventually finishes', async () => {
    vi.useFakeTimers();
    const pending = deferred<{ devices: PanelDeviceRecord[] }>();
    vi.mocked(fetchPanelDevices).mockReturnValue(pending.promise);
    open(); fireEvent.click(hard());
    await act(async () => vi.advanceTimersByTimeAsync(10_000));
    expect(screen.getByText(`${COPY}.restart.unavailable`)).toBeInTheDocument();
    expect(soft()).toBeEnabled(); expect(hard()).toBeEnabled();
    await act(async () => pending.resolve({ devices: [record()] }));
    expect(restartD215Screen).not.toHaveBeenCalled();
  });

  it('rejects malformed saved records without leaving the buttons pending', async () => {
    vi.mocked(fetchPanelDevices).mockResolvedValue({ devices: [null, { id: '' }] } as unknown as { devices: PanelDeviceRecord[] });
    open(); fireEvent.click(hard());
    expect(await screen.findByText(`${COPY}.restart.unavailable`)).toBeInTheDocument();
    expect(hard()).toBeEnabled(); expect(restartD215Screen).not.toHaveBeenCalled();
  });

  it('selects the compatible portrait record alongside unrelated saved displays', async () => {
    vi.mocked(fetchPanelDevices).mockResolvedValue({ devices: [
      { ...record('unrelated'), capabilities: { family: 'other', surface: 'monitor' } },
      { ...record(), capabilities: { family: FAMILY, surface: 'lcd-portrait' } },
    ] });
    open(); fireEvent.click(hard());
    expect(await screen.findByText(`${COPY}.restart.restarted`)).toBeInTheDocument();
    expect(restartD215Screen).toHaveBeenCalledExactlyOnceWith('saved-d215', expect.any(AbortSignal));
  });

  it('does not send a hard restart if navigation occurs during record lookup', async () => {
    const pending = deferred<{ devices: PanelDeviceRecord[] }>();
    vi.mocked(fetchPanelDevices).mockReturnValue(pending.promise);
    const view = open(); fireEvent.click(hard());
    view.unmount();
    await act(async () => pending.resolve({ devices: [record()] }));
    expect(restartD215Screen).not.toHaveBeenCalled();
  });

  it('aborts the old restart and ignores its late reply after reopening', async () => {
    const pending = deferred<D215RestartResult>();
    vi.mocked(restartD215Screen).mockReturnValue(pending.promise);
    const view = open(); fireEvent.click(hard());
    await act(async () => {});
    const signal = vi.mocked(restartD215Screen).mock.calls[0][1]!;
    view.unmount();
    expect(signal.aborted).toBe(true);
    open();
    await act(async () => pending.resolve({ status: 'restarted' }));
    expect(screen.queryByText(`${COPY}.restart.restarted`)).toBeNull();
    expect(hard()).toBeEnabled();
  });

  it('ignores a late control reply when navigating away', async () => {
    const pending = deferred<boolean>();
    controlDevice.mockReturnValue(pending.promise);
    const view = open(); fireEvent.click(soft());
    rows = [row({ key: 'curated-other', curatedId: 'other' })];
    view.rerender(<DevicePage deviceKey={rows[0].key} serviceOnline />);
    await act(async () => pending.resolve(true));
    expect(screen.queryByText(`${COPY}.recovery.controlRequested`)).toBeNull();
  });

  it.each([
    { curatedId: 'other', key: 'curated-other' },
    { nexusControlEnabled: false }, { connected: false },
  ])('leaves other devices and disabled/disconnected gates unchanged (%j)', overrides => {
    rows = [row(overrides)]; open();
    expect(screen.queryByRole('button', { name: `${COPY}.recovery.control` })).toBeNull();
    expect(screen.queryByRole('button', { name: `${COPY}.restart.label` })).toBeNull();
  });
});
