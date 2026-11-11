import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioTriggerWidget, AudioTriggerTouch } from './AudioTriggerWidget';
import { audioTriggerApp } from './index';
import { appAvailableForSurface } from '../registry';
import { useAudioTriggerTargets } from './useAudioTriggerTargets';
import en from '../../../locales/en.json';

vi.mock('./useAudioTriggerTargets', () => ({ useAudioTriggerTargets: vi.fn() }));
vi.mock('../../../lib/i18n', () => ({ useTranslation: () => ({ t: (key: string) => (en as Record<string, string>)[key] ?? key }) }));
const widget = { id: 'audio', type: 'audio-trigger', size: '4x2' as const, col: 0, row: 0 };
const change = vi.fn();
const refresh = vi.fn();
const targets = [
  { id: 'background:y70', kind: 'background' as const, name: 'Y70 Touch', enabled: false, intensity: 30 },
  { id: 'lighting:keyboard', kind: 'lighting' as const, name: 'Keyboard', enabled: true, intensity: 70 },
];
beforeEach(() => { vi.clearAllMocks(); vi.mocked(useAudioTriggerTargets).mockReturnValue({ targets, loading: false, saving: false, error: null, change, refresh }); });

describe('Audio Trigger tile and immersive controls', () => {
  it('shows mixed state and switches every configured target off without changing intensity', () => {
    render(<AudioTriggerWidget widget={widget} />);
    fireEvent.click(screen.getByRole('button', { name: 'Turn all Audio Trigger off' }));
    expect(change).toHaveBeenCalledExactlyOnceWith({ enabled: false });
    expect(screen.getByText('Mixed')).toBeInTheDocument();
    expect(screen.getByRole('slider', { name: 'Audio intensity' })).toHaveValue('50');
  });

  it('opens immersive separately from the toggle and fader', () => {
    const open = vi.fn();
    render(<AudioTriggerWidget widget={widget} onEnterImmersive={open} />);
    fireEvent.click(screen.getByRole('button', { name: 'Turn all Audio Trigger off' }));
    fireEvent.click(screen.getByRole('slider'));
    expect(open).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Device controls' }));
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('sends a universal absolute intensity while preserving enable states', () => {
    render(<AudioTriggerWidget widget={widget} />);
    fireEvent.change(screen.getByRole('slider'), { target: { value: '85' } });
    expect(change).toHaveBeenCalledExactlyOnceWith({ intensity: 85 });
  });

  it('lists configured disabled devices and changes only the chosen device', () => {
    render(<AudioTriggerTouch widget={widget} />);
    const background = screen.getByRole('switch', { name: 'Y70 Touch Audio Trigger' });
    expect(background).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(background);
    expect(change).toHaveBeenLastCalledWith({ targetIds: ['background:y70'], enabled: true });
    fireEvent.change(screen.getByRole('slider', { name: 'Keyboard audio intensity' }), { target: { value: '25' } });
    expect(change).toHaveBeenLastCalledWith({ targetIds: ['lighting:keyboard'], intensity: 25 });
    expect(screen.getByText('Background')).toBeInTheDocument();
    expect(screen.getByText('Lighting')).toBeInTheDocument();
  });

  it('disables empty/loading controls and offers recovery after a failure', () => {
    vi.mocked(useAudioTriggerTargets).mockReturnValue({ targets: [], loading: false, saving: false, error: 'load', change, refresh });
    render(<AudioTriggerWidget widget={widget} />);
    expect(screen.getByRole('button', { name: 'Turn all Audio Trigger on' })).toBeDisabled();
    expect(screen.getByRole('slider')).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('is offered on interactive full-widget surfaces and omitted from display-only surfaces', () => {
    for (const surface of ['y70', 'phone', 'desktop'] as const) expect(appAvailableForSurface(audioTriggerApp.meta, surface)).toBe(true);
    expect(appAvailableForSurface(audioTriggerApp.meta, 'monitor', { deviceTouch: true })).toBe(true);
    for (const surface of ['q60', 'lcd-round', 'lcd-square', 'lcd-wide', 'lcd-portrait'] as const) {
      expect(appAvailableForSurface(audioTriggerApp.meta, surface)).toBe(false);
    }
    expect(audioTriggerApp.Touch).toBe(AudioTriggerTouch);
  });
});
