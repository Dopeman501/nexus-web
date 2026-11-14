declare module 'curtainsjs' {
  export class Curtains {
    constructor(options: { container: HTMLElement; autoRender: boolean; watchScroll: boolean; pixelRatio: number; production: boolean });
    canvas: HTMLCanvasElement;
    gl: WebGLRenderingContext | WebGL2RenderingContext | null;
    render(): void;
    resize(): void;
    disableDrawing(): void;
    dispose(): void;
    onError(callback: () => void): this;
    onContextLost(callback: () => void): this;
  }
  export class Plane {
    constructor(curtains: Curtains, element: HTMLElement, options: {
      vertexShader: string; fragmentShader: string; autoloadSources: boolean;
      uniforms: Record<string, { name: string; type: string; value: number }>;
    });
    uniforms: { progress: { value: number } };
    loadImage(source: HTMLImageElement, options: { sampler: string }, success: () => void, failure: () => void): void;
    loadCanvas(source: HTMLCanvasElement, options: { sampler: string }, success: () => void): void;
    onError(callback: () => void): this;
    remove(): void;
  }
}
