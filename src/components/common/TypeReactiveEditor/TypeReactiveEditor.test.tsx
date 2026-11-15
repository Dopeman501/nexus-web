import { render, screen, fireEvent, act, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DEFAULT_KEY_REACTION, type KeyReaction } from '../../../api/keyReactive';
import { publishLedFrame, clearLedFrame } from '../../../lib/ledFrameStore';
import {
  TypeReactiveEditor,
  useTypeReactiveConfig,
  type TypeReactiveEditorProps,
  type TypeReactiveScope,
} from './TypeReactiveEditor';

const api = vi.hoisted(() => ({
  put: vi.fn(),
  press: vi.fn(),
  preview: vi.fn(),
  tunnel: vi.fn(() => false),
}));

vi.mock('../../../api/service', async importOriginal => ({
  ...(await importOriginal<typeof import('../../../api/service')>()),
  isTunnelActive: () => api.tunnel(),
}));

vi.mock('../../../api/keyReactive', async importOriginal => ({
  ...(await importOriginal<typeof import('../../../api/keyReactive')>()),
  putKeyReaction: api.put,
  pressKeyReaction: api.press,
  fetchKeyReactionPreview: api.preview,
}));

const PREVIEW = {
  x: [0, 1], y: [0, 0], width: 2, height: 1, fps: 30, frameCount: 1,
  frames: btoa(String.fromCharCode(255, 0, 0, 0, 255, 0)),
};

const ZONE_PREVIEW = {
  x: Array.from({ length: 10 }, (_, i) => i * 2 + 1), y: Array(10).fill(2.5),
  width: 20, height: 6, fps: 30, frameCount: 1, zoneLighting: true,
  frames: btoa(String.fromCharCode(...Array(30).fill(0))),
};

const ZONE_CAPABILITIES = {
  zoneLighting: true, ledCount: 10,
  supportedEffects: ['fade', 'ripple'] as const,
  keyboardLayouts: ['US', 'UK', 'BR', 'JP'],
};

const STREAM_UP = { connected: true, live: true };
const STREAM_DOWN = { connected: false, live: false };

type HarnessProps = Omit<TypeReactiveEditorProps, 'controller'> & { initialConfig: KeyReaction; scope?: TypeReactiveScope };

/** Host the way the modal and the keeb page do: the hook, then the editor. */
function Harness({ initialConfig, scope, ...props }: HarnessProps) {
  const controller = useTypeReactiveConfig(props.cardId, initialConfig, scope);
  return <TypeReactiveEditor {...props} controller={controller} />;
}

async function renderEditor(
  config: Partial<KeyReaction> = {},
  inputAvailable = true,
  extra: Partial<HarnessProps> = {},
) {
  await act(async () => {
    render(
      <Harness
        cardId="kb1"
        initialConfig={{ ...DEFAULT_KEY_REACTION, enabled: true, ...config }}
        inputAvailable={inputAvailable}
        hardwareKeys={false}
        frameIndex={3}
        stream={STREAM_DOWN}
        {...extra}
      />,
    );
  });
}

const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
const tile = (effect: string) => screen.getByRole('button', { name: `lighting.keyReactions.effects.${effect}.name` });

describe('TypeReactiveEditor', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    // jsdom has no 2d context; the board simply skips drawing.
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    api.put.mockImplementation(async (_id: string, cfg: KeyReaction) => cfg);
    api.press.mockResolvedValue({ ok: true });
    api.preview.mockResolvedValue(PREVIEW);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('custom colour palette', () => {
    it('offers exact black as a preset without writing a legacy colour on mount', async () => {
      await renderEditor({ color: '#123456', enabled: false });
      expect(screen.getByRole('button', { name: '#000000', exact: true })).toHaveAttribute('aria-pressed', 'false');
      await advance(300);
      expect(api.put).not.toHaveBeenCalled();
    });

    it('adds colours in selection order and preserves the remaining reaction settings', async () => {
      await renderEditor({ color: '#ff2d55', enabled: false, speed: 0.75, size: 1.1, background: 'dim' });
      fireEvent.click(screen.getByRole('button', { name: '#0a84ff', exact: true }));
      await advance(300);
      expect(api.put.mock.calls[0][1]).toMatchObject({
        color: '#ff2d55', colors: ['#ff2d55', '#0a84ff'], speed: 0.75, size: 1.1, background: 'dim',
      });
      expect(screen.getByRole('button', { name: '#ff2d55', exact: true })).toHaveAttribute('aria-pressed', 'true');
      expect(screen.getByRole('button', { name: '#0a84ff', exact: true })).toHaveAttribute('aria-pressed', 'true');
    });

    it('removes the first selection and uses the next as the legacy-compatible primary colour', async () => {
      await renderEditor({ color: '#000000', colors: ['#000000', '#0a84ff'], enabled: false });
      fireEvent.click(screen.getByRole('button', { name: '#000000', exact: true }));
      await advance(300);
      expect(api.put.mock.calls[0][1]).toMatchObject({ color: '#0a84ff', colors: ['#0a84ff'] });
    });

    it('flushes the full ordered palette when closed before the debounce fires', async () => {
      const { unmount } = render(<Harness cardId="kb1" initialConfig={DEFAULT_KEY_REACTION}
        inputAvailable hardwareKeys={false} frameIndex={3} stream={STREAM_DOWN} />);
      fireEvent.click(screen.getByRole('button', { name: '#000000', exact: true }));
      unmount();
      await advance(0);
      expect(api.put.mock.calls[0][1]).toMatchObject({ color: '#ff2d55', colors: ['#ff2d55', '#000000'] });
    });

    it('keeps at least one selected colour and leaves its config untouched', async () => {
      await renderEditor({ color: '#ff2d55', enabled: false });
      fireEvent.click(screen.getByRole('button', { name: '#ff2d55', exact: true }));
      await advance(300);
      expect(api.put).not.toHaveBeenCalled();
    });

    it('adds a custom colour only after Add and persists its palette', async () => {
      await renderEditor({ color: '#ff2d55', enabled: false });
      fireEvent.click(screen.getByRole('button', { name: 'lighting.keyReactions.color.addCustom' }));
      fireEvent.change(screen.getByRole('textbox', { name: 'common.hexColor' }), { target: { value: '#123456' } });
      await advance(300);
      expect(api.put).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('button', { name: 'lighting.keyReactions.color.add' }));
      await advance(300);
      expect(api.put.mock.calls[0][1]).toMatchObject({ color: '#ff2d55', colors: ['#ff2d55', '#123456'] });
      expect(screen.getByRole('button', { name: '#123456', exact: true })).toHaveAttribute('aria-pressed', 'true');
    });
  });

  it('renders one toggle button per effect with the stored one pressed', async () => {
    await renderEditor({ effect: 'sparks' });
    const gallery = screen.getByRole('group', { name: 'lighting.keyReactions.effect' });
    expect(within(gallery).getAllByRole('button')).toHaveLength(10);
    expect(tile('sparks')).toHaveAttribute('aria-pressed', 'true');
    expect(tile('ripple')).toHaveAttribute('aria-pressed', 'false');
  });

  it('writes the new effect after the debounce when a tile is picked', async () => {
    await renderEditor({ enabled: false });
    fireEvent.click(tile('lightning'));
    expect(api.put).not.toHaveBeenCalled();
    await advance(300);
    expect(api.put).toHaveBeenCalledTimes(1);
    const [id, body] = api.put.mock.calls[0];
    expect(id).toBe('kb1');
    expect(body).toMatchObject({ effect: 'lightning', enabled: false });
    expect(api.press).not.toHaveBeenCalled();
  });

  it('picking an effect on an enabled board writes it, then fires one press', async () => {
    await renderEditor();
    fireEvent.click(tile('lightning'));
    await advance(0);
    expect(api.put).toHaveBeenCalledTimes(1);
    expect(api.put.mock.calls[0][1]).toMatchObject({ effect: 'lightning' });
    expect(api.press).toHaveBeenCalledTimes(1);
    expect(api.press).toHaveBeenCalledWith('kb1', {});
    expect(api.put.mock.invocationCallOrder[0]).toBeLessThan(api.press.mock.invocationCallOrder[0]);
  });

  it('keeps a failed save pending and retries it on the next flush', async () => {
    api.put.mockResolvedValueOnce(null);
    const { unmount } = render(
      <Harness
        cardId="kb1"
        initialConfig={DEFAULT_KEY_REACTION}
        inputAvailable
        hardwareKeys={false}
        frameIndex={3}
        stream={STREAM_DOWN}
      />,
    );
    fireEvent.click(tile('trace'));
    await advance(300);
    expect(api.put).toHaveBeenCalledTimes(1);
    unmount();
    await advance(0);
    expect(api.put).toHaveBeenCalledTimes(2);
    expect(api.put.mock.calls[1][1]).toMatchObject({ effect: 'trace' });
  });

  it('flushes a pending edit when the editor unmounts inside the debounce window', async () => {
    const { unmount } = render(
      <Harness
        cardId="kb1"
        initialConfig={DEFAULT_KEY_REACTION}
        inputAvailable
        hardwareKeys={false}
        frameIndex={3}
        stream={STREAM_DOWN}
      />,
    );
    fireEvent.click(tile('trace'));
    unmount();
    expect(api.put).toHaveBeenCalledTimes(1);
    expect(api.put.mock.calls[0][1]).toMatchObject({ effect: 'trace' });
  });

  it('hides the colour section for heatmap and shows the heat note', async () => {
    await renderEditor({ effect: 'ripple' });
    expect(screen.getByText('lighting.keyReactions.color.title')).toBeInTheDocument();
    fireEvent.click(tile('heatmap'));
    await advance(0);
    expect(screen.queryByText('lighting.keyReactions.color.title')).toBeNull();
    expect(screen.getByText('lighting.keyReactions.heatNote')).toBeInTheDocument();
  });

  it('the Type reactive row carries its description', async () => {
    await renderEditor();
    expect(screen.getByText('lighting.keyReactions.description')).toBeInTheDocument();
  });

  it('turns the board on from the toggle', async () => {
    await renderEditor({ enabled: false });
    fireEvent.click(screen.getByRole('switch', { name: 'lighting.keyReactions.title' }));
    await advance(300);
    expect(api.put).toHaveBeenCalledTimes(1);
    expect(api.put.mock.calls[0][1]).toMatchObject({ enabled: true });
  });

  it('asks for a click or a key press when typing reaches the board', async () => {
    await renderEditor({}, true);
    expect(screen.getByText('lighting.keyReactions.previewHint')).toBeInTheDocument();
  });

  it('asks only for a click when typing is not detected', async () => {
    await renderEditor({}, false);
    expect(screen.getByText('lighting.keyReactions.previewHintClick')).toBeInTheDocument();
    expect(screen.queryByText('lighting.keyReactions.previewHint')).toBeNull();
  });

  it('counts a board with its own key presses as typing-capable', async () => {
    await renderEditor({}, false, { hardwareKeys: true });
    expect(screen.getByText('lighting.keyReactions.previewHint')).toBeInTheDocument();
  });

  it('fetches the board layout once, not on every look change', async () => {
    await renderEditor({ enabled: false });
    await advance(50);
    expect(api.preview).toHaveBeenCalledTimes(1);
    expect(api.preview.mock.calls[0][1]).toMatchObject({ enabled: true });
    fireEvent.click(tile('fade'));
    await advance(300);
    expect(api.preview).toHaveBeenCalledTimes(1);
  });

  describe('zone keyboards', () => {
    it('requires an explicit physical layout before enabling or requesting a preview', async () => {
      await renderEditor({ enabled: true }, true, ZONE_CAPABILITIES);
      expect(screen.getByRole('switch', { name: 'lighting.keyReactions.title' })).toBeDisabled();
      expect(screen.getByText('lighting.keyReactions.keyboardLayout.required')).toBeInTheDocument();
      expect(screen.getByText('lighting.keyReactions.zoneDescription')).toBeInTheDocument();
      expect(screen.getByRole('radiogroup', { name: 'lighting.keyReactions.keyboardLayout.title' })).toBeInTheDocument();
      expect(api.preview).not.toHaveBeenCalled();
      expect(api.put).not.toHaveBeenCalled();
      expect(api.press).not.toHaveBeenCalled();
    });

    it('shows only supported zone effects and saves the selected region with the next edit', async () => {
      api.preview.mockResolvedValue(ZONE_PREVIEW);
      await renderEditor({ enabled: false }, true, ZONE_CAPABILITIES);
      const gallery = screen.getByRole('group', { name: 'lighting.keyReactions.effect' });
      expect(within(gallery).getAllByRole('button')).toHaveLength(2);
      expect(screen.queryByRole('button', { name: 'lighting.keyReactions.effects.rowSweep.name' })).toBeNull();
      fireEvent.click(screen.getByRole('radio', { name: 'lighting.keyReactions.keyboardLayout.UK' }));
      await advance(0);
      expect(api.preview).toHaveBeenCalledWith('kb1', expect.objectContaining({ keyboardLayout: 'UK', enabled: true }), expect.any(AbortSignal));
      expect(screen.getByRole('switch', { name: 'lighting.keyReactions.title' })).not.toBeDisabled();
      expect(screen.getByRole('button', { name: 'lighting.keyReactions.zonePreviewLabel' })).toHaveAttribute('aria-disabled', 'true');
      fireEvent.click(screen.getByRole('switch', { name: 'lighting.keyReactions.title' }));
      await advance(300);
      expect(api.put).toHaveBeenLastCalledWith('kb1', expect.objectContaining({ keyboardLayout: 'UK', enabled: true }));
      expect(screen.getByText('lighting.keyReactions.zonePreviewHint')).toBeInTheDocument();
    });

    it('aborts stale regional previews and uses the newest region before a save completes', async () => {
      let firstResolve: ((value: typeof PREVIEW) => void) | undefined;
      api.preview.mockImplementationOnce(() => new Promise(resolve => { firstResolve = resolve; }));
      api.preview.mockResolvedValue(ZONE_PREVIEW);
      await renderEditor({ enabled: false, keyboardLayout: 'UK' }, true, ZONE_CAPABILITIES);
      const firstSignal = api.preview.mock.calls[0][2] as AbortSignal;
      fireEvent.click(screen.getByRole('radio', { name: 'lighting.keyReactions.keyboardLayout.JP' }));
      await advance(0);
      expect(firstSignal.aborted).toBe(true);
      expect(api.preview).toHaveBeenLastCalledWith('kb1', expect.objectContaining({ keyboardLayout: 'JP' }), expect.any(AbortSignal));
      await act(async () => { firstResolve?.(PREVIEW); });
      expect(screen.getByRole('button', { name: 'lighting.keyReactions.zonePreviewLabel' })).toHaveAttribute('data-zone-count', '10');
      await advance(300);
      expect(api.put).toHaveBeenLastCalledWith('kb1', expect.objectContaining({ keyboardLayout: 'JP' }));
    });

    it('keeps a newer layout edit when an older save finishes', async () => {
      let finishOldSave: ((value: KeyReaction) => void) | undefined;
      api.put.mockImplementationOnce(() => new Promise(resolve => { finishOldSave = resolve; }));
      await renderEditor({ enabled: false, keyboardLayout: 'US' }, true, ZONE_CAPABILITIES);
      fireEvent.click(screen.getByRole('radio', { name: 'lighting.keyReactions.keyboardLayout.UK' }));
      await advance(300);
      fireEvent.click(screen.getByRole('radio', { name: 'lighting.keyReactions.keyboardLayout.JP' }));
      await act(async () => { finishOldSave?.({ ...DEFAULT_KEY_REACTION, keyboardLayout: 'UK' }); });
      expect(screen.getByRole('radio', { name: 'lighting.keyReactions.keyboardLayout.JP' })).toHaveAttribute('aria-checked', 'true');
      await advance(300);
      expect(api.put).toHaveBeenLastCalledWith('kb1', expect.objectContaining({ keyboardLayout: 'JP' }));
    });
  });

  describe('profile and device scope retirement', () => {
    const epochA = 'a'.repeat(32), epochB = 'b'.repeat(32);
    const props = { cardId: 'kb1', inputAvailable: true, hardwareKeys: false, frameIndex: 3,
      stream: STREAM_DOWN, ...ZONE_CAPABILITIES };

    it('refetches geometry and guards requests after a same-count card projection change', async () => {
      const firstRevision = 'c1:0123456789:000', nextRevision = 'c1:9876543210:001';
      const { rerender } = render(<Harness {...props} initialConfig={{ ...DEFAULT_KEY_REACTION, keyboardLayout: 'UK' }}
        scope={{ key: 'a:kb1', epoch: epochA, layoutRevision: firstRevision }} />);
      await advance(0);
      expect(api.preview).toHaveBeenLastCalledWith('kb1', expect.objectContaining({ keyboardLayout: 'UK' }),
        expect.any(AbortSignal), epochA, firstRevision);
      fireEvent.click(screen.getByRole('radio', { name: 'lighting.keyReactions.keyboardLayout.BR' }));
      const oldSignal = api.preview.mock.calls.at(-1)?.[2] as AbortSignal;
      rerender(<Harness {...props} initialConfig={{ ...DEFAULT_KEY_REACTION, enabled: true, keyboardLayout: 'JP' }}
        scope={{ key: 'a:kb1', epoch: epochA, layoutRevision: nextRevision }} />);
      await advance(300);
      expect(oldSignal.aborted).toBe(true);
      expect(api.put).not.toHaveBeenCalled();
      expect(api.preview).toHaveBeenLastCalledWith('kb1', expect.objectContaining({ keyboardLayout: 'JP' }),
        expect.any(AbortSignal), epochA, nextRevision);
      fireEvent.keyDown(screen.getByRole('button', { name: 'lighting.keyReactions.zonePreviewLabel' }), { key: 'Enter' });
      expect(api.press).toHaveBeenLastCalledWith('kb1', {}, epochA, undefined, nextRevision);
      fireEvent.click(screen.getByRole('radio', { name: 'lighting.keyReactions.keyboardLayout.UK' }));
      await advance(300);
      expect(api.put).toHaveBeenLastCalledWith('kb1', expect.objectContaining({ keyboardLayout: 'UK' }), epochA,
        expect.any(AbortSignal), nextRevision);
    });

    it('cancels an old pending edit and uses fresh config when the profile changes with the same card', async () => {
      const { rerender } = render(<Harness {...props} initialConfig={{ ...DEFAULT_KEY_REACTION, keyboardLayout: 'US' }}
        scope={{ key: 'profile-a:kb1', epoch: epochA }} />);
      fireEvent.click(screen.getByRole('radio', { name: 'lighting.keyReactions.keyboardLayout.UK' }));
      rerender(<Harness {...props} initialConfig={{ ...DEFAULT_KEY_REACTION, keyboardLayout: 'JP' }}
        scope={{ key: 'profile-b:kb1', epoch: epochB }} />);
      await advance(300);
      expect(api.put).not.toHaveBeenCalled();
      expect(screen.getByRole('radio', { name: 'lighting.keyReactions.keyboardLayout.JP' })).toHaveAttribute('aria-checked', 'true');
      fireEvent.click(tile('ripple'));
      await advance(300);
      expect(api.put).toHaveBeenLastCalledWith('kb1', expect.objectContaining({ keyboardLayout: 'JP' }), epochB, expect.any(AbortSignal));
    });

    it('retires a pending palette save and open custom draft on a same-card profile change', async () => {
      const { rerender } = render(<Harness {...props}
        initialConfig={{ ...DEFAULT_KEY_REACTION, color: '#000000', keyboardLayout: 'UK' }}
        scope={{ key: 'a:kb1', epoch: epochA }} />);
      fireEvent.click(screen.getByRole('button', { name: '#0a84ff', exact: true }));
      fireEvent.click(screen.getByRole('button', { name: 'lighting.keyReactions.color.addCustom' }));
      fireEvent.change(screen.getByRole('textbox', { name: 'common.hexColor' }), { target: { value: '#123456' } });
      rerender(<Harness {...props}
        initialConfig={{ ...DEFAULT_KEY_REACTION, color: '#ffffff', keyboardLayout: 'UK', colors: ['#ffffff', '#ff2d55'] }}
        scope={{ key: 'b:kb1', epoch: epochB }} />);
      await advance(300);
      expect(api.put).not.toHaveBeenCalled();
      expect(screen.queryByRole('textbox')).toBeNull();
      expect(screen.getByRole('button', { name: '#ffffff', exact: true })).toHaveAttribute('aria-pressed', 'true');
      expect(screen.getByRole('button', { name: '#0a84ff', exact: true })).toHaveAttribute('aria-pressed', 'false');
      fireEvent.click(screen.getByRole('button', { name: '#000000', exact: true }));
      await advance(300);
      expect(api.put).toHaveBeenLastCalledWith('kb1', expect.objectContaining({ colors: ['#ffffff', '#ff2d55', '#000000'] }), epochB, expect.any(AbortSignal));
    });

    it('aborts old writes and ignores their completion after a profile switch', async () => {
      let finishOldSave: ((value: KeyReaction) => void) | undefined;
      api.put.mockImplementationOnce(() => new Promise(resolve => { finishOldSave = resolve; }));
      const { rerender } = render(<Harness {...props} initialConfig={{ ...DEFAULT_KEY_REACTION, keyboardLayout: 'US' }}
        scope={{ key: 'profile-a:kb1', epoch: epochA }} />);
      fireEvent.click(screen.getByRole('radio', { name: 'lighting.keyReactions.keyboardLayout.UK' }));
      await advance(300);
      const oldSignal = api.put.mock.calls[0][3] as AbortSignal;
      rerender(<Harness {...props} initialConfig={{ ...DEFAULT_KEY_REACTION, keyboardLayout: 'JP' }}
        scope={{ key: 'profile-b:kb1', epoch: epochB }} />);
      expect(oldSignal.aborted).toBe(true);
      await act(async () => { finishOldSave?.({ ...DEFAULT_KEY_REACTION, keyboardLayout: 'UK' }); });
      expect(screen.getByRole('radio', { name: 'lighting.keyReactions.keyboardLayout.JP' })).toHaveAttribute('aria-checked', 'true');
    });

    it('drops an old modal draft on scope retirement instead of flushing it during unmount', async () => {
      let activeProfile = 'a';
      const { unmount } = render(<Harness {...props} initialConfig={{ ...DEFAULT_KEY_REACTION, keyboardLayout: 'US' }}
        scope={{ key: 'a:kb1', epoch: epochA, isCurrent: () => activeProfile === 'a' }} />);
      fireEvent.click(screen.getByRole('radio', { name: 'lighting.keyReactions.keyboardLayout.UK' }));
      activeProfile = 'b';
      unmount();
      await advance(300);
      expect(api.put).not.toHaveBeenCalled();
    });

    it('still flushes a normal same-profile unmount with the captured server epoch', async () => {
      const { unmount } = render(<Harness {...props} initialConfig={{ ...DEFAULT_KEY_REACTION, keyboardLayout: 'US' }}
        scope={{ key: 'a:kb1', epoch: epochA, isCurrent: () => true }} />);
      fireEvent.click(screen.getByRole('radio', { name: 'lighting.keyReactions.keyboardLayout.UK' }));
      unmount();
      await advance(0);
      expect(api.put).toHaveBeenCalledWith('kb1', expect.objectContaining({ keyboardLayout: 'UK' }), epochA, expect.any(AbortSignal));
      expect((api.put.mock.calls[0][3] as AbortSignal).aborted).toBe(false);
    });

    it('serializes writes within a profile and sends only the latest queued layout', async () => {
      let finishFirst: ((value: KeyReaction) => void) | undefined;
      api.put.mockImplementationOnce(() => new Promise(resolve => { finishFirst = resolve; }));
      render(<Harness {...props} initialConfig={{ ...DEFAULT_KEY_REACTION, keyboardLayout: 'US' }}
        scope={{ key: 'a:kb1', epoch: epochA }} />);
      fireEvent.click(screen.getByRole('radio', { name: 'lighting.keyReactions.keyboardLayout.UK' }));
      await advance(300);
      fireEvent.click(screen.getByRole('radio', { name: 'lighting.keyReactions.keyboardLayout.BR' }));
      await advance(300);
      fireEvent.click(screen.getByRole('radio', { name: 'lighting.keyReactions.keyboardLayout.JP' }));
      await advance(300);
      expect(api.put).toHaveBeenCalledTimes(1);
      await act(async () => { finishFirst?.({ ...DEFAULT_KEY_REACTION, keyboardLayout: 'UK' }); });
      expect(api.put).toHaveBeenCalledTimes(2);
      expect(api.put).toHaveBeenLastCalledWith('kb1', expect.objectContaining({ keyboardLayout: 'JP' }), epochA, expect.any(AbortSignal));
    });
  });

  describe('live LEDs', () => {
    const mode = () => (screen.getByRole('button', { name: 'lighting.keyReactions.previewLabel' }).hasAttribute('data-live') ? 'live' : 'unlit');
    // Two LEDs, matching the preview fixture.
    const section = (index: number) => new Map([[index, new Uint8Array([9, 9, 9, 8, 8, 8])]]);
    const publish = (devices: Map<number, Uint8Array>) => act(async () => {
      publishLedFrame(new Uint8Array(3), 1, 1, devices);
      await vi.advanceTimersByTimeAsync(40);
    });

    beforeEach(() => { api.tunnel.mockReturnValue(false); });
    afterEach(() => { act(() => clearLedFrame()); });

    it('shows unlit keys with no stream', async () => {
      await renderEditor();
      await advance(300);
      expect(mode()).toBe('unlit');
    });

    it('shows the stream once the card section arrives, and unlit keys when it leaves', async () => {
      await renderEditor({}, true, { stream: STREAM_UP });
      await advance(300);
      expect(mode()).toBe('unlit');
      await publish(section(3));
      expect(mode()).toBe('live');
      await publish(section(9));
      expect(mode()).toBe('unlit');
    });

    it('shows the stream while the board is off too', async () => {
      await renderEditor({ enabled: false }, true, { stream: STREAM_UP });
      await advance(300);
      await publish(section(3));
      expect(mode()).toBe('live');
    });

    it('has no stream over relay even with frames', async () => {
      api.tunnel.mockReturnValue(true);
      await renderEditor({}, true, { stream: STREAM_UP });
      await advance(300);
      await publish(section(3));
      expect(mode()).toBe('unlit');
    });
  });
});
