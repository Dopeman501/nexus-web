import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { defaultStateFor } from '../../../../types/lighting';
import { usePanelBackgroundEffectController } from './usePanelBackgroundEffectController';

const global = vi.hoisted(() => ({ subscribe: vi.fn() }));
vi.mock('../../../../hooks/useAnimateTemplates', () => ({ useAnimateTemplates: (enabled: boolean) => {
  global.subscribe(enabled);
  return { templates: { plasma: { selected: 1, slots: [{ speed: 99 }, { speed: 98 }, { speed: 97 }, { speed: 96 }] } }, rgbActiveEffect: 'plasma' };
} }));

vi.mock('../../../../api/lighting', async importOriginal => ({
  ...(await importOriginal<typeof import('../../../../api/lighting')>()),
  cachedAnimateDefaults: () => ({ plasma: { selected: 0, slots: Array.from({ length: 4 }, () => defaultStateFor('plasma')) } }),
}));

describe('independent circle animation controls', () => {
  it('commits rotation/zoom without losing other controls and resets to the shipped preset', () => {
    const state = { ...defaultStateFor('plasma'), params: { u_zoom: 2, u_background_rotation: 90, u_background_zoom: 1.25 } };
    const onCommit = vi.fn();
    const { result } = renderHook(() => usePanelBackgroundEffectController({ effect: 'plasma', template: 0,
      templatesByEffect: {}, effectState: state, independent: true,
      onSelectEffect: vi.fn(), onTemplateSelect: vi.fn(), onPreview: vi.fn(), onCommit }));
    expect(result.current.canReset).toBe(true);
    act(() => {
      result.current.onChange({ params: { u_background_rotation: 180 } });
      result.current.onChange({ params: { u_background_zoom: 2.5 } }, true);
    });
    expect(onCommit).toHaveBeenLastCalledWith(expect.objectContaining({ params: { u_zoom: 2, u_background_rotation: 180, u_background_zoom: 2.5 } }));
    expect(state.params.u_background_rotation).toBe(90);
    expect(state.params.u_background_zoom).toBe(1.25);
    act(() => result.current.onReset());
    expect(onCommit).toHaveBeenLastCalledWith(defaultStateFor('plasma'));
    expect(onCommit.mock.lastCall![0].params.u_background_rotation).toBeUndefined();
    expect(onCommit.mock.lastCall![0].params.u_background_zoom).toBeUndefined();
  });

  it('uses local animation state/default slots and commits locally without global subscriptions or RGB badges', () => {
    const onPreview = vi.fn();
    const onCommit = vi.fn();
    const state = { ...defaultStateFor('plasma'), speed: 27, params: { u_zoom: 2 } };
    const { result } = renderHook(() => usePanelBackgroundEffectController({ effect: 'plasma', template: 1,
      templatesByEffect: { plasma: 1 }, effectState: state, independent: true,
      onSelectEffect: vi.fn(), onTemplateSelect: vi.fn(), onPreview, onCommit }));
    expect(global.subscribe).toHaveBeenLastCalledWith(false);
    expect(result.current.bundle.slots[1]).toBe(state);
    expect(result.current.bundle.slots[0].speed).not.toBe(99);
    expect(result.current.rgbActiveEffect).toBe('');
    expect(result.current.rgbActiveSlot).toBeNull();
    act(() => { result.current.onChange({ speed: 35 }); result.current.onCommit(); });
    expect(onPreview).toHaveBeenLastCalledWith(expect.objectContaining({ speed: 35, params: { u_zoom: 2 } }));
    expect(onCommit).toHaveBeenLastCalledWith(expect.objectContaining({ speed: 35, params: { u_zoom: 2 } }));
    expect(state.speed).toBe(27);
  });

  it('retains the shared animation path for ordinary display backgrounds', () => {
    const { result } = renderHook(() => usePanelBackgroundEffectController({ effect: 'plasma', template: 1,
      templatesByEffect: {}, effectState: defaultStateFor('plasma'), onSelectEffect: vi.fn(), onTemplateSelect: vi.fn(),
      onPreview: vi.fn(), onCommit: vi.fn() }));
    expect(global.subscribe).toHaveBeenLastCalledWith(true);
    expect(result.current.bundle.slots[1].speed).toBe(98);
    expect(result.current.rgbActiveEffect).toBe('plasma');
    expect(result.current.rgbActiveSlot).toBe(1);
  });
});
