import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildPanelTheme, usePanelTheme } from './panelTheme';
import { INERT_PANEL_RECORD } from '../engine/usePanelRecord';
import type { PanelDevicePatch, PanelDeviceRecord } from '../../api/panel';
import { resolveAudioTriggerBeatTransition } from '../background/transitions/settings';

const patch = vi.hoisted(() => vi.fn<(id: string, value: PanelDevicePatch) => Promise<PanelDeviceRecord | null>>());
vi.mock('../../api/panel', () => ({ patchPanelDevice: patch }));
vi.mock('../../api/profiles', () => ({ fetchPreferences: vi.fn(async () => null) }));
vi.mock('../../hooks/useAnimateTemplates', () => ({ useAnimateTemplates: () => ({ templates: {} }) }));
vi.mock('../../hooks/useMultiplexSocket', async original => ({ ...await original<typeof import('../../hooks/useMultiplexSocket')>(), useTopicCallback: () => {} }));
vi.mock('../engine/panelSync', () => ({ broadcastLayoutChanged: vi.fn() }));

const record = (id = 'one'): PanelDeviceRecord => ({ id, displayName: '', firstSeenAt: 0, lastSeenAt: 0 });
beforeEach(() => { patch.mockReset().mockImplementation(async id => record(id)); });

describe('independent Audio Trigger beat transition preference', () => {
  const main = { enabled: true, effects: ['curtains:wave'], durationMs: 1200 };

  it('inherits a legacy main preference in memory without writing on hydration', () => {
    const initial = { ...record(), backgroundTransitions: main };
    const theme = buildPanelTheme(null, initial);
    expect(theme.backgroundAudioTriggerBeatTransition).toEqual({ enabled: true, durationMs: 1200 });
    expect(resolveAudioTriggerBeatTransition(theme)).toEqual({ enabled: true, durationMs: 1200 });
    expect(patch).not.toHaveBeenCalled();
  });

  it('retains the original beat policy when main settings change and older main echoes arrive', async () => {
    let finish!: () => void;
    patch.mockImplementationOnce(() => new Promise(resolve => { finish = () => resolve(record()); }));
    const initial = { ...record(), backgroundTransitions: main };
    const hook = renderHook(({ value }) => usePanelTheme({ ...INERT_PANEL_RECORD, record: value }, 'one', false), { initialProps: { value: initial } });
    const next = { ...main, enabled: false, durationMs: 5000 };
    act(() => hook.result.current.commitBackgroundTransitions(next));
    expect(hook.result.current.theme.backgroundAudioTriggerBeatTransition).toEqual({ enabled: true, durationMs: 1200 });
    hook.rerender({ value: { ...initial, backgroundTransitions: { ...main, durationMs: 80 } } });
    expect(hook.result.current.theme.backgroundTransitions).toEqual(next);
    expect(hook.result.current.theme.backgroundAudioTriggerBeatTransition).toEqual({ enabled: true, durationMs: 1200 });
    await act(async () => finish());
    expect(patch.mock.calls).toEqual([['one', { backgroundTransitions: next }]]);
    hook.unmount();
  });

  it('writes only beat timing/enabled and preserves detector identity and the shared picker', async () => {
    const initial = { ...record(), backgroundTransitions: main };
    const hook = renderHook(() => usePanelTheme({ ...INERT_PANEL_RECORD, record: initial }, 'one', false));
    const before = hook.result.current.theme;
    const next = { enabled: false, durationMs: 200 };
    act(() => hook.result.current.commitBackgroundAudioTriggerBeatTransition(next));
    await act(async () => {});
    expect(patch.mock.calls).toEqual([['one', { backgroundAudioTriggerBeatTransition: next }]]);
    expect(hook.result.current.theme.backgroundAudioTrigger).toBe(before.backgroundAudioTrigger);
    expect(hook.result.current.theme.backgroundTransitions).toBe(before.backgroundTransitions);
    expect(hook.result.current.theme.backgroundAudioTriggerBeatTransition).toEqual(next);
    hook.unmount();
  });

  it('accepts an explicit saved beat policy while a legacy main save is still pending', async () => {
    let finish!: () => void;
    patch.mockImplementationOnce(() => new Promise(resolve => { finish = () => resolve(record()); }));
    const initial: PanelDeviceRecord = { ...record(), backgroundTransitions: main };
    const hook = renderHook(({ value }) => usePanelTheme({ ...INERT_PANEL_RECORD, record: value }, 'one', false), { initialProps: { value: initial } });
    act(() => hook.result.current.commitBackgroundTransitions({ ...main, enabled: false }));
    hook.rerender({ value: { ...initial, backgroundAudioTriggerBeatTransition: { enabled: false, durationMs: 80 } } });
    expect(hook.result.current.theme.backgroundAudioTriggerBeatTransition).toEqual({ enabled: false, durationMs: 80 });
    await act(async () => finish()); hook.unmount();
  });

  it('coalesces beat edits through old echoes and drains to the original device after navigation', async () => {
    let finish!: () => void;
    patch.mockImplementationOnce(() => new Promise(resolve => { finish = () => resolve(record()); }));
    const initial: PanelDeviceRecord = { ...record(), backgroundTransitions: main };
    const hook = renderHook(({ value }) => usePanelTheme({ ...INERT_PANEL_RECORD, record: value }, value.id, false), { initialProps: { value: initial } });
    const first = { enabled: false, durationMs: 80 };
    const latest = { enabled: true, durationMs: 5000 };
    act(() => {
      hook.result.current.commitBackgroundAudioTriggerBeatTransition(first);
      hook.result.current.commitBackgroundAudioTriggerBeatTransition({ enabled: true, durationMs: 100 });
      hook.result.current.commitBackgroundAudioTriggerBeatTransition(latest);
    });
    hook.rerender({ value: { ...initial, backgroundMediaId: 'other' } });
    expect(hook.result.current.theme.backgroundAudioTriggerBeatTransition).toEqual(latest);
    expect(hook.result.current.theme.backgroundMediaId).toBe('other');
    hook.rerender({ value: record('two') }); hook.unmount();
    await act(async () => finish());
    expect(patch.mock.calls).toEqual([['one', { backgroundAudioTriggerBeatTransition: first }], ['one', { backgroundAudioTriggerBeatTransition: latest }]]);
  });

  it('seeds a retained shared effect for enabled beat swaps without turning main transitions on', async () => {
    const initial = { ...record(), backgroundTransitions: { enabled: false, effects: [], durationMs: 1200 } };
    const hook = renderHook(() => usePanelTheme({ ...INERT_PANEL_RECORD, record: initial }, 'one', false));
    act(() => hook.result.current.commitBackgroundAudioTriggerBeatTransition({ enabled: true, durationMs: 200 }));
    await act(async () => {});
    expect(hook.result.current.theme.backgroundTransitions).toEqual({ enabled: false, effects: ['gl-transitions:WaterDrop'], durationMs: 1200 });
    expect(hook.result.current.theme.backgroundAudioTriggerBeatTransition).toEqual({ enabled: true, durationMs: 200 });
    expect(patch.mock.calls.map(call => call[1])).toEqual(expect.arrayContaining([
      { backgroundTransitions: { enabled: false, effects: ['gl-transitions:WaterDrop'], durationMs: 1200 } },
      { backgroundAudioTriggerBeatTransition: { enabled: true, durationMs: 200 } },
    ]));
    hook.unmount();
  });

  it('normalizes beat edits and keeps simulator settings local', () => {
    const hook = renderHook(() => usePanelTheme(INERT_PANEL_RECORD, 'one', false, false));
    act(() => hook.result.current.commitBackgroundAudioTriggerBeatTransition({ enabled: true, durationMs: -1 }));
    expect(hook.result.current.theme.backgroundAudioTriggerBeatTransition).toEqual({ enabled: true, durationMs: 800 });
    expect(patch).not.toHaveBeenCalled(); hook.unmount();
  });
});

describe('one shared transition preference', () => {
  it('hydrates the ordered legacy union but writes only the shared field after an edit', async () => {
    const initial = { ...record(), backgroundMediaTransition: { effect: 'curtains:wave', durationMs: 900 },
      backgroundAudioTriggerTransition: { effect: 'gl-transitions:WaterDrop', durationMs: 5000 } };
    const hook = renderHook(() => usePanelTheme({ ...INERT_PANEL_RECORD, record: initial }, 'one', false));
    expect(hook.result.current.theme.backgroundTransitions).toEqual({ enabled: true, effects: ['curtains:wave', 'gl-transitions:WaterDrop'], durationMs: 900 });
    expect(patch).not.toHaveBeenCalled();
    const before = hook.result.current.theme;
    const settings = { enabled: false, effects: ['curtains:wave'], durationMs: 1500 };
    act(() => hook.result.current.commitBackgroundTransitions(settings)); await act(async () => {});
    expect(patch.mock.calls).toEqual([['one', { backgroundTransitions: settings }]]);
    expect(hook.result.current.theme.backgroundAudioTrigger).toBe(before.backgroundAudioTrigger);
    expect(hook.result.current.theme.backgroundMediaId).toBe(before.backgroundMediaId);
    expect(hook.result.current.theme.backgroundTransitions?.effects).not.toBe(settings.effects);
    hook.unmount();
  });
  it('keeps the latest shared selection through old echoes and drains it to the original device', async () => {
    let finish!: () => void; patch.mockImplementationOnce(() => new Promise(resolve => { finish = () => resolve(record()); }));
    const initial = record();
    const hook = renderHook(({ value }) => usePanelTheme({ ...INERT_PANEL_RECORD, record: value }, value.id, false), { initialProps: { value: initial } });
    const first = { enabled: true, effects: ['curtains:wave'], durationMs: 800 };
    const latest = { enabled: true, effects: ['curtains:wave', 'gl-transitions:WaterDrop'], durationMs: 1500 };
    act(() => { hook.result.current.commitBackgroundTransitions(first); hook.result.current.commitBackgroundTransitions(latest); });
    hook.rerender({ value: { ...initial, backgroundMediaId: 'normal-media' } });
    expect(hook.result.current.theme.backgroundTransitions).toEqual(latest);
    hook.rerender({ value: record('two') }); hook.unmount(); await act(async () => finish());
    expect(patch.mock.calls).toEqual([['one', { backgroundTransitions: first }], ['one', { backgroundTransitions: latest }]]);
  });
  it('keeps shared edits local for simulator-only themes', () => {
    const hook = renderHook(() => usePanelTheme(INERT_PANEL_RECORD, 'one', false, false));
    act(() => hook.result.current.commitBackgroundTransitions({ enabled: true, effects: ['curtains:wave'], durationMs: 80 }));
    expect(patch).not.toHaveBeenCalled(); expect(hook.result.current.theme.backgroundTransitions?.enabled).toBe(true); hook.unmount();
  });
});

describe('independent per-panel transition settings', () => {
  it('hydrates legacy defaults and validates each setting independently', () => {
    expect(buildPanelTheme(null, null)).toMatchObject({
      backgroundMediaTransition: { effect: 'default', durationMs: 800 },
      backgroundAudioTriggerTransition: { effect: 'default', durationMs: 800 },
    });
    expect(buildPanelTheme(null, { ...record(),
      backgroundMediaTransition: { effect: 'gl-transitions:WaterDrop', durationMs: 1500 },
      backgroundAudioTriggerTransition: { effect: 'anime:fade', durationMs: -3 },
    })).toMatchObject({
      backgroundMediaTransition: { effect: 'gl-transitions:WaterDrop', durationMs: 1500 },
      backgroundAudioTriggerTransition: { effect: 'default', durationMs: 800 },
    });
  });

  it('commits only the selected root field and preserves audio identity, normal media and slideshow settings', async () => {
    const hook = renderHook(() => usePanelTheme(INERT_PANEL_RECORD, 'one', false));
    const before = hook.result.current.theme;
    const media = { effect: 'curtains:wave', durationMs: 1200 };
    const audio = { effect: 'none', durationMs: 80 };
    act(() => hook.result.current.commitBackgroundMediaTransition(media));
    expect(hook.result.current.theme.backgroundAudioTrigger).toBe(before.backgroundAudioTrigger);
    act(() => hook.result.current.commitBackgroundAudioTriggerTransition(audio));
    await act(async () => {});
    expect(patch.mock.calls).toEqual([
      ['one', { backgroundMediaTransition: media }], ['one', { backgroundAudioTriggerTransition: audio }],
    ]);
    expect(hook.result.current.theme).toMatchObject({ backgroundMediaTransition: media, backgroundAudioTriggerTransition: audio,
      backgroundMediaId: before.backgroundMediaId, backgroundSlideshow: before.backgroundSlideshow });
    hook.unmount();
  });

  it('keeps simulator and unbound changes local', () => {
    const simulator = renderHook(() => usePanelTheme(INERT_PANEL_RECORD, 'one', false, false));
    const unbound = renderHook(() => usePanelTheme(INERT_PANEL_RECORD, null, false));
    act(() => {
      simulator.result.current.commitBackgroundMediaTransition({ effect: 'none', durationMs: 100 });
      unbound.result.current.commitBackgroundAudioTriggerTransition({ effect: 'curtains:wave', durationMs: 5000 });
    });
    expect(patch).not.toHaveBeenCalled();
    expect(simulator.result.current.theme.backgroundMediaTransition).toEqual({ effect: 'none', durationMs: 100 });
    simulator.unmount(); unbound.unmount();
  });

  it('normalizes invalid commits and drains the latest edit after a failed request', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    patch.mockRejectedValueOnce(new Error('unavailable')).mockResolvedValueOnce(null);
    const hook = renderHook(() => usePanelTheme(INERT_PANEL_RECORD, 'one', false));
    act(() => {
      hook.result.current.commitBackgroundAudioTriggerTransition({ effect: 'motion:fade', durationMs: NaN });
      hook.result.current.commitBackgroundAudioTriggerTransition({ effect: 'curtains:wave', durationMs: 5000 });
    });
    await act(async () => {});
    expect(patch.mock.calls).toEqual([
      ['one', { backgroundAudioTriggerTransition: { effect: 'default', durationMs: 800 } }],
      ['one', { backgroundAudioTriggerTransition: { effect: 'curtains:wave', durationMs: 5000 } }],
    ]);
    expect(warning).toHaveBeenCalledTimes(1);
    act(() => hook.result.current.commitBackgroundAudioTriggerTransition({ effect: 'none', durationMs: 800 }));
    await act(async () => {});
    patch.mockResolvedValueOnce(null);
    act(() => hook.result.current.commitBackgroundAudioTriggerTransition({ effect: 'none', durationMs: 1000 }));
    await act(async () => {});
    expect(warning).toHaveBeenCalledTimes(2);
    warning.mockRestore(); hook.unmount();
  });

  it('keeps simultaneous pending audio and slideshow edits through older record echoes', async () => {
    const finish: (() => void)[] = [];
    patch.mockImplementation(() => new Promise(resolve => { finish.push(() => resolve(record())); }));
    const initial = record();
    const hook = renderHook(({ value }) => usePanelTheme({ ...INERT_PANEL_RECORD, record: value }, value.id, false), {
      initialProps: { value: initial },
    });
    const media = { effect: 'curtains:wave', durationMs: 1500 };
    const audio = { effect: 'gl-transitions:WaterDrop', durationMs: 1000 };
    act(() => {
      hook.result.current.commitBackgroundMediaTransition(media);
      hook.result.current.commitBackgroundAudioTriggerTransition(audio);
    });
    hook.rerender({ value: { ...initial, backgroundMediaId: 'still-one' } });
    expect(hook.result.current.theme).toMatchObject({ backgroundMediaTransition: media,
      backgroundAudioTriggerTransition: audio, backgroundMediaId: 'still-one' });
    expect(patch).toHaveBeenCalledTimes(2);
    await act(async () => { finish.forEach(done => done()); });
    hook.unmount();
  });

  it('coalesces rapid edits in each field, preserves them through old echoes, and drains to the original device', async () => {
    let finish!: () => void;
    patch.mockImplementationOnce(() => new Promise(resolve => { finish = () => resolve(record()); }));
    const first = { effect: 'curtains:wave', durationMs: 800 };
    const latest = { effect: 'gl-transitions:WaterDrop', durationMs: 1400 };
    const initial: PanelDeviceRecord = { ...record(), backgroundMediaTransition: { effect: 'default', durationMs: 800 } };
    const hook = renderHook(({ value }) => usePanelTheme({ ...INERT_PANEL_RECORD, record: value }, value.id, false), {
      initialProps: { value: initial },
    });
    act(() => {
      hook.result.current.commitBackgroundMediaTransition(first);
      hook.result.current.commitBackgroundMediaTransition({ effect: 'none', durationMs: 900 });
      hook.result.current.commitBackgroundMediaTransition(latest);
    });
    hook.rerender({ value: { ...initial, backgroundMediaId: 'normal-media' } });
    expect(hook.result.current.theme.backgroundMediaTransition).toEqual(latest);
    expect(hook.result.current.theme.backgroundMediaId).toBe('normal-media');
    hook.rerender({ value: { ...initial, id: 'two' } });
    expect(hook.result.current.theme.backgroundMediaTransition).toEqual(initial.backgroundMediaTransition);
    hook.unmount();
    await act(async () => finish());
    expect(patch.mock.calls).toEqual([
      ['one', { backgroundMediaTransition: first }], ['one', { backgroundMediaTransition: latest }],
    ]);
  });
});
