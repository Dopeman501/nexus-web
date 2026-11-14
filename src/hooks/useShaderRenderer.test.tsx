import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useShaderRenderer } from './useShaderRenderer';
import type { EffectState } from '../types/lighting';
import { fetchShaderSource } from '../api/lighting';

vi.mock('../api/lighting', () => ({
  fetchShaderSource: vi.fn(async () => ({ frag: 'void main() {}', params: [], sensors: [] })),
  onShaderSourceInvalidated: () => () => {},
}));

function fakeGl() {
  const noop = vi.fn();
  return new Proxy({ createShader: () => ({}), createProgram: () => ({}), getShaderParameter: () => true, getProgramParameter: () => true } as Record<string, unknown>, {
    get: (t, k: string) => (k in t ? t[k] : /^[A-Z_0-9]+$/.test(k) ? 1 : noop),
  });
}

describe('useShaderRenderer', () => {
  let frames: FrameRequestCallback[];

  beforeEach(() => {
    frames = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('stops drawing without throwing when the canvas is detached mid-loop', async () => {
    const canvas = document.createElement('canvas');
    vi.spyOn(canvas, 'getContext').mockReturnValue(fakeGl() as unknown as WebGL2RenderingContext);
    const canvasRef = { current: canvas as HTMLCanvasElement | null };
    const stateRef = { current: { params: {} } as unknown as EffectState };
    renderHook(() => useShaderRenderer(canvasRef, 'fx', stateRef));
    await waitFor(() => expect(frames.length).toBe(1));

    frames[0](16);
    expect(frames.length).toBe(2);

    canvasRef.current = null;
    expect(() => frames[1](32)).not.toThrow();
    expect(frames.length).toBe(2);
  });

  it('captures synchronously after real draws without recompiling when the callback changes', async () => {
    const calls: string[] = [];
    const gl = fakeGl();
    gl.drawArrays = () => calls.push('draw');
    const canvas = document.createElement('canvas');
    vi.spyOn(canvas, 'getContext').mockReturnValue(gl as unknown as WebGL2RenderingContext);
    const canvasRef = { current: canvas };
    const stateRef = { current: { params: {} } as unknown as EffectState };
    const onDrawRef = { current: () => { calls.push('capture'); } };
    const { rerender, unmount } = renderHook(() => useShaderRenderer(canvasRef, 'fx', stateRef, undefined, { onDrawRef }));
    await waitFor(() => expect(frames.length).toBe(1));
    const requests = vi.mocked(fetchShaderSource).mock.calls.length;
    act(() => frames[0](16));
    expect(calls).toEqual(['draw', 'capture']);
    onDrawRef.current = () => { calls.push('replacement'); };
    rerender();
    expect(vi.mocked(fetchShaderSource).mock.calls.length).toBe(requests);
    act(() => frames[1](32));
    expect(calls.slice(-2)).toEqual(['draw', 'replacement']);
    unmount();
    const before = calls.length;
    frames.at(-1)?.(48);
    expect(calls).toHaveLength(before);
  });

  it('isolates a broken observer while drawing continues and retries a changed observer', async () => {
    const draw = vi.fn(); const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const gl = fakeGl(); gl.drawArrays = draw;
    const canvas = document.createElement('canvas');
    vi.spyOn(canvas, 'getContext').mockReturnValue(gl as unknown as WebGL2RenderingContext);
    const canvasRef = { current: canvas };
    const stateRef = { current: { params: {} } as unknown as EffectState };
    const failed = vi.fn(() => { throw new Error('capture failed'); });
    const onDrawRef = { current: failed };
    renderHook(() => useShaderRenderer(canvasRef, 'fx', stateRef, undefined, { onDrawRef }));
    await waitFor(() => expect(frames.length).toBe(1));
    act(() => frames[0](16)); act(() => frames[1](32));
    expect(draw).toHaveBeenCalledTimes(2);
    expect(failed).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledOnce();
    const replacement = vi.fn(); onDrawRef.current = replacement;
    act(() => frames[2](48));
    expect(replacement).toHaveBeenCalledWith(canvas);
  });
});
