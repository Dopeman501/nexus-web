import { AudioTriggerGlyph } from '../../audio-trigger/AudioTriggerGlyph';

/** Lighting keeps its compact default size while sharing the widget's reference glyph. */
export function AudioTriggerIcon({ size = 14 }: { size?: number | string }) {
  return <AudioTriggerGlyph size={size} />;
}
