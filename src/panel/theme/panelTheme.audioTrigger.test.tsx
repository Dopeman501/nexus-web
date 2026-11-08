import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildPanelTheme, usePanelTheme } from './panelTheme';
import { INERT_PANEL_RECORD } from '../engine/usePanelRecord';
import { normalizeAudioTrigger } from '../background/audioTrigger';
import type { PanelDevicePatch, PanelDeviceRecord } from '../../api/panel';

const patch = vi.hoisted(() => vi.fn<(id: string, value: PanelDevicePatch) => Promise<PanelDeviceRecord | null>>());
const broadcast = vi.hoisted(() => vi.fn());
vi.mock('../../api/panel', () => ({ patchPanelDevice: patch }));
vi.mock('../../api/profiles', () => ({ fetchPreferences: vi.fn(async () => null) }));
vi.mock('../../hooks/useAnimateTemplates', () => ({ useAnimateTemplates: () => ({ templates: {} }) }));
vi.mock('../../hooks/useMultiplexSocket', async original => ({ ...await original<typeof import('../../hooks/useMultiplexSocket')>(), useTopicCallback: () => {} }));
vi.mock('../engine/panelSync', () => ({ broadcastLayoutChanged: broadcast }));

const savedRecord = (id = 'one'): PanelDeviceRecord => ({ id, displayName: '', firstSeenAt: 0, lastSeenAt: 0 });
beforeEach(() => { patch.mockReset().mockImplementation(async id => savedRecord(id)); broadcast.mockClear(); });

describe('Audio Trigger per-panel theme persistence', () => {
  it('reads optional settings independently of the normal background and defaults off', () => {
    expect(buildPanelTheme(null, null).backgroundAudioTrigger?.enabled).toBe(false);
    const bg = normalizeAudioTrigger({ enabled: true, backgrounds: [{ mode: 'solid', color: '#ff0000' }] });
    const theme = buildPanelTheme(null, { id: 'one', displayName: '', firstSeenAt: 0, lastSeenAt: 0,
      backgroundMode: 'media', backgroundMediaId: 'normal', backgroundAudioTrigger: bg });
    expect(theme.backgroundAudioTrigger).toEqual(bg);
    expect(theme.backgroundMediaId).toBe('normal');
    expect(theme.backgroundMode).toBe('media');
  });
  it('persists one complete validated group only to its panel and leaves normal settings alone', () => {
    const hook = renderHook(() => usePanelTheme(INERT_PANEL_RECORD, 'one', false));
    const normal = hook.result.current.theme.backgroundMode;
    const settings = normalizeAudioTrigger({ enabled: true, switchDelay: 0.5, backgrounds: [{ mode: 'shader', effect: 'plasma' }] });
    act(() => hook.result.current.commitBackgroundAudioTrigger(settings));
    expect(patch).toHaveBeenLastCalledWith('one', { backgroundAudioTrigger: settings });
    expect(hook.result.current.theme.backgroundAudioTrigger).toEqual(settings);
    expect(hook.result.current.theme.backgroundMode).toBe(normal);
    hook.unmount();
  });

  it('serializes completed edits and keeps only the latest pending settings, including the enable switch', async () => {
    let finishFirst!: () => void;
    let stored: unknown;
    patch.mockImplementationOnce((_id, value) => new Promise(resolve => {
      finishFirst = () => { stored = value; resolve(savedRecord(_id)); };
    })).mockImplementation(async (id, value) => { stored = value; return savedRecord(id); });
    const hook = renderHook(() => usePanelTheme(INERT_PANEL_RECORD, 'one', false));
    const first = normalizeAudioTrigger({ enabled: true, backgrounds: [{ mode: 'solid', color: '#ff0000' }] });
    const middle = normalizeAudioTrigger({ enabled: true, backgrounds: [{ mode: 'solid', color: '#00ff00' }] });
    const last = normalizeAudioTrigger({ enabled: false, backgrounds: [{ mode: 'solid', color: '#0000ff' }] });
    act(() => {
      hook.result.current.commitBackgroundAudioTrigger(first);
      hook.result.current.commitBackgroundAudioTrigger(middle);
      hook.result.current.commitBackgroundAudioTrigger(last);
    });
    expect(patch).toHaveBeenCalledTimes(1);
    expect(hook.result.current.theme.backgroundAudioTrigger).toEqual(last);
    await act(async () => finishFirst());
    expect(patch).toHaveBeenCalledTimes(2);
    expect(patch).toHaveBeenLastCalledWith('one', { backgroundAudioTrigger: last });
    expect(stored).toEqual({ backgroundAudioTrigger: last });
    hook.unmount();
  });

  it('drains completed edits to the original device after switching device or unmounting', async () => {
    let finishFirst!: () => void;
    patch.mockImplementationOnce(() => new Promise(resolve => { finishFirst = () => resolve(savedRecord()); }));
    const first = normalizeAudioTrigger({ backgrounds: [{ mode: 'solid', color: '#ff0000' }] });
    const last = normalizeAudioTrigger({ backgrounds: [{ mode: 'solid', color: '#00ff00' }] });
    const other = normalizeAudioTrigger({ backgrounds: [{ mode: 'solid', color: '#0000ff' }] });
    const hook = renderHook(({ id }) => usePanelTheme(INERT_PANEL_RECORD, id, false), { initialProps: { id: 'one' } });
    act(() => {
      hook.result.current.commitBackgroundAudioTrigger(first);
      hook.result.current.commitBackgroundAudioTrigger(last);
    });
    hook.rerender({ id: 'two' });
    act(() => hook.result.current.commitBackgroundAudioTrigger(other));
    hook.unmount();
    await act(async () => finishFirst());
    expect(patch.mock.calls).toEqual([
      ['one', { backgroundAudioTrigger: first }], ['two', { backgroundAudioTrigger: other }], ['one', { backgroundAudioTrigger: last }],
    ]);
  });

  it('keeps simulated and unbound settings local', () => {
    const settings = normalizeAudioTrigger({ enabled: true });
    const simulated = renderHook(() => usePanelTheme(INERT_PANEL_RECORD, 'one', false, false));
    const unbound = renderHook(() => usePanelTheme(INERT_PANEL_RECORD, null, false));
    act(() => {
      simulated.result.current.commitBackgroundAudioTrigger(settings);
      unbound.result.current.commitBackgroundAudioTrigger(settings);
    });
    expect(patch).not.toHaveBeenCalled();
    expect(simulated.result.current.theme.backgroundAudioTrigger).toEqual(settings);
    simulated.unmount();
    unbound.unmount();
  });

  it('continues with the latest completed edit after an earlier request fails', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    patch.mockRejectedValueOnce(new Error('unavailable'));
    const hook = renderHook(() => usePanelTheme(INERT_PANEL_RECORD, 'one', false));
    const first = normalizeAudioTrigger({ enabled: true });
    const last = normalizeAudioTrigger({ enabled: false });
    act(() => {
      hook.result.current.commitBackgroundAudioTrigger(first);
      hook.result.current.commitBackgroundAudioTrigger(last);
    });
    await act(async () => {});
    expect(patch).toHaveBeenCalledTimes(2);
    expect(patch).toHaveBeenLastCalledWith('one', { backgroundAudioTrigger: last });
    expect(warning).toHaveBeenCalledWith('[panel-theme] Audio Trigger settings save failed');
    warning.mockRestore();
    hook.unmount();
  });

  it('retains the latest selected snapshot through older record echoes while applying unrelated fields', async () => {
    let finishFirst!: () => void;
    let finishLast!: () => void;
    patch.mockImplementationOnce(() => new Promise(resolve => { finishFirst = () => resolve(savedRecord()); }))
      .mockImplementationOnce(() => new Promise(resolve => { finishLast = () => resolve(savedRecord()); }));
    const first = normalizeAudioTrigger({ enabled: true, backgrounds: [{ mode: 'solid', color: '#ff0000' }] });
    const last = normalizeAudioTrigger({ enabled: true, backgrounds: [{ mode: 'solid', color: '#00ff00' }] });
    const remote = normalizeAudioTrigger({ enabled: false, backgrounds: [{ mode: 'solid', color: '#0000ff' }] });
    const initial: PanelDeviceRecord = { id: 'one', displayName: '', firstSeenAt: 0, lastSeenAt: 0, backgroundAudioTrigger: first };
    const hook = renderHook(({ record }) => usePanelTheme({ ...INERT_PANEL_RECORD, record }, record.id, false), {
      initialProps: { record: initial },
    });
    act(() => {
      hook.result.current.commitBackgroundAudioTrigger(first);
      hook.result.current.commitBackgroundAudioTrigger(last);
    });
    hook.rerender({ record: { ...initial, backgroundMode: 'media', backgroundMediaId: 'normal-one' } });
    expect(hook.result.current.theme.backgroundAudioTrigger).toEqual(last);
    expect(hook.result.current.theme.backgroundMode).toBe('media');
    expect(hook.result.current.theme.backgroundMediaId).toBe('normal-one');
    await act(async () => finishFirst());
    hook.rerender({ record: { ...initial, backgroundMode: 'solid', backgroundColor: '#ffffff' } });
    expect(hook.result.current.theme.backgroundAudioTrigger).toEqual(last);
    expect(hook.result.current.theme.backgroundColor).toBe('#ffffff');
    await act(async () => finishLast());
    hook.rerender({ record: { ...initial, backgroundAudioTrigger: remote } });
    expect(hook.result.current.theme.backgroundAudioTrigger).toEqual(remote);
    hook.unmount();
  });

  it('does not carry the old device hydration guard into another device', async () => {
    let finish!: () => void;
    patch.mockImplementationOnce(() => new Promise(resolve => { finish = () => resolve(savedRecord()); }));
    const first = normalizeAudioTrigger({ enabled: true });
    const other = normalizeAudioTrigger({ intensity: 75, backgrounds: [{ mode: 'solid', color: '#0000ff' }] });
    const initial: PanelDeviceRecord = { id: 'one', displayName: '', firstSeenAt: 0, lastSeenAt: 0, backgroundAudioTrigger: first };
    const hook = renderHook(({ record }) => usePanelTheme({ ...INERT_PANEL_RECORD, record }, record.id, false), {
      initialProps: { record: initial },
    });
    act(() => hook.result.current.commitBackgroundAudioTrigger(first));
    hook.rerender({ record: { ...initial, id: 'two', backgroundAudioTrigger: other } });
    expect(hook.result.current.theme.backgroundAudioTrigger).toEqual(other);
    await act(async () => finish());
    expect(hook.result.current.theme.backgroundAudioTrigger).toEqual(other);
    hook.unmount();
  });

  it('treats null responses as failures, drains pending edits and coalesces diagnostics until recovery', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    patch.mockResolvedValueOnce(null).mockResolvedValueOnce(null)
      .mockResolvedValueOnce(savedRecord()).mockResolvedValueOnce(null);
    const hook = renderHook(() => usePanelTheme(INERT_PANEL_RECORD, 'one', false));
    act(() => {
      hook.result.current.commitBackgroundAudioTrigger(normalizeAudioTrigger({ intensity: 20 }));
      hook.result.current.commitBackgroundAudioTrigger(normalizeAudioTrigger({ intensity: 30 }));
    });
    await act(async () => {});
    expect(patch).toHaveBeenCalledTimes(2);
    expect(warning).toHaveBeenCalledTimes(1);
    expect(broadcast).not.toHaveBeenCalled();
    act(() => hook.result.current.commitBackgroundAudioTrigger(normalizeAudioTrigger({ intensity: 40 })));
    await act(async () => {});
    expect(broadcast).toHaveBeenCalledTimes(1);
    act(() => hook.result.current.commitBackgroundAudioTrigger(normalizeAudioTrigger({ intensity: 50 })));
    await act(async () => {});
    expect(warning).toHaveBeenCalledTimes(2);
    expect(broadcast).toHaveBeenCalledTimes(1);
    warning.mockRestore();
    hook.unmount();
  });
});
