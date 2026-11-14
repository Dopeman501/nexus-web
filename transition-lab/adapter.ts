export const libraryIds = ['gl-transitions', 'codrops', 'curtains', 'motion', 'anime'] as const;
export type LibraryId = typeof libraryIds[number];

/** A sample owns only the children/resources it adds to its isolated stage. */
export interface TransitionAdapter {
  seek(progress: number): void;
  dispose(): void | Promise<void>;
}

export interface AdapterInput {
  stage: HTMLElement;
  from: HTMLImageElement;
  to: HTMLImageElement;
  signal?: AbortSignal;
  /** Register synchronously when pending cleanup needs its DOM realm connected. */
  onPendingDispose?: (dispose: () => Promise<void>) => void;
}

export type AdapterFactory = (input: AdapterInput) => TransitionAdapter | Promise<TransitionAdapter>;

export const clampProgress = (progress: number): number =>
  Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : 0;
