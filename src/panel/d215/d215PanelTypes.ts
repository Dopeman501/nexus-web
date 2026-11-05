import type { PanelConfigValue } from '../types';

/** Centers use canvas fractions; diameter uses a fraction of its short side. */
export interface D215PanelInstance {
  id: string;
  type: string;
  x: number;
  y: number;
  diameter: number;
  config?: Record<string, PanelConfigValue>;
}

export interface D215PanelsState {
  enabled: boolean;
  items: D215PanelInstance[];
}

export const MAX_D215_PANELS = 6;
