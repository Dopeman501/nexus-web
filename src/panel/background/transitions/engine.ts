import type { PictureSource } from './source';
export type { PictureSource } from './source';
/** A renderer owns only the children/resources it adds to its isolated stage. */
export interface TransitionAdapter {
  seek(progress: number): void;
  dispose(): void | Promise<void>;
}
export interface AdapterInput {
  stage: HTMLElement;
  from: PictureSource;
  to: PictureSource;
  signal?: AbortSignal;
}
export type AdapterFactory = (input: AdapterInput) => TransitionAdapter | Promise<TransitionAdapter>;
export const clampProgress = (progress: number): number =>
  Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : 0;
