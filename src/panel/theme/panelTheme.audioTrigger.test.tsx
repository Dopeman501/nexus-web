import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { buildPanelTheme, usePanelTheme } from './panelTheme';
import { INERT_PANEL_RECORD } from '../engine/usePanelRecord';
import { normalizeAudioTrigger } from '../background/audioTrigger';

const patch = vi.hoisted(() => vi.fn(async () => null));
vi.mock('../../api/panel', () => ({ patchPanelDevice: patch }));
vi.mock('../../api/profiles', () => ({ fetchPreferences: vi.fn(async () => null) }));
vi.mock('../../hooks/useAnimateTemplates', () => ({ useAnimateTemplates: () => ({ templates: {} }) }));
vi.mock('../../hooks/useMultiplexSocket', async original => ({ ...await original<typeof import('../../hooks/useMultiplexSocket')>(), useTopicCallback: () => {} }));
vi.mock('../engine/panelSync', () => ({ broadcastLayoutChanged: vi.fn() }));

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
});
