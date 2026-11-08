import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BASE_DEFAULTS } from '../../../../types/lighting';
import { panelBackgroundPresets } from '../../../background/panelBackground';
const color = panelBackgroundPresets('dark')[0];
import { AudioTriggerMenu } from './AudioTriggerMenu';

const empty = { enabled: false, intensity: 50, switchDelay: 1, shuffle: false, looks: [] };
const stateFor = () => ({ ...BASE_DEFAULTS, params: {} });

describe('lighting Audio Trigger menu', () => {
  it('puts its independent enable switch first, followed by capture settings', () => {
    const onChange = vi.fn();
    const { container } = render(<AudioTriggerMenu value={empty} onChange={onChange} stateFor={stateFor}
      output={{ value: 'output:', options: [{ value: 'output:', label: 'System default' }], select: vi.fn() }} />);
    const toggle = screen.getByRole('switch', { name: 'lighting.audioTrigger.title' });
    expect(container.querySelector('button, input, select')).toBe(toggle);
    fireEvent.click(toggle);
    expect(onChange).toHaveBeenCalledWith({ enabled: true });
    fireEvent.click(screen.getByRole('switch', { name: 'Shuffle' }));
    expect(onChange).toHaveBeenCalledWith({ shuffle: true });
    expect(screen.getByRole('slider', { name: 'Audio Intensity' })).toHaveValue('50');
    expect(screen.getByRole('slider', { name: 'Switch Delay' })).toHaveValue('1');
  });

  it('adds a selected colour without changing the normal lighting look', () => {
    const onChange = vi.fn();
    render(<AudioTriggerMenu value={empty} onChange={onChange} stateFor={stateFor} />);
    fireEvent.click(screen.getByRole('button', { name: color }));
    fireEvent.click(screen.getByRole('button', { name: 'lighting.audioTrigger.add' }));
    expect(onChange).toHaveBeenLastCalledWith({ looks: [{ mode: 'static', color: color }] });
  });

  it('removes only the selected look and keeps snapshots independent', () => {
    const onChange = vi.fn();
    const looks = [{ mode: 'static' as const, color: '#ff0000' }, { mode: 'animate' as const, effect: 'plasma', state: stateFor() }];
    const original = structuredClone(looks);
    render(<AudioTriggerMenu value={{ ...empty, looks }} onChange={onChange} stateFor={stateFor} />);
    fireEvent.click(screen.getByRole('button', { name: 'lighting.audioTrigger.remove 1' }));
    expect(onChange).toHaveBeenLastCalledWith({ looks: [looks[1]] });
    expect(looks).toEqual(original);
  });

  it('bounds selections and disables edits during save or unavailable reads', () => {
    const { rerender } = render(<AudioTriggerMenu value={{ ...empty, looks: Array.from({ length: 32 }, () => ({ mode: 'static', color: '#ff0000' })) }}
      onChange={vi.fn()} stateFor={stateFor} />);
    expect(screen.getByRole('button', { name: 'lighting.audioTrigger.add' })).toBeDisabled();
    rerender(<AudioTriggerMenu value={empty} onChange={vi.fn()} stateFor={stateFor} busy />);
    expect(screen.getByRole('switch', { name: 'lighting.audioTrigger.title' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'lighting.audioOutput.label' })).not.toBeInTheDocument();
  });

  it('preserves an Update target after failure and treats a remotely replaced target as a new draft', () => {
    const onChange = vi.fn();
    const original = { mode: 'static' as const, color: '#ff0000' };
    const { rerender } = render(<AudioTriggerMenu value={{ ...empty, looks: [original] }} onChange={onChange} stateFor={stateFor} />);
    fireEvent.click(screen.getByRole('button', { name: 'lighting.audioTrigger.edit 1' }));
    fireEvent.click(screen.getByRole('button', { name: color }));
    fireEvent.click(screen.getByRole('button', { name: 'lighting.audioTrigger.update' }));
    rerender(<AudioTriggerMenu value={{ ...empty, looks: [original] }} onChange={onChange} stateFor={stateFor} error="save" />);
    expect(screen.getByRole('button', { name: 'lighting.audioTrigger.update' })).toBeInTheDocument();
    const replacement = { mode: 'static' as const, color: '#00ff00' };
    rerender(<AudioTriggerMenu value={{ ...empty, looks: [replacement] }} onChange={onChange} stateFor={stateFor} />);
    fireEvent.click(screen.getByRole('button', { name: 'lighting.audioTrigger.add' }));
    expect(onChange).toHaveBeenLastCalledWith({ looks: [replacement, { mode: 'static', color: color }] });
  });
});
