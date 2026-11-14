import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../lib/i18n';
import en from '../../locales/en.json';
import { BeatTransitionControls } from './BeatTransitionControls';

const wrapper = ({ children }: { children: React.ReactNode }) => <I18nProvider initialLanguage="en" initialTranslations={en}>{children}</I18nProvider>;

describe('independent beat transition controls', () => {
  it('starts off with a bounded fallback duration when no preference is supplied', () => {
    const onChange = vi.fn();
    render(<BeatTransitionControls onChange={onChange} />, { wrapper });
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('slider')).toHaveValue('800');
    expect(screen.getByRole('slider')).toBeDisabled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('exposes one beat-only toggle/duration and explains the main activation duration without another picker', () => {
    const onChange = vi.fn();
    render(<BeatTransitionControls value={{ enabled: true, durationMs: 1200 }} onChange={onChange} />, { wrapper });
    expect(screen.getAllByRole('switch', { name: 'Beat transitions' })).toHaveLength(1);
    expect(screen.getAllByRole('slider', { name: 'Transition duration' })).toHaveLength(1);
    expect(screen.getByText('Only background swaps between beats. Activation uses the main transition duration.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Transitions', exact: true })).toBeNull();
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('turns beat effects off without changing the stored duration', () => {
    const onChange = vi.fn();
    render(<BeatTransitionControls value={{ enabled: true, durationMs: 1500 }} onChange={onChange} />, { wrapper });
    fireEvent.click(screen.getByRole('switch', { name: 'Beat transitions' }));
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ enabled: false, durationMs: 1500 });
  });

  it('retains duration while off and disables both slider and typed editing', () => {
    const onChange = vi.fn();
    render(<BeatTransitionControls value={{ enabled: false, durationMs: 1500 }} onChange={onChange} />, { wrapper });
    expect(screen.getByRole('slider', { name: 'Transition duration' })).toBeDisabled();
    expect(screen.getByRole('slider')).toHaveValue('1500');
    expect(screen.queryByRole('button', { name: 'Transition duration' })).toBeNull();
    fireEvent.click(screen.getByRole('switch'));
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ enabled: true, durationMs: 1500 });
  });

  it('keeps drag drafts local until gesture completion and saves only the beat duration', async () => {
    const onChange = vi.fn();
    render(<BeatTransitionControls value={{ enabled: true, durationMs: 800 }} onChange={onChange} />, { wrapper });
    const slider = screen.getByRole('slider', { name: 'Transition duration' });
    expect(slider).toHaveAttribute('min', '80'); expect(slider).toHaveAttribute('max', '5000');
    fireEvent.change(slider, { target: { value: '1600' } });
    expect(slider).toHaveValue('1600'); expect(onChange).not.toHaveBeenCalled();
    fireEvent.keyUp(slider, { key: 'ArrowRight' });
    await waitFor(() => expect(onChange).toHaveBeenCalledExactlyOnceWith({ enabled: true, durationMs: 1600 }));
  });

  it('saves a typed duration once and replaces an obsolete local draft when preferences change', async () => {
    const onChange = vi.fn();
    const view = render(<BeatTransitionControls value={{ enabled: true, durationMs: 800 }} onChange={onChange} />, { wrapper });
    fireEvent.click(screen.getByRole('button', { name: 'Transition duration' }));
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '1230' } });
    fireEvent.keyDown(screen.getByRole('spinbutton'), { key: 'Enter' });
    await waitFor(() => expect(onChange).toHaveBeenCalledExactlyOnceWith({ enabled: true, durationMs: 1230 }));
    fireEvent.change(screen.getByRole('slider'), { target: { value: '1700' } });
    view.rerender(<BeatTransitionControls value={{ enabled: false, durationMs: 2500 }} onChange={onChange} />);
    expect(screen.getByRole('slider')).toHaveValue('2500');
    expect(screen.getByRole('slider')).toBeDisabled();
  });

  it('discards an unfinished duration gesture when the dialog closes', () => {
    const onChange = vi.fn();
    const view = render(<BeatTransitionControls value={{ enabled: true, durationMs: 800 }} onChange={onChange} />, { wrapper });
    fireEvent.change(screen.getByRole('slider'), { target: { value: '1900' } });
    view.unmount();
    expect(onChange).not.toHaveBeenCalled();
  });
});
