import { useState } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PanelAudioTriggerSettings } from './AudioTriggerSettings';
import type { AudioTriggerSettings } from './audioTrigger';

vi.mock('./useAudioTriggerPreviewPublisher', () => ({ useAudioTriggerPreviewPublisher: () => {} }));
vi.mock('./useBackgroundMedia', () => ({ useBackgroundMedia: () => ({ items: [], thumbs: {} }) }));
vi.mock('../editor/PanelThemeSettings', () => ({ PanelThemeSettings: () => <div aria-label="Background editor" /> }));
const saved: AudioTriggerSettings = { enabled: false, intensity: 26, switchDelay: 1, shuffle: true,
  backgrounds: [{ mode: 'shader', effect: 'oscilloscope', template: 0 }] };

describe('Audio Trigger dialog beat controls', () => {
  it('places independent beat settings after Shuffle and never writes sensitivity, delay or looks', async () => {
    const onChange = vi.fn(); const beats = vi.fn();
    function Harness() {
      const [beat, setBeat] = useState({ enabled: true, durationMs: 900 });
      return <PanelAudioTriggerSettings value={saved} onChange={onChange} beatTransition={beat}
        onBeatTransitionChange={next => { beats(next); setBeat(next); }}
        themeMode="dark" deviceId="panel-one" deviceAspect={2} />;
    }
    render(<Harness />);
    expect(screen.queryByRole('switch', { name: 'Beat transitions' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Backgrounds' }));
    const dialog = screen.getByRole('dialog', { name: 'Audio Trigger backgrounds' });
    const toggle = within(dialog).getByRole('switch', { name: 'Beat transitions' });
    expect(within(dialog).getByRole('switch', { name: 'Shuffle' }).compareDocumentPosition(toggle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.change(within(dialog).getByRole('slider', { name: 'Transition duration' }), { target: { value: '1700' } });
    expect(beats).not.toHaveBeenCalled();
    fireEvent.keyUp(within(dialog).getByRole('slider', { name: 'Transition duration' }), { key: 'ArrowRight' });
    await waitFor(() => expect(beats).toHaveBeenLastCalledWith({ enabled: true, durationMs: 1700 }));
    fireEvent.click(toggle);
    expect(beats).toHaveBeenLastCalledWith({ enabled: false, durationMs: 1700 });
    expect(within(dialog).getByRole('slider', { name: 'Transition duration' })).toBeDisabled();
    expect(onChange).not.toHaveBeenCalled();
    expect(within(dialog).getByRole('slider', { name: 'Audio Intensity' })).toHaveValue('26');
    expect(within(dialog).getByRole('slider', { name: 'Switch Delay' })).toHaveValue('1');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Done' }));
    fireEvent.click(screen.getByRole('button', { name: 'Backgrounds' }));
    expect(screen.getByRole('slider', { name: 'Transition duration' })).toHaveValue('1700');
    expect(screen.getByRole('switch', { name: 'Beat transitions' })).toHaveAttribute('aria-checked', 'false');
  });

  it('does not add beat controls to consumers without the display callback', () => {
    render(<PanelAudioTriggerSettings value={saved} onChange={vi.fn()} themeMode="dark" deviceAspect={2} />);
    fireEvent.click(screen.getByRole('button', { name: 'Backgrounds' }));
    expect(screen.queryByRole('switch', { name: 'Beat transitions' })).toBeNull();
    expect(screen.queryByRole('slider', { name: 'Transition duration' })).toBeNull();
  });
});
