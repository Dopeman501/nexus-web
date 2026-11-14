import { describe, expect, it, vi } from 'vitest';
import { createCurtainsAdapter } from '../adapters/curtains';

const unavailable = vi.hoisted(() => ({ render: vi.fn(() => { throw new Error('uninitialized queue'); }), disable: vi.fn() }));
vi.mock('curtainsjs', () => ({
  Curtains: class {
    gl = null;
    canvas = document.createElement('canvas');
    render = unavailable.render;
    disableDrawing = unavailable.disable;
    onError() { return this; }
    onContextLost() { return this; }
    dispose() {}
  },
  Plane: class {},
}));

describe('Curtains sample receiving boundary', () => {
  it('rejects undecoded fixtures before allocating a renderer', async () => {
    const stage = document.createElement('div');
    await expect(createCurtainsAdapter({ stage, from: new Image(), to: new Image() })).rejects.toThrow('decoded');
    expect(stage.children).toHaveLength(0);
  });

  it('rejects canceled setup without scheduling render work', async () => {
    const controller = new AbortController();
    controller.abort();
    const request = vi.spyOn(window, 'requestAnimationFrame');
    await expect(createCurtainsAdapter({ stage: document.createElement('div'), from: new Image(), to: new Image(), signal: controller.signal }))
      .rejects.toThrow('canceled');
    expect(request).not.toHaveBeenCalled();
    request.mockRestore();
  });

  it('settles unavailable WebGL setup without draining an uninitialized callback queue', async () => {
    const stage = document.createElement('div');
    const image = new Image();
    Object.defineProperties(image, { naturalWidth: { value: 100 }, naturalHeight: { value: 100 } });
    await expect(createCurtainsAdapter({ stage, from: image, to: image })).rejects.toThrow('unavailable');
    expect(stage.children).toHaveLength(0);
    expect(unavailable.render).not.toHaveBeenCalled();
    expect(unavailable.disable).not.toHaveBeenCalled();
  });
});
