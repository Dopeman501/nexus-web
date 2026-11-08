import { useState } from 'react';
import type { LightingAudioTriggerLook } from '../../../../api/lightingAudioTrigger';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BASE_DEFAULTS } from '../../../../types/lighting';
import type { PanelThemeSettingsProps } from '../../../editor/PanelThemeSettings';
import { AudioTriggerLookEditor } from './AudioTriggerLookEditor';

vi.mock('../../../editor/PanelThemeSettings', () => ({
  PanelThemeSettings: (props: PanelThemeSettingsProps) => <div>
    <output aria-label="Lighting editor contract">{JSON.stringify({
      hideAppearance: props.hideBackgroundAppearanceControls,
      hideSensors: props.hideSensorBindings,
      localAudio: props.independentAudioPreview,
      independent: props.independentBackground,
      media: props.showMediaTab,
    })}</output>
    <output aria-label="Preset slot">{props.theme.backgroundTemplate}</output>
    <output aria-label="Draft effect">{props.theme.backgroundEffect}</output>
    <output aria-label="Static controls">{String(props.staticEffect)}</output>
    <button onClick={() => props.onBackgroundTemplateCommit(2)}>Preset three</button>
    <button onClick={() => props.onBackgroundModeCommit('shader')}>Animations category</button>
    <button onClick={() => props.onBackgroundModeCommit('solid')}>Solid category</button>
    <button onClick={() => props.onBackgroundCommit('#ff0000')}>Solid red</button>
    <button onClick={() => props.onBackgroundEffectCommit('plasma')}>Plasma gallery</button>
    <button onClick={() => props.onBackgroundEffectStateCommit({ ...BASE_DEFAULTS, params: { u_background_zoom: 2 } })}>Zoom snapshot</button>
    {props.theme.backgroundMode === 'media' && props.mediaPicker}
    <button onClick={() => props.onBackgroundModeCommit('media')}>Media category</button>
  </div>,
}));
vi.mock('./ModeControls', () => ({ MediaControls: ({ onLocalSelect }: { onLocalSelect: (id: string) => void }) =>
  <button onClick={() => onLocalSelect('clip-one')}>Local clip</button> }));

describe('shared lighting Audio Trigger editor', () => {
  const stateFor = () => ({ ...BASE_DEFAULTS, params: {} });
  it('uses the background editor with only the two inapplicable appearance controls hidden', () => {
    render(<AudioTriggerLookEditor value={{ mode: 'static', color: '#123456' }} onChange={vi.fn()} stateFor={stateFor} />);
    expect(JSON.parse(screen.getByLabelText('Lighting editor contract').textContent!)).toEqual({
      hideAppearance: true, hideSensors: true, localAudio: true, independent: true, media: true,
    });
  });
  it('keeps colour, shader controls and media picks in local snapshots', () => {
    const onChange = vi.fn();
    const { rerender } = render(<AudioTriggerLookEditor value={{ mode: 'static', color: '#123456' }} onChange={onChange} stateFor={stateFor} />);
    fireEvent.click(screen.getByText('Solid red'));
    expect(onChange).toHaveBeenLastCalledWith({ mode: 'static', color: '#ff0000' });
    fireEvent.click(screen.getByText('Plasma gallery'));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ mode: 'animate', effect: 'plasma' }));
    rerender(<AudioTriggerLookEditor value={{ mode: 'animate', effect: 'plasma', state: stateFor() }} onChange={onChange} stateFor={stateFor} />);
    fireEvent.click(screen.getByText('Zoom snapshot'));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ state: expect.objectContaining({ params: { u_background_zoom: 2 } }) }));
    fireEvent.click(screen.getByText('Media category'));
    rerender(<AudioTriggerLookEditor value={{ mode: 'media', mediaId: 'clip-one' }} onChange={onChange} stateFor={stateFor} />);
    fireEvent.click(screen.getByText('Local clip'));
    expect(onChange).toHaveBeenLastCalledWith({ mode: 'media', mediaId: 'clip-one' });
  });
});


describe('local background draft memory', () => {
  it('retains preset slot and effect across its own snapshots and category switches', () => {
    function Harness() {
      const [value, setValue] = useState<LightingAudioTriggerLook>({ mode: 'animate', effect: 'rainbow', state: { ...BASE_DEFAULTS, params: {} } });
      return <AudioTriggerLookEditor value={value} onChange={setValue} stateFor={() => ({ ...BASE_DEFAULTS, params: {} })} />;
    }
    render(<Harness />);
    fireEvent.click(screen.getByText('Plasma gallery'));
    fireEvent.click(screen.getByText('Preset three'));
    expect(screen.getByLabelText('Preset slot')).toHaveTextContent('2');
    fireEvent.click(screen.getByText('Media category'));
    fireEvent.click(screen.getByText('Animations category'));
    expect(screen.getByLabelText('Preset slot')).toHaveTextContent('2');
    expect(screen.getByLabelText('Draft effect')).toHaveTextContent('plasma');
  });
  it('produces complete snapshots when switching categories without another gallery pick', () => {
    const onChange = vi.fn();
    const { rerender } = render(<AudioTriggerLookEditor value={{ mode: 'static', color: '#123456' }} onChange={onChange}
      stateFor={() => ({ ...BASE_DEFAULTS, params: {} })} />);
    fireEvent.click(screen.getByText('Animations category'));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ mode: 'animate', effect: 'plasma', state: expect.any(Object) }));
    rerender(<AudioTriggerLookEditor value={{ mode: 'media', mediaId: 'clip-one' }} onChange={onChange}
      stateFor={() => ({ ...BASE_DEFAULTS, params: {} })} />);
    fireEvent.click(screen.getByText('Solid category'));
    expect(onChange).toHaveBeenLastCalledWith({ mode: 'static', color: '#7f1d1d' });
  });
  it('keeps stored static patterns still and hides their ineffective Speed control', () => {
    render(<AudioTriggerLookEditor value={{ mode: 'static', effect: 'checker', state: { ...BASE_DEFAULTS, params: {} } }}
      onChange={vi.fn()} stateFor={() => ({ ...BASE_DEFAULTS, params: {} })} />);
    expect(screen.getByLabelText('Static controls')).toHaveTextContent('true');
  });
});
