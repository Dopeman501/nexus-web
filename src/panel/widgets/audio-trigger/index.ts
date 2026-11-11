import type { AppManifest } from '../types';
import { AudioTriggerGlyph } from './AudioTriggerGlyph';
import { AudioTriggerWidget, AudioTriggerTouch } from './AudioTriggerWidget';

export const audioTriggerApp: AppManifest = {
  meta: {
    type: 'audio-trigger', i18nKey: 'panel.widget.audio-trigger', icon: AudioTriggerGlyph,
    sizes: ['2x2', '4x2', '4x4'], defaultSize: '4x2',
    supportsImmersive: { portrait: true, landscape: true },
    hasConfig: false, touch: true,
    surfaces: ['desktop', 'y70', 'monitor', 'phone'],
  },
  Widget: AudioTriggerWidget, Touch: AudioTriggerTouch,
};
