import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchShaderSource, type ShaderSource } from '../api/lighting';
import { BASE_DEFAULTS } from '../types/lighting';
import { useShaderRenderer } from './useShaderRenderer';

vi.mock('../api/lighting', () => ({
  fetchShaderSource: vi.fn(),
  onShaderSourceInvalidated: () => () => {},
}));

function context() {
  return {
    createVertexArray: vi.fn(() => ({})), createBuffer: vi.fn(() => ({})),
    bindVertexArray: vi.fn(), bindBuffer: vi.fn(), bufferData: vi.fn(),
    enableVertexAttribArray: vi.fn(), vertexAttribPointer: vi.fn(),
    deleteVertexArray: vi.fn(), deleteBuffer: vi.fn(), deleteProgram: vi.fn(),
    createShader: vi.fn(() => ({})), shaderSource: vi.fn(), compileShader: vi.fn(),
    getShaderParameter: vi.fn(() => true), deleteShader: vi.fn(),
    createProgram: vi.fn(() => ({})), attachShader: vi.fn(), linkProgram: vi.fn(),
    getProgramParameter: vi.fn(() => true), getUniformLocation: vi.fn(() => null),
  };
}

describe('shader preview cancellation', () => {
  beforeEach(() => {
    vi.mocked(fetchShaderSource).mockReset();
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it.each(['clear', 'unmount'])('does not compile or restart a late shader after %s', async cancellation => {
    let resolve!: (source: ShaderSource) => void;
    const pending = new Promise<ShaderSource>(accept => { resolve = accept; });
    vi.mocked(fetchShaderSource).mockReturnValue(pending);
    const gl = context();
    const canvas = document.createElement('canvas');
    vi.spyOn(canvas, 'getContext').mockReturnValue(gl as unknown as WebGL2RenderingContext);
    const canvasRef = { current: canvas };
    // Callers may retain their last look while clearing the effect key.
    const stateRef = { current: { ...BASE_DEFAULTS, params: {} } };
    const { rerender, unmount } = renderHook(
      ({ effect }: { effect: string | null }) => useShaderRenderer(canvasRef, effect, stateRef),
      { initialProps: { effect: 'ridgeline' as string | null } },
    );
    expect(fetchShaderSource).toHaveBeenCalledWith('ridgeline');
    if (cancellation === 'clear') rerender({ effect: null });
    else unmount();

    await act(async () => {
      resolve({ frag: 'void main() {}', params: [], sensors: [] });
      await pending;
    });
    expect(gl.createShader).not.toHaveBeenCalled();
    expect(gl.createProgram).not.toHaveBeenCalled();
    expect(requestAnimationFrame).not.toHaveBeenCalled();
  });
});
