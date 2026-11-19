import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PanelLayout, PanelSurface, PanelWidgetSize } from './types';

// The whole path from a tile's opaque report to the background: the gallery
// tile reports through the grid's provider, PanelApp resolves the single
// widget a Kraken shows, and the shader is told it is covered. Only the
// transport and the shader's WebGL are mocked.
const fetchMock = vi.fn();
const shaderCovered: boolean[] = [];
const shaderCapture: boolean[] = [];
const shaderPaused: boolean[] = [];
const sleepFrame = vi.hoisted(() => ({ asleep: false, request: () => {}, faded: () => {}, wakeStart: () => {}, wake: () => {} }));
vi.mock('./chrome/PanelControlCenter', () => ({ PanelControlCenter: ({ onScreenSleep }: { onScreenSleep: () => void }) => {
  sleepFrame.request = onScreenSleep;
  return null;
} }));
vi.mock('./chrome/PanelScreenSleep', () => ({ PanelScreenSleep: (props: {
  asleep: boolean; onSleepFaded(): void; onWakeStart(): void; onWake(): void;
}) => {
  Object.assign(sleepFrame, { asleep: props.asleep, faded: props.onSleepFaded, wakeStart: props.onWakeStart, wake: props.onWake });
  return null;
} }));
const environment = vi.hoisted(() => ({ connected: false, local: true }));
vi.mock('./background/panelAudio', async importOriginal => ({
  ...await importOriginal<typeof import('./background/panelAudio')>(),
  isLocalPanelClient: () => environment.local,
}));
const audioTrigger = vi.hoisted(() => ({ choice: null as null | { mode: 'solid'; color: string }, enabled: [] as boolean[] }));
const audioPreview = vi.hoisted(() => ({ choice: null as null | { mode: 'solid'; color: string } }));
vi.mock('./background/useAudioTriggerPreview', () => ({ useAudioTriggerPreview: (_id: unknown, enabled: boolean) => enabled ? audioPreview.choice : null }));
vi.mock('./background/useAudioTrigger', () => ({ useAudioTrigger: (_settings: unknown, enabled: boolean) => {
  audioTrigger.enabled.push(enabled);
  return enabled ? audioTrigger.choice : null;
} }));

vi.mock('../api/panel', async importOriginal => ({
  ...await importOriginal<typeof import('../api/panel')>(),
  fetchPanelDeviceWithStatus: (...args: unknown[]) => fetchMock(...args),
  patchPanelDeviceWithStatus: vi.fn(async () => ({ ok: true, record: null })),
  patchPanelDevice: vi.fn(async () => null),
}));

vi.mock('../api/gallery', async importOriginal => ({
  ...await importOriginal<typeof import('../api/gallery')>(),
  fetchGalleryItems: vi.fn(async () => ({
    items: [{ id: 'a', name: 'a.jpg', sourceId: 'src-1', kind: 'image' }],
    playlists: [],
  })),
}));

vi.mock('../api/service', async importOriginal => ({
  ...await importOriginal<typeof import('../api/service')>(),
  fetchServiceBlob: vi.fn(async () => new Blob(['img'])),
}));

vi.mock('../hooks/useMultiplexSocket', async importOriginal => ({
  ...await importOriginal<typeof import('../hooks/useMultiplexSocket')>(),
  useMultiplex: () => environment.connected ? { connected: true } : null,
  useTopic: () => null,
  useTopicCallback: () => {},
}));

vi.mock('./engine/panelSync', () => ({
  broadcastLayoutChanged: vi.fn(),
  onLayoutChanged: () => () => {},
}));

vi.mock('./background/PanelBackgroundShader', () => ({
  PanelBackgroundShader: ({ covered, onMediaReady, renderPaused }: { covered?: boolean; onMediaReady?: unknown; renderPaused?: boolean }) => {
    shaderCovered.push(covered === true);
    shaderCapture.push(typeof onMediaReady === 'function');
    shaderPaused.push(renderPaused === true);
    return null;
  },
}));

import PanelApp from './PanelApp';
import { UiSettingsProvider } from '../hooks/useUiSettings';

function recordWith(surface: PanelSurface, size: PanelWidgetSize, config: Record<string, unknown> = {}) {
  const layout: PanelLayout = {
    layoutSchemaVersion: 2,
    surface,
    activePageId: 'page-1',
    pages: [{ id: 'page-1', widgets: [{ id: 'w-gallery', type: 'gallery', size, col: 0, row: 0, config }] }],
  };
  return {
    id: 'panel-1',
    displayName: 'Panel',
    firstSeenAt: 0,
    lastSeenAt: 0,
    layout,
    backgroundMode: 'shader',
    backdrop: 'theme',
    capabilities: { surface, touch: false, dpi: 100, cssWidth: 640, cssHeight: 640, dpr: 1 },
  };
}

async function mountKiosk() {
  const mounted = render(
    <UiSettingsProvider serviceOnline={true} manageDom={false}>
      <PanelApp deviceId="panel-1" />
    </UiSettingsProvider>,
  );
  await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1_000);
  });
  return mounted;
}

beforeEach(() => {
  audioTrigger.choice = null;
  audioPreview.choice = null;
  audioTrigger.enabled = [];
  environment.connected = false;
  environment.local = true;
  shaderCovered.length = 0;
  shaderCapture.length = 0;
  shaderPaused.length = 0;
  fetchMock.mockReset();
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 404 })));
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

describe('PanelApp cross-channel shader capture eligibility', () => {
  for (const [surface, local] of [['q60', true], ['y70', false]] as const) {
    it(`never installs a cross-channel shader mirror on ${surface} with local=${local}`, async () => {
      environment.connected = true;
      environment.local = local;
      const record = recordWith(surface, '2x2');
      record.layout.pages[0].widgets = [];
      fetchMock.mockResolvedValue({ found: true, record: { ...record,
        backgroundTransitions: { enabled: true, effects: ['gl-transitions:WaterDrop'], durationMs: 800 } } });
      await mountKiosk();
      expect(shaderCapture.length).toBeGreaterThan(0);
      expect(shaderCapture.every(value => !value)).toBe(true);
    });
  }

  for (const enabled of [false, true]) {
    it(`keeps local outgoing shader capture available for initial/New previews with saved trigger enabled=${enabled}`, async () => {
      environment.connected = true;
      const record = recordWith('y70', '2x2');
      record.layout.pages[0].widgets = [];
      fetchMock.mockResolvedValue({ found: true, record: { ...record,
        backgroundAudioTrigger: { enabled, intensity: 50, switchDelay: 0.3, shuffle: false, backgrounds: [] },
        backgroundTransitions: { enabled: true, effects: ['gl-transitions:WaterDrop'], durationMs: 800 } } });
      await mountKiosk();
      expect(shaderCapture.at(-1)).toBe(true);
    });
  }
});

describe('PanelApp render-only sleep wiring', () => {
  for (const circle of [false, true]) {
    it(`continues the ${circle ? 'circle' : 'normal'} shader through fade-in and resumes at wake start`, async () => {
      environment.connected = true;
      const record = recordWith(circle ? 'lcd-wide' : 'y70', '2x2');
      record.layout.pages[0].widgets = [];
      if (circle) Object.assign(record, {
        backgroundMode: 'solid',
        capabilities: { ...record.capabilities, family: 'jungle-leopard-d215' },
        layout: { ...record.layout, d215Panels: { enabled: true, items: [{ id: 'circle-one', type: 'clock', x: 0.5, y: 0.5,
          diameter: 0.5, background: { mode: 'shader', effect: 'plasma' } }] } },
      });
      fetchMock.mockResolvedValue({ found: true, record });
      await mountKiosk();
      expect(shaderPaused.at(-1)).toBe(false);
      act(() => sleepFrame.request());
      expect(sleepFrame.asleep).toBe(true);
      expect(shaderPaused.at(-1)).toBe(false);
      act(() => sleepFrame.faded());
      expect(shaderPaused.at(-1)).toBe(true);
      act(() => sleepFrame.wakeStart());
      expect(sleepFrame.asleep).toBe(true);
      expect(shaderPaused.at(-1)).toBe(false);
      act(() => sleepFrame.wake());
      expect(sleepFrame.asleep).toBe(false);
    });
  }
});

describe('PanelApp Audio Trigger background override', () => {
  it('previews an opaque selected snapshot even when the normal background opacity is zero', async () => {
    fetchMock.mockResolvedValue({ found: true, record: { ...recordWith('lcd-wide', '4x2', { fit: true }), backgroundOpacity: 0 } });
    audioPreview.choice = { mode: 'solid', color: '#00ff00' };
    await mountKiosk();
    await waitFor(() => expect(document.querySelector('[data-audio-trigger-background]')).toHaveStyle({ '--panel-background-solid': '#00ff00' }));
  });

  for (const surface of ['lcd-round', 'lcd-square', 'lcd-wide', 'lcd-portrait', 'monitor', 'y70'] as const) {
    it(`previews the selected background ahead of audio playback on ${surface} and resumes playback on release`, async () => {
      const record = recordWith(surface, '2x2round', { fit: true });
      // Keep this test about an uncovered background on every surface.
      record.layout.pages[0].widgets = [];
      fetchMock.mockResolvedValue({ found: true, record });
      audioTrigger.choice = { mode: 'solid', color: '#ff0000' };
      audioPreview.choice = { mode: 'solid', color: '#00ff00' };
      const mounted = await mountKiosk();
      await waitFor(() => expect(document.querySelector('[data-audio-trigger-background]')).toHaveStyle({ '--panel-background-solid': '#00ff00' }));
      expect(audioTrigger.enabled.at(-1)).toBe(false);
      audioPreview.choice = null;
      mounted.rerender(<UiSettingsProvider serviceOnline={true} manageDom={false}><PanelApp deviceId="panel-1" /></UiSettingsProvider>);
      expect(audioTrigger.enabled.at(-1)).toBe(true);
      expect(document.querySelector('[data-audio-trigger-background]')).toHaveStyle({ '--panel-background-solid': '#ff0000' });
    });
  }

  it('shows the selected audio background and restores the normal renderer without persisting it', async () => {
    fetchMock.mockResolvedValue({ found: true, record: recordWith('lcd-round', '2x2round', { fit: true }) });
    audioTrigger.choice = { mode: 'solid', color: '#ff0000' };
    const mounted = await mountKiosk();
    await waitFor(() => expect(document.querySelector('[data-audio-trigger-background]')).not.toBeNull());
    const before = shaderCovered.length;
    audioTrigger.choice = null;
    mounted.rerender(<UiSettingsProvider serviceOnline={true} manageDom={false}><PanelApp deviceId="panel-1" /></UiSettingsProvider>);
    expect(document.querySelector('[data-audio-trigger-background]')).toBeNull();
    expect(shaderCovered.length).toBeGreaterThan(before);
  });
  it('suspends audio detection under a full opaque widget', async () => {
    fetchMock.mockResolvedValue({ found: true, record: recordWith('lcd-round', '2x2round') });
    audioTrigger.choice = { mode: 'solid', color: '#ff0000' };
    await mountKiosk();
    await waitFor(() => expect(shaderCovered.at(-1)).toBe(true));
    expect(audioTrigger.enabled.at(-1)).toBe(false);
    expect(document.querySelector('[data-audio-trigger-background]')).toBeNull();
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('PanelApp background under an opaque tile', () => {
  it('covers the shader while a photo fills kraken glass', async () => {
    fetchMock.mockResolvedValue({ found: true, record: recordWith('lcd-round', '2x2round') });
    await mountKiosk();
    await waitFor(() => expect(shaderCovered.at(-1)).toBe(true));
    expect(shaderCovered).toContain(false);
  });

  // q60 swaps in its offline clock here: this harness has no live service.
  for (const [surface, size] of [['lcd-square', '2x2'], ['lcd-wide', '4x2']] as const) {
    it(`covers the shader while a photo fills ${surface} glass`, async () => {
      fetchMock.mockResolvedValue({ found: true, record: recordWith(surface, size) });
      await mountKiosk();
      await waitFor(() => expect(shaderCovered.at(-1)).toBe(true));
    });
  }

  it('keeps it drawing while the photo is letterboxed', async () => {
    fetchMock.mockResolvedValue({ found: true, record: recordWith('lcd-round', '2x2round', { fit: true }) });
    await mountKiosk();
    await waitFor(() => expect(document.querySelector('img')).not.toBeNull());
    expect(shaderCovered.length).toBeGreaterThan(0);
    expect(shaderCovered.every(c => !c)).toBe(true);
  });
});

describe('PanelApp Media background with nothing to show', () => {
  it('paints the solid background color rather than the bare backdrop', async () => {
    fetchMock.mockResolvedValue({ found: true, record: { ...recordWith('lcd-round', '2x2round'), backgroundMode: 'media' } });
    await mountKiosk();
    await waitFor(() => expect(document.querySelector('[data-panel-bg-layer]')?.className).toMatch(/backgroundSolid/));
  });

  const withMedia = () => ({
    ...recordWith('lcd-round', '2x2round'),
    backgroundMode: 'media',
    backgroundMediaId: 'm1',
    backgroundMediaType: 'static',
    backgroundFrostLevel: 50,
  });
  const bgImage = () => document.querySelector('img[class*="backgroundMediaContent"]');
  const solidLayer = () => [...document.querySelectorAll('[data-panel-bg-layer]')].find(el => /backgroundSolid/.test(el.className));

  it('shows the solid color without frost when the media fails to load, then retries on a growing delay', async () => {
    fetchMock.mockResolvedValue({ found: true, record: withMedia() });
    await mountKiosk();
    await waitFor(() => expect(bgImage()).not.toBeNull());
    expect(solidLayer()).toBeUndefined();
    expect(document.querySelector('[data-panel-frost]')).not.toBeNull();

    await act(async () => { fireEvent.error(bgImage()!); });
    expect(bgImage()).toBeNull();
    expect(solidLayer()).toBeDefined();
    expect(document.querySelector('[data-panel-frost]')).toBeNull();

    await act(async () => { await vi.advanceTimersByTimeAsync(4_900); });
    expect(bgImage()).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    expect(bgImage()).not.toBeNull();

    // A second failure waits longer before the next attempt.
    await act(async () => { fireEvent.error(bgImage()!); });
    await act(async () => { await vi.advanceTimersByTimeAsync(14_000); });
    expect(bgImage()).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(1_200); });
    expect(bgImage()).not.toBeNull();
  });
});

describe('PanelApp background at 0% opacity', () => {
  const media = (opacity: number) => ({
    ...recordWith('lcd-round', '2x2round'),
    backgroundMode: 'media',
    backgroundMediaId: 'm1',
    backgroundMediaType: 'static',
    backgroundOpacity: opacity,
    backgroundFrostLevel: 50,
  });

  it('mounts no media, shader or frost layer, and mounts them again above 0%', async () => {
    fetchMock.mockResolvedValue({ found: true, record: media(0) });
    await mountKiosk();
    // The record has loaded and the widgets render, so the missing layers are the 0% rule, not a pending load.
    await waitFor(() => expect(document.querySelector('[data-panel-widget-id]')).not.toBeNull());
    expect(document.querySelector('img[class*="backgroundMediaContent"]')).toBeNull();
    expect(document.querySelector('[data-panel-bg-layer]')).toBeNull();
    expect(document.querySelector('[data-panel-frost]')).toBeNull();
    cleanup();
    fetchMock.mockResolvedValue({ found: true, record: media(0.5) });
    await mountKiosk();
    await waitFor(() => expect(document.querySelector('img[class*="backgroundMediaContent"]')).not.toBeNull());
  });

  it('never starts the shader at 0%', async () => {
    fetchMock.mockResolvedValue({ found: true, record: { ...recordWith('lcd-round', '2x2round'), backgroundOpacity: 0 } });
    await mountKiosk();
    await waitFor(() => expect(document.querySelector('[data-panel-widget-id]')).not.toBeNull());
    expect(shaderCovered).toHaveLength(0);
  });
});
