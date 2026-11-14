import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BackgroundTransitionControls } from './BackgroundTransitionControls';
import { I18nProvider } from '../../lib/i18n';
import en from '../../locales/en.json';

const preview = vi.hoisted(() => ({ play: vi.fn(), error: false, bind: vi.fn() }));
vi.mock('./useBackgroundTransitionPreviewPublisher', () => ({
  useBackgroundTransitionPreviewPublisher: (deviceId: string | null | undefined, open: boolean) => {
    preview.bind(deviceId, open);
    return { preview: preview.play, error: preview.error };
  },
}));
const wrapper = ({ children }: { children: React.ReactNode }) => <I18nProvider initialLanguage="en" initialTranslations={en}>{children}</I18nProvider>;
const water = 'gl-transitions:WaterDrop';
const wave = 'curtains:wave';
const saved = { enabled: true, effects: [water], durationMs: 800 };
const openPicker = () => {
  fireEvent.click(screen.getByRole('button', { name: 'Transitions', exact: true }));
  return screen.getByRole('dialog', { name: 'Transitions', exact: true });
};
beforeEach(() => { preview.play.mockClear(); preview.bind.mockClear(); preview.error = false; });

describe('shared background transition picker', () => {
  it('shows one shared switch and exact caption with no dropdown or outside duration slider', () => {
    render(<BackgroundTransitionControls value={saved} onCommit={vi.fn()} deviceId="d" />, { wrapper });
    expect(screen.getAllByRole('switch', { name: 'Transitions' })).toHaveLength(1);
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText('Transitions apply to Slideshows and Audio Trigger')).toBeTruthy();
    expect(screen.queryByRole('combobox')).toBeNull(); expect(screen.queryByRole('slider')).toBeNull();
  });

  it('opens all selected-library image tiles and one duration slider', () => {
    render(<BackgroundTransitionControls value={saved} onCommit={vi.fn()} deviceId="d" />, { wrapper });
    const dialog = openPicker();
    expect(within(dialog).getAllByRole('button').filter(button => button.hasAttribute('aria-pressed'))).toHaveLength(226);
    expect(dialog.querySelectorAll('img')).toHaveLength(226);
    expect(dialog.querySelectorAll('canvas,video')).toHaveLength(0);
    expect(within(dialog).getAllByRole('slider', { name: 'Transition duration' })).toHaveLength(1);
    expect(within(dialog).getByRole('heading', { name: 'GL Transitions' })).toBeTruthy();
    expect(within(dialog).getByRole('heading', { name: 'Curtains.js' })).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Water Drop', exact: true })).toHaveAttribute('aria-pressed', 'true');
  });

  it('keeps rapid selection order without parent echoes and previews every selection or deselection', () => {
    const commit = vi.fn();
    render(<BackgroundTransitionControls value={saved} onCommit={commit} deviceId="d" />, { wrapper });
    const dialog = openPicker();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Wave displacement', exact: true }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cross Zoom', exact: true }));
    expect(commit).toHaveBeenLastCalledWith({ ...saved, effects: [water, wave, 'gl-transitions:CrossZoom'] });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Water Drop', exact: true }));
    expect(commit).toHaveBeenLastCalledWith({ ...saved, effects: [wave, 'gl-transitions:CrossZoom'] });
    expect(preview.play.mock.calls).toEqual([[wave, 800], ['gl-transitions:CrossZoom', 800], [water, 800]]);
    expect(within(dialog).getByRole('button', { name: 'Water Drop', exact: true })).toHaveAttribute('aria-pressed', 'false');
  });

  it('keeps chosen effects when switched off and disables both after removing the last selection', () => {
    const commit = vi.fn();
    render(<BackgroundTransitionControls value={saved} onCommit={commit} deviceId="d" />, { wrapper });
    fireEvent.click(screen.getByRole('switch'));
    expect(commit).toHaveBeenLastCalledWith({ ...saved, enabled: false });
    fireEvent.click(screen.getByRole('switch'));
    expect(commit).toHaveBeenLastCalledWith(saved);
    const dialog = openPicker();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Water Drop', exact: true }));
    expect(commit).toHaveBeenLastCalledWith({ ...saved, enabled: false, effects: [] });
  });

  it('chooses the initial effect when enabling an empty set', () => {
    const commit = vi.fn();
    render(<BackgroundTransitionControls value={{ enabled: false, effects: [], durationMs: 900 }} onCommit={commit} />, { wrapper });
    fireEvent.click(screen.getByRole('switch'));
    expect(commit).toHaveBeenCalledExactlyOnceWith({ enabled: true, effects: [water], durationMs: 900 });
  });

  it('saves duration once on gesture completion and auditions with the latest duration', async () => {
    const commit = vi.fn();
    render(<BackgroundTransitionControls value={saved} onCommit={commit} deviceId="d" />, { wrapper });
    const dialog = openPicker(); const slider = within(dialog).getByRole('slider', { name: 'Transition duration' });
    expect(slider).toHaveAttribute('min', '80'); expect(slider).toHaveAttribute('max', '5000');
    fireEvent.change(slider, { target: { value: '1500' } }); expect(commit).not.toHaveBeenCalled();
    fireEvent.keyUp(slider, { key: 'ArrowRight' });
    await waitFor(() => expect(commit).toHaveBeenCalledExactlyOnceWith({ ...saved, durationMs: 1500 }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Wave displacement', exact: true }));
    expect(preview.play).toHaveBeenLastCalledWith(wave, 1500);
    expect(commit).toHaveBeenLastCalledWith({ ...saved, effects: [water, wave], durationMs: 1500 });
  });

  it('saves typed duration once without changing its selected set', async () => {
    const commit = vi.fn();
    render(<BackgroundTransitionControls value={saved} onCommit={commit} deviceId="d" />, { wrapper });
    const dialog = openPicker();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Transition duration' }));
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '1230' } });
    fireEvent.keyDown(screen.getByRole('spinbutton'), { key: 'Enter' });
    await waitFor(() => expect(commit).toHaveBeenCalledExactlyOnceWith({ ...saved, durationMs: 1230 }));
  });

  it('drops stale drafts on external updates and retires the picker when its device changes', () => {
    const commit = vi.fn();
    const view = render(<BackgroundTransitionControls value={saved} onCommit={commit} deviceId="first" />, { wrapper });
    openPicker(); fireEvent.change(screen.getByRole('slider'), { target: { value: '1500' } });
    view.rerender(<BackgroundTransitionControls value={{ ...saved, durationMs: 2000 }} onCommit={commit} deviceId="first" />);
    expect(screen.getByRole('slider')).toHaveValue('2000');
    view.rerender(<BackgroundTransitionControls value={saved} onCommit={commit} deviceId="first" />);
    expect(screen.getByRole('slider')).toHaveValue('800');
    view.rerender(<BackgroundTransitionControls value={saved} onCommit={commit} deviceId="second" />);
    expect(screen.queryByRole('dialog')).toBeNull(); expect(preview.bind).toHaveBeenLastCalledWith('second', false);
    expect(commit).not.toHaveBeenCalled();
  });

  it('filters tiles without losing selections and reports preview failure', () => {
    preview.error = true;
    render(<BackgroundTransitionControls value={saved} onCommit={vi.fn()} deviceId="d" />, { wrapper });
    const dialog = openPicker();
    fireEvent.change(within(dialog).getByRole('searchbox', { name: 'Search transitions' }), { target: { value: 'Wave displacement' } });
    expect(within(dialog).getAllByRole('button').filter(button => button.hasAttribute('aria-pressed'))).toHaveLength(1);
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Preview unavailable. Try again.');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('dialog')).toBeNull(); expect(preview.bind).toHaveBeenLastCalledWith('d', false);
  });
});
