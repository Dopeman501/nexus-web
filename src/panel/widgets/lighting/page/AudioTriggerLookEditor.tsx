import { useRef } from 'react';
import type { LightingAudioTriggerLook } from '../../../../api/lightingAudioTrigger';
import type { EffectState } from '../../../../types/lighting';
import { AudioBackgroundEditor } from '../../../background/AudioTriggerSettings';
import type { D215PanelBackground } from '../../../d215/d215PanelBackground';
import { MediaControls } from './ModeControls';

const PREVIEW_THEME = 'dark';

/** Adapts isolated lighting snapshots to the exact editor used by Audio Trigger backgrounds. */
export function AudioTriggerLookEditor({ value, onChange, stateFor }: {
  value: LightingAudioTriggerLook;
  onChange: (look: LightingAudioTriggerLook) => void;
  stateFor: (effect: string) => EffectState;
}) {
  const readBackground = (value: LightingAudioTriggerLook): D215PanelBackground => ({
    mode: value.mode === 'media' ? 'media' : value.color ? 'solid' : 'shader',
    color: value.color ?? '#7f1d1d', colorLight: value.color ?? '#7f1d1d',
    effect: value.effect ?? 'plasma', template: 0,
    effectState: { ...(value.state ?? stateFor(value.effect ?? 'plasma')), ...(value.mode === 'static' && !value.color ? { speed: 0 } : {}) },
    mediaId: value.mediaId ?? null, mediaType: value.mediaId ? 'animated' : null,
  });
  const source = useRef(value);
  const emitted = useRef<LightingAudioTriggerLook | null>(null);
  const background = useRef(readBackground(value));
  if (source.current !== value) {
    source.current = value;
    // Our own snapshot serialization omits category memory and the local preset slot.
    // Keep those until the caller supplies a genuinely different edit target.
    if (value !== emitted.current) background.current = readBackground(value);
  }
  const publish = (look: LightingAudioTriggerLook) => { emitted.current = look; onChange(look); };
  const change = (next: D215PanelBackground) => {
    background.current = next;
    if (next.mode === 'media') {
      publish({ mode: 'media', ...(next.mediaId ? { mediaId: next.mediaId } : {}) });
    } else if (next.mode === 'solid') {
      publish({ mode: 'static', color: next.color });
    } else {
      const state = next.effectState ?? stateFor(next.effect ?? 'plasma');
      // The receiving contract owns no sensor bindings or universal preset slots.
      const snapshot = { speed: state.speed, intensity: state.intensity, hue: state.hue, colorize: state.colorize,
        saturation: state.saturation, contrast: state.contrast, params: { ...state.params } };
      publish({ mode: value.mode === 'static' && !value.color && next.effect === value.effect ? 'static' : 'animate',
        effect: next.effect, state: structuredClone(snapshot) });
    }
  };
  return <AudioBackgroundEditor background={background.current} onChange={change} themeMode={PREVIEW_THEME} deviceAspect={160 / 90}
    hideBackgroundAppearanceControls hideSensorBindings independentAudioPreview staticEffect={value.mode === 'static' && !value.color}
    mediaPicker={<MediaControls keepMode={false} localActiveId={background.current.mediaId ?? null}
      onLocalSelect={mediaId => change({ ...background.current, mode: 'media', mediaId, mediaType: mediaId ? 'animated' : null })} />} />;
}
