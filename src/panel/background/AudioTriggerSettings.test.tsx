import { useState } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PanelAudioTriggerSettings } from './AudioTriggerSettings';
import type { AudioTriggerSettings } from './audioTrigger';
import type { PanelThemeSettingsProps } from '../editor/PanelThemeSettings';

const preview = vi.hoisted(() => vi.fn());
vi.mock('./useAudioTriggerPreviewPublisher', () => ({ useAudioTriggerPreviewPublisher: preview }));

vi.mock('./useBackgroundMedia', () => ({ useBackgroundMedia: () => ({ items: [], thumbs: {} }) }));

vi.mock('../editor/PanelThemeSettings', () => ({
  PanelThemeSettings: (props: PanelThemeSettingsProps) => <div aria-label="Background editor">
    <output>{props.theme.backgroundColor}</output>
    <button onClick={() => props.onBackgroundCommit('#ff0000')}>Red solid</button>
    <button onClick={() => { props.onBackgroundModeCommit('shader'); props.onBackgroundEffectCommit('plasma'); }}>Plasma animation</button>
    <button onClick={() => props.onBackgroundMediaCommit('asset-one', 'static', false)}>First media</button>
    <button onClick={() => props.onBackgroundMediaCommit('asset-two', 'animated', true)}>Second media</button>
    <button onClick={() => props.onBackgroundModeCommit('media')}>Empty media category</button>
    <button onClick={() => props.onBackgroundOpacityCommit(0.4)}>Dim background</button>
    <button onClick={() => props.onBackgroundOpacityPreview(0.2)}>Preview dim background</button>
    <output aria-label="Independent editor">{String(props.independentBackground && props.hideSlideshowControls)}</output>
  </div>,
}));

const settings = (patch: Partial<AudioTriggerSettings> = {}): AudioTriggerSettings => ({
  enabled: false, intensity: 50, switchDelay: 1, shuffle: false, backgrounds: [], ...patch,
});

function mount(initial = settings()) {
  const onChange = vi.fn();
  function Harness() {
    const [value, setValue] = useState(initial);
    return <PanelAudioTriggerSettings value={value} onChange={next => { onChange(next); setValue(next); }}
      themeMode="dark" deviceId="panel-one" deviceAspect={2} deviceW={1000} deviceH={500} />;
  }
  render(<Harness />);
  return onChange;
}

describe('Audio Trigger settings', () => {
  it('enables without changing the normal background or losing saved selections', () => {
    const backgrounds = [{ mode: 'solid' as const, color: '#ff0000' }];
    const onChange = mount(settings({ backgrounds }));
    fireEvent.click(screen.getByRole('switch', { name: 'Audio Trigger' }));
    expect(onChange).toHaveBeenLastCalledWith(settings({ enabled: true, backgrounds }));
    fireEvent.click(screen.getByRole('switch', { name: 'Audio Trigger' }));
    expect(onChange).toHaveBeenLastCalledWith(settings({ backgrounds }));
  });

  it('keeps selections across Solid, Animations and Media, and edits/removes one independently', () => {
    const onChange = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Backgrounds' }));
    const dialog = screen.getByRole('dialog', { name: 'Audio Trigger backgrounds' });
    expect(within(dialog).getByLabelText('Independent editor')).toHaveTextContent('true');
    fireEvent.click(within(dialog).getByText('Red solid'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add background' }));
    fireEvent.click(within(dialog).getByText('Plasma animation'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add background' }));
    fireEvent.click(within(dialog).getByText('First media'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add background' }));
    let value = onChange.mock.calls.at(-1)![0] as AudioTriggerSettings;
    expect(value.backgrounds.map(background => background.mode)).toEqual(['solid', 'shader', 'media']);
    expect(value.backgrounds[2]).toMatchObject({ mediaId: 'asset-one', mediaType: 'static', slideshow: false });
    fireEvent.click(within(dialog).getByRole('button', { name: /Edit background 1/ }));
    fireEvent.click(within(dialog).getByText('Dim background'));
    expect(within(dialog).queryByRole('button', { name: 'Update background' })).toBeNull();
    value = onChange.mock.calls.at(-1)![0] as AudioTriggerSettings;
    expect(value.backgrounds[0].opacity).toBe(0.4);
    expect(value.backgrounds[2].mediaId).toBe('asset-one');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove background 2' }));
    value = onChange.mock.calls.at(-1)![0] as AudioTriggerSettings;
    expect(value.backgrounds.map(background => background.mode)).toEqual(['solid', 'media']);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('changes intensity, entry/return delay and shuffle while retaining the choices', async () => {
    const onChange = mount(settings({ enabled: true, backgrounds: [{ mode: 'solid', color: '#00ff00' }] }));
    fireEvent.click(screen.getByRole('button', { name: 'Backgrounds' }));
    fireEvent.change(screen.getByRole('slider', { name: 'Audio Intensity' }), { target: { value: '75' } });
    fireEvent.pointerUp(screen.getByRole('slider', { name: 'Audio Intensity' }));
    await waitFor(() => expect(onChange.mock.calls.at(-1)![0].intensity).toBe(75));
    fireEvent.change(screen.getByRole('slider', { name: 'Switch Delay' }), { target: { value: '2.5' } });
    fireEvent.pointerUp(screen.getByRole('slider', { name: 'Switch Delay' }));
    await waitFor(() => expect(onChange.mock.calls.at(-1)![0].switchDelay).toBe(2.5));
    fireEvent.click(screen.getByRole('switch', { name: 'Shuffle' }));
    expect(onChange.mock.calls.at(-1)![0]).toMatchObject({ intensity: 75, switchDelay: 2.5, shuffle: true,
      backgrounds: [{ mode: 'solid', color: '#00ff00' }] });
  });

  it('bounds selection count and prevents adding empty media', () => {
    mount(settings({ backgrounds: Array.from({ length: 32 }, () => ({ mode: 'solid', color: '#00ff00' })) }));
    fireEvent.click(screen.getByRole('button', { name: 'Backgrounds' }));
    expect(screen.getByRole('button', { name: 'Add background' })).toBeDisabled();
  });

  it('previews an existing disabled-trigger selection and automatically commits only finished edits', () => {
    const onChange = mount(settings({ backgrounds: [{ mode: 'solid', color: '#00ff00' }, { mode: 'media', mediaId: 'asset-one', mediaType: 'static' }] }));
    fireEvent.click(screen.getByRole('button', { name: 'Backgrounds' }));
    expect(preview).toHaveBeenLastCalledWith('panel-one', null);
    fireEvent.click(screen.getByRole('button', { name: 'Edit background 1' }));
    expect(preview).toHaveBeenLastCalledWith('panel-one', expect.objectContaining({ color: '#00ff00' }));
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Preview dim background'));
    expect(preview).toHaveBeenLastCalledWith('panel-one', expect.objectContaining({ opacity: 0.2 }));
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Dim background'));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ enabled: false, backgrounds: [
      expect.objectContaining({ color: '#00ff00', opacity: 0.4 }), expect.objectContaining({ mediaId: 'asset-one' }),
    ] }));
    fireEvent.click(screen.getByText('Red solid'));
    expect(onChange.mock.calls.at(-1)![0].backgrounds[0]).toMatchObject({ color: '#ff0000', opacity: 0.4 });
    fireEvent.click(screen.getByRole('button', { name: 'New background' }));
    expect(preview).toHaveBeenLastCalledWith('panel-one', null);
  });

  it('keeps the selected entry when an earlier entry is removed and clears preview when it is removed', () => {
    const onChange = mount(settings({ backgrounds: [{ mode: 'solid', color: '#ff0000' }, { mode: 'solid', color: '#00ff00' }] }));
    fireEvent.click(screen.getByRole('button', { name: 'Backgrounds' }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit background 2' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove background 1' }));
    fireEvent.click(screen.getByText('Dim background'));
    expect(onChange.mock.calls.at(-1)![0].backgrounds).toEqual([expect.objectContaining({ color: '#00ff00', opacity: 0.4 })]);
    fireEvent.click(screen.getByRole('button', { name: 'Remove background 1' }));
    expect(preview).toHaveBeenLastCalledWith('panel-one', null);
  });

  it('does not retarget automatic edits after another editor replaces the selected entry', () => {
    const onChange = vi.fn();
    const props = { themeMode: 'dark' as const, deviceId: 'panel-one', deviceAspect: 2, onChange };
    const view = render(<PanelAudioTriggerSettings {...props} value={settings({ backgrounds: [{ mode: 'solid', color: '#ff0000' }] })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Backgrounds' }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit background 1' }));
    view.rerender(<PanelAudioTriggerSettings {...props} value={settings({ backgrounds: [{ mode: 'solid', color: '#0000ff' }] })} />);
    fireEvent.click(screen.getByText('Dim background'));
    expect(onChange).not.toHaveBeenCalled();
    expect(preview).toHaveBeenLastCalledWith('panel-one', null);
  });

  it('waits for a valid media choice before replacing an existing entry, and keeps later edits on that entry', () => {
    const onChange = mount(settings({ backgrounds: [{ mode: 'solid', color: '#00ff00' }] }));
    fireEvent.click(screen.getByRole('button', { name: 'Backgrounds' }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit background 1' }));
    fireEvent.click(screen.getByText('Empty media category'));
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Second media'));
    expect(onChange.mock.calls.at(-1)![0].backgrounds).toEqual([expect.objectContaining({ mode: 'media', mediaId: 'asset-two', mediaType: 'animated', mediaAlpha: true })]);
    fireEvent.click(screen.getByText('Dim background'));
    expect(onChange.mock.calls.at(-1)![0].backgrounds).toEqual([expect.objectContaining({ mediaId: 'asset-two', opacity: 0.4 })]);
  });
});
