// Type reactive API wrapper - per-key keyboard lighting that reacts to key presses.

import { fetchService, postService, putService } from './service';

export type KeyReactionEffect =
  | 'fade' | 'rowSweep' | 'columnSweep' | 'ripple' | 'crosshair'
  | 'starburst' | 'heatmap' | 'sparks' | 'lightning' | 'trace';
export type KeyReactionColorMode = 'custom' | 'rainbow' | 'random';
export type KeyReactionBackground = 'effect' | 'dim' | 'dark' | 'reveal';

export interface KeyReaction {
  enabled: boolean;
  effect: KeyReactionEffect;
  colorMode: KeyReactionColorMode;
  /** '#rrggbb' */
  color: string;
  /** Selected custom colours, in per-press cycle order; absent uses color. */
  colors?: string[];
  /** Time multiplier. */
  speed: number;
  /** Reach multiplier. */
  size: number;
  background: KeyReactionBackground;
  /** Explicit physical layout for zone keyboards; absent on per-key boards. */
  keyboardLayout?: string | null;
}

export const DEFAULT_KEY_REACTION: KeyReaction = {
  enabled: false,
  effect: 'ripple',
  colorMode: 'custom',
  color: '#ff2d55',
  speed: 1,
  size: 1,
  background: 'effect',
};

export interface KeyReactiveDevice {
  /** Lighting card id; the press, preview and PUT routes take it. */
  id: string;
  /** Physical device the config is stored under; cards of one device share it. */
  deviceId: string;
  /** The card's device index byte in the lighting output frame stream. */
  frameIndex: number;
  /** The device reports its own key presses and ignores OS keystrokes. */
  hardwareKeys: boolean;
  ledCount: number;
  namedKeys: number;
  /** Each output slot controls a shared lighting region rather than one key. */
  zoneLighting?: boolean;
  supportedEffects?: KeyReactionEffect[];
  /** Explicit physical layouts offered by a zone keyboard. */
  keyboardLayouts?: string[];
  /** Current card projection/disabled-zone signature; absent on per-key boards. */
  layoutRevision?: string | null;
  config: KeyReaction;
}

export interface KeyReactiveState {
  /** Runtime profile generation captured with every listed config. */
  epoch?: string;
  /** A real key source is live (the user-session helper is connected). */
  inputAvailable: boolean;
  devices: KeyReactiveDevice[];
}

export interface KeyReactionPreview {
  /** LED centres in key units from the board's top-left. */
  x: number[];
  y: number[];
  width: number;
  height: number;
  fps: number;
  frameCount: number;
  /** Base64 of frameCount frames, each ledCount * 3 RGB bytes. */
  frames: string;
  zoneLighting?: boolean;
}

export interface KeyPressBody {
  key?: string | null;
  led?: number | null;
}

const path = (id: string, suffix = '', epoch?: string, layoutRevision?: string) => {
  const query = new URLSearchParams();
  if (epoch !== undefined) query.set('expectedEpoch', epoch);
  if (layoutRevision !== undefined) query.set('expectedLayoutRevision', layoutRevision);
  return `/lighting/key-reactive/${encodeURIComponent(id)}${suffix}${query.size ? `?${query}` : ''}`;
};

export function fetchKeyReactive(signal?: AbortSignal): Promise<KeyReactiveState | null> {
  return signal ? fetchService<KeyReactiveState>('/lighting/key-reactive', signal) : fetchService<KeyReactiveState>('/lighting/key-reactive');
}

export function putKeyReaction(id: string, config: KeyReaction, epoch?: string, signal?: AbortSignal, layoutRevision?: string): Promise<KeyReaction | null> {
  return signal ? putService<KeyReaction>(path(id, '', epoch, layoutRevision), config, signal) : putService<KeyReaction>(path(id, '', epoch, layoutRevision), config);
}

export function pressKeyReaction(id: string, body: KeyPressBody, epoch?: string, signal?: AbortSignal, layoutRevision?: string): Promise<{ ok: boolean } | null> {
  return signal ? postService<{ ok: boolean }>(path(id, '/press', epoch, layoutRevision), body, signal) : postService<{ ok: boolean }>(path(id, '/press', epoch, layoutRevision), body);
}

export function fetchKeyReactionPreview(
  id: string,
  config: KeyReaction,
  signal?: AbortSignal,
  epoch?: string,
  layoutRevision?: string,
): Promise<KeyReactionPreview | null> {
  return postService<KeyReactionPreview>(path(id, '/preview', epoch, layoutRevision), config, signal);
}
