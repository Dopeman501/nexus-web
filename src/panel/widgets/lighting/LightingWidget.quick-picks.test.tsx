import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchCurrentSync, fetchPins, setLightingPaused, setPins, startAnimate } from '../../../api/lighting';
import type { PanelWidget } from '../../types';
import { LightingWidget } from './LightingWidget';

vi.mock('../../../api/lighting', () => ({
  effectThumbnailPath: (key: string) => `/lighting/effects/${key}/thumbnail.bmp`,
  fetchAnimateDefaults: vi.fn(async () => null),
  fetchAnimateSettings: vi.fn(async () => ({ effect: 'rainbow', templates: {} })),
  fetchStaticSettings: vi.fn(async () => ({ effect: 'simplewhite', states: {} })),
  fetchCurrentSync: vi.fn(async () => ({ sync: 'rainbow' })),
  fetchLightingStatus: vi.fn(async () => ({ gpuAvailable: true })),
  fetchScreenEffect: vi.fn(async () => ({})),
  fetchPins: vi.fn(async () => ({})),
  setPins: vi.fn(async () => true),
  setLightingPaused: vi.fn(async () => ({ paused: false })),
  saveAnimateTemplates: vi.fn(async () => ({})),
  startAnimate: vi.fn(async () => ({})),
  startStatic: vi.fn(async () => ({})),
  startScreenMirror: vi.fn(async () => ({})),
  stopLighting: vi.fn(async () => ({})),
}));
const customs = vi.hoisted(() => []);
vi.mock('../../../api/customEffects', async importActual => ({
  ...(await importActual<typeof import('../../../api/customEffects')>()),
  useCustomEffects: () => customs,
  refreshCustomEffects: async () => {},
}));
vi.mock('../../../api/service', () => ({ fetchServiceBlob: vi.fn(async () => null) }));
vi.mock('../../../hooks/useMultiplexSocket', () => ({ useTopicCallback: vi.fn() }));
vi.mock('../../../lib/controlSync', () => ({ publishControlSync: vi.fn(), subscribeControlSync: () => () => {} }));
vi.mock('../../../hooks/useUiSettings', () => ({
  useUiSettings: () => ({ settings: { widgetAdvancedMode: true }, update: vi.fn() }),
  useFeatureFlags: () => ({ lighting: true }),
}));
vi.mock('../../../lib/i18n', () => ({
  useTranslation: () => ({ t: (key: string) => key === 'lighting.mode.off' ? 'Off' : key }),
}));

const lightingWidget = (size: PanelWidget['size']): PanelWidget => ({ id: 'pick', type: 'lighting', size, col: 0, row: 0 });
const renderLighting = (widget: PanelWidget) => render(<LightingWidget widget={widget} onSectionNavigate={() => {}} />);
const waitForMode = (mode: string) => waitFor(() => expect(document.querySelector(`[data-mode="${mode}"]`)).toBeInTheDocument());

  describe('explicit quick picks', () => {
    beforeEach(() => {
      vi.mocked(fetchPins).mockResolvedValue({ card: { kind: 'animate', effect: 'fire' } });
      vi.mocked(setPins).mockClear();
      vi.mocked(setLightingPaused).mockClear();
      vi.mocked(startAnimate).mockClear();
    });

    afterEach(() => { vi.mocked(fetchPins).mockResolvedValue({}); });

    it('releases existing pins after a style starts, without changing pins on arrival', async () => {
      renderLighting(lightingWidget('4x2'));
      await waitForMode('animate');
      expect(setPins).not.toHaveBeenCalled();
      fireEvent.click(document.querySelector('[data-effect-key="rainbow"]')!);
      await waitFor(() => expect(setPins).toHaveBeenCalledWith(['card'], null));
      expect(vi.mocked(startAnimate).mock.invocationCallOrder.at(-1))
        .toBeLessThan(vi.mocked(setPins).mock.invocationCallOrder.at(-1)!);
    });

    it('resumes a paused same-style pick before applying it', async () => {
      vi.mocked(fetchCurrentSync).mockResolvedValueOnce({ sync: 'rainbow', paused: true });
      renderLighting(lightingWidget('4x2'));
      await waitForMode('animate');
      fireEvent.click(document.querySelector('[data-effect-key="rainbow"]')!);
      await waitFor(() => expect(setLightingPaused).toHaveBeenCalledWith(false));
      await waitFor(() => expect(startAnimate).toHaveBeenCalled());
      expect(vi.mocked(setLightingPaused).mock.invocationCallOrder.at(-1))
        .toBeLessThan(vi.mocked(startAnimate).mock.invocationCallOrder.at(-1)!);
    });

    it('keeps pins when the style start is refused', async () => {
      vi.mocked(startAnimate).mockResolvedValueOnce(null);
      renderLighting(lightingWidget('4x2'));
      await waitForMode('animate');
      fireEvent.click(document.querySelector('[data-effect-key="rainbow"]')!);
      await waitFor(() => expect(startAnimate).toHaveBeenCalled());
      await act(async () => {});
      expect(setPins).not.toHaveBeenCalled();
    });

    it('does not start a waiting style after Off is pressed', async () => {
      let release!: () => void;
      vi.mocked(fetchPins).mockImplementationOnce(() => new Promise(resolve => {
        release = () => resolve({ card: { kind: 'animate', effect: 'fire' } });
      }));
      renderLighting(lightingWidget('4x2'));
      await waitForMode('animate');
      fireEvent.click(document.querySelector('[data-effect-key="rainbow"]')!);
      fireEvent.click(screen.getByRole('button', { name: 'Off' }));
      await act(async () => { release(); });
      expect(startAnimate).not.toHaveBeenCalled();
      expect(setPins).not.toHaveBeenCalled();
      await waitForMode('none');
    });

    it('releases existing pins for an explicit colour pick', async () => {
      vi.mocked(fetchCurrentSync).mockResolvedValueOnce({ sync: 'static' });
      renderLighting(lightingWidget('4x2'));
      await waitForMode('static');
      fireEvent.click(document.querySelector('[data-swatch-hex]')!);
      await waitFor(() => expect(setPins).toHaveBeenCalledWith(['card'], null));
    });
  });
