import type { PanelConfigValue } from '../types';
import type { D215PanelBackground } from './d215PanelBackground';

/** Centers use canvas fractions; diameter uses a fraction of its short side. */
export interface D215PanelInstance {
  id: string;
  type: string;
  x: number;
  y: number;
  diameter: number;
  config?: Record<string, PanelConfigValue>;
  background?: D215PanelBackground;
}

export interface D215PanelsState {
  enabled: boolean;
  /** Absent preserves the legacy visible card fill; false removes circle backgrounds. */
  backgroundsEnabled?: boolean;
  items: D215PanelInstance[];
}

export const MAX_D215_PANELS = 6;
