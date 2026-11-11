import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AudioIntensitySlider } from './AudioIntensitySlider';

vi.mock('../../../lib/i18n', () => ({ useTranslation: () => ({ t: (key: string) => key === 'common.mixed' ? 'Mixed' : key }) }));

function setup(options: { value?: number; disabled?: boolean; mixed?: boolean } = {}) {
  const change = vi.fn();
  const commit = vi.fn();
  const parentClick = vi.fn();
  const parentPointer = vi.fn();
  const parentKey = vi.fn();
  function Control() {
    const [value, setValue] = useState(options.value ?? 40);
    return <div onClick={parentClick} onPointerDown={parentPointer} onKeyDown={parentKey}>
      <AudioIntensitySlider value={value} ariaLabel="Audio intensity" disabled={options.disabled} mixed={options.mixed}
        onChange={next => { change(next); setValue(next); }} onCommit={commit} />
    </div>;
  }
  render(<Control />);
  const slider = screen.getByRole('slider', { name: 'Audio intensity' });
  return { slider, change, commit, parentClick, parentPointer, parentKey };
}

describe('AudioIntensitySlider', () => {
  it('exposes a horizontal 0–100 intensity control with its current percentage', () => {
    const { slider } = setup();
    expect(slider).toHaveAttribute('aria-orientation', 'horizontal');
    expect(slider).toHaveAttribute('min', '0');
    expect(slider).toHaveAttribute('max', '100');
    expect(slider).toHaveValue('40');
    expect(slider).toHaveAttribute('aria-valuetext', '40%');
  });

  it('tracks native range changes and commits the latest position on release', () => {
    const { slider, change, commit } = setup();
    fireEvent.pointerDown(slider, { pointerId: 1 });
    fireEvent.change(slider, { target: { value: '72' } });
    fireEvent.pointerUp(slider, { pointerId: 1 });
    expect(change).toHaveBeenLastCalledWith(72);
    expect(commit).toHaveBeenCalledExactlyOnceWith(72);
    expect(slider).toHaveValue('72');
  });

  it('commits the last accepted value once when the gesture is cancelled', () => {
    const { slider, commit } = setup();
    fireEvent.pointerDown(slider, { pointerId: 2 });
    fireEvent.change(slider, { target: { value: '63' } });
    fireEvent.pointerCancel(slider, { pointerId: 2, clientX: 0 });
    fireEvent.pointerUp(slider, { pointerId: 2 });
    expect(commit).toHaveBeenCalledExactlyOnceWith(63);
  });

  it('ignores releases from another pointer', () => {
    const { slider, commit } = setup();
    fireEvent.pointerDown(slider, { pointerId: 3 });
    fireEvent.pointerUp(slider, { pointerId: 4 });
    expect(commit).not.toHaveBeenCalled();
    fireEvent.pointerUp(slider, { pointerId: 3 });
    expect(commit).toHaveBeenCalledExactlyOnceWith(40);
  });

  it('does not open the immersive parent when pressed or clicked', () => {
    const { slider, parentClick, parentPointer } = setup();
    fireEvent.pointerDown(slider, { pointerId: 1 });
    fireEvent.click(slider);
    expect(parentClick).not.toHaveBeenCalled();
    expect(parentPointer).not.toHaveBeenCalled();
  });

  it.each([
    ['ArrowRight', 41], ['ArrowLeft', 39], ['ArrowUp', 41], ['ArrowDown', 39],
    ['PageUp', 50], ['PageDown', 30], ['Home', 0], ['End', 100],
  ])('supports %s keyboard adjustment', (key, value) => {
    const { slider, change, commit } = setup();
    fireEvent.keyDown(slider, { key });
    expect(change).toHaveBeenCalledWith(value);
    expect(commit).toHaveBeenCalledWith(value);
  });

  it('clamps keyboard input at the supported bounds', () => {
    const { slider, change } = setup({ value: 100 });
    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    expect(change).toHaveBeenCalledWith(100);
  });

  it('exposes mixed values without claiming one shared percentage', () => {
    const { slider } = setup({ mixed: true });
    expect(slider).toHaveAttribute('aria-valuetext', 'Mixed');
  });

  it('disables keyboard and pointer writes while unavailable', () => {
    const { slider, change, commit } = setup({ disabled: true });
    expect(slider).toBeDisabled();
    fireEvent.pointerDown(slider, { pointerId: 1 });
    fireEvent.change(slider, { target: { value: '85' } });
    fireEvent.pointerUp(slider, { pointerId: 1 });
    fireEvent.keyDown(slider, { key: 'End' });
    expect(change).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
  });

  it('closes an active gesture on blur', () => {
    const { slider, commit } = setup();
    fireEvent.pointerDown(slider, { pointerId: 1 });
    fireEvent.change(slider, { target: { value: '54' } });
    fireEvent.blur(slider);
    fireEvent.pointerUp(slider, { pointerId: 1 });
    expect(commit).toHaveBeenCalledExactlyOnceWith(54);
  });

  it('lets Escape reach the immersive close owner without leaking adjustment keys', () => {
    const { slider, parentKey } = setup();
    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    fireEvent.keyDown(slider, { key: 'Enter' });
    expect(parentKey).not.toHaveBeenCalled();
    fireEvent.keyDown(slider, { key: 'Escape' });
    expect(parentKey).toHaveBeenCalledOnce();
  });
});
