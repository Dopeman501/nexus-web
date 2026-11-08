import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BASE_DEFAULTS } from '../../../../types/lighting';
import { EffectControls } from './EffectControls';

vi.mock('../../../../hooks/useShaderParams', () => ({
  useShaderParams: () => ({ loaded: true, sensors: [], specs: {
    u_background_rotation: { name: 'u_background_rotation', min: 0, max: 360, step: 1, defaultValue: 0, declared: true },
    u_background_zoom: { name: 'u_background_zoom', min: 0.1, max: 3, step: 0.05, defaultValue: 1, declared: true },
    u_zoom: { name: 'u_zoom', min: 0.5, max: 3, step: 0.05, defaultValue: 1, declared: true },
    u_warp: { name: 'u_warp', min: 0, max: 2, step: 0.05, defaultValue: 1, declared: true },
  } }),
}));

function setup(background = true, angle?: number, params: Record<string, number> = {}) {
  const state = { ...BASE_DEFAULTS, params: { u_warp: 0.5, ...params, ...(angle === undefined ? {} : { u_background_rotation: angle }) } };
  const onChange = vi.fn();
  const onCommit = vi.fn();
  const onReset = vi.fn();
  render(<EffectControls effect="plasma" state={state} bundle={{ selected: 0, slots: [state] }}
    onTemplateSelect={vi.fn()} canReset={angle !== undefined} onChange={onChange} onCommit={onCommit} onReset={onReset}
    background={background} noPresets />);
  return { onChange, onCommit, onReset };
}

describe('background effect rotation', () => {
  it('preserves authored reserved-name controls without duplicating or rescaling them', () => {
    const state = { ...BASE_DEFAULTS, params: { u_background_rotation: 45, u_background_zoom: 2 } };
    render(<EffectControls effect="custom:reserved" customDef={{ key: 'custom:reserved', labelKey: '', params: [
      { name: 'u_background_rotation', label: 'Authored angle' }, { name: 'u_background_zoom', label: 'Authored scale' },
    ] }} state={state} bundle={{ selected: 0, slots: [state] }} onTemplateSelect={vi.fn()}
      canReset={false} onChange={vi.fn()} onCommit={vi.fn()} onReset={vi.fn()} noPresets />);
    expect(screen.getByRole('slider', { name: 'Authored angle' })).toHaveValue('45');
    expect(screen.getByRole('slider', { name: 'Authored scale' })).toHaveValue('40');
    expect(screen.queryByRole('slider', { name: 'lighting.controls.patternRotation' })).not.toBeInTheDocument();
    expect(screen.queryByRole('slider', { name: 'lighting.controls.patternZoom' })).not.toBeInTheDocument();
  });

  it('places percentage zoom immediately below rotation with an unchanged-view default', () => {
    setup();
    const zoom = screen.getByRole('slider', { name: 'panel.settings.backgroundZoom' });
    expect(zoom).toHaveValue('100');
    expect(zoom).toHaveAttribute('min', '10');
    expect(zoom).toHaveAttribute('max', '300');
    expect(zoom).toHaveAttribute('step', '5');
    const sliders = screen.getAllByRole('slider');
    expect(sliders.indexOf(zoom)).toBe(sliders.indexOf(screen.getByRole('slider', { name: 'panel.settings.backgroundRotation' })) + 1);
    expect(screen.getByRole('slider', { name: 'lighting.controls.param.zoom' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '100%' })).toBeInTheDocument();
  });

  it('previews and commits percentage zoom without overwriting rotation or effect parameters', async () => {
    const { onChange, onCommit } = setup(true, 45, { u_zoom: 1.5 });
    const zoom = screen.getByRole('slider', { name: 'panel.settings.backgroundZoom' });
    fireEvent.change(zoom, { target: { value: '200' } });
    expect(onChange).toHaveBeenLastCalledWith({ params: { u_warp: 0.5, u_zoom: 1.5, u_background_rotation: 45, u_background_zoom: 2 } }, false);
    fireEvent.pointerUp(zoom);
    await waitFor(() => expect(onCommit).toHaveBeenCalledOnce());
  });

  it.each([[2, '200'], [0, '10'], [NaN, '100'], [8, '300']])('normalizes saved zoom %s for display', (value, display) => {
    setup(true, 45, { u_background_zoom: value });
    expect(screen.getByRole('slider', { name: 'panel.settings.backgroundZoom' })).toHaveValue(display);
  });

  it('offers degrees with a zero default for an existing preset', () => {
    setup();
    const slider = screen.getByRole('slider', { name: 'panel.settings.backgroundRotation' });
    expect(slider).toHaveAttribute('min', '0');
    expect(slider).toHaveAttribute('max', '360');
    expect(slider).toHaveValue('0');
  });

  it('previews the angle while retaining other parameters, then commits on release', async () => {
    const { onChange, onCommit, onReset } = setup(true, 45);
    const slider = screen.getByRole('slider', { name: 'panel.settings.backgroundRotation' });
    expect(slider).toHaveValue('45');
    fireEvent.change(slider, { target: { value: '90' } });
    expect(onChange).toHaveBeenLastCalledWith({ params: { u_warp: 0.5, u_background_rotation: 90 } }, false);
    fireEvent.pointerUp(slider);
    await waitFor(() => expect(onCommit).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole('button', { name: 'lighting.controls.reset' }));
    expect(onReset).toHaveBeenCalledOnce();
  });

  it('bounds imported angles for display and leaves the lighting editor unchanged', () => {
    setup(true, 900);
    expect(screen.getByRole('slider', { name: 'panel.settings.backgroundRotation' })).toHaveValue('360');
  });

  it('exposes the same saved rotation and percentage zoom in the lighting editor', async () => {
    const { onChange, onCommit } = setup(false, 45, { u_background_zoom: 2, u_zoom: 1.5 });
    const rotation = screen.getByRole('slider', { name: 'lighting.controls.patternRotation' });
    const zoom = screen.getByRole('slider', { name: 'lighting.controls.patternZoom' });
    expect(rotation).toHaveValue('45');
    expect(zoom).toHaveValue('200');
    expect(zoom).toHaveAttribute('min', '10');
    expect(zoom).toHaveAttribute('max', '300');
    expect(zoom).toHaveAttribute('step', '5');
    const sliders = screen.getAllByRole('slider');
    expect(sliders.indexOf(zoom)).toBe(sliders.indexOf(rotation) + 1);
    fireEvent.change(zoom, { target: { value: '150' } });
    expect(onChange).toHaveBeenLastCalledWith({ params: { u_warp: 0.5, u_zoom: 1.5, u_background_rotation: 45, u_background_zoom: 1.5 } }, false);
    fireEvent.pointerUp(zoom);
    await waitFor(() => expect(onCommit).toHaveBeenCalledOnce());
    expect(screen.queryByRole('slider', { name: 'panel.settings.backgroundRotation' })).not.toBeInTheDocument();
    expect(screen.queryByRole('slider', { name: 'panel.settings.backgroundZoom' })).not.toBeInTheDocument();
  });
});
