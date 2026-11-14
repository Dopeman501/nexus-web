import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BackgroundMediaPicker } from './BackgroundMediaPicker';
import { I18nProvider } from '../../lib/i18n';
import en from '../../locales/en.json';

vi.mock('./useBackgroundMedia', () => ({
  useBackgroundMedia: () => ({ items: [], thumbs: {}, refresh: vi.fn(), removeLocal: vi.fn() }),
}));

const slideshow = { enabled: true, interval: 30, shuffle: false, finishVideos: true };

describe('slideshow picture transition placement', () => {
  it('leaves transitions to the single shared background row', () => {
    const onSelect = vi.fn(), onSlideshowChange = vi.fn();
    render(<I18nProvider initialLanguage="en" initialTranslations={en}>
      <BackgroundMediaPicker deviceId="one" activeId={null} deviceAspect={1} deviceW={720} deviceH={720}
        slideshow={slideshow} onSelect={onSelect} onSlideshowChange={onSlideshowChange} />
    </I18nProvider>);
    expect(screen.queryByRole('button', { name: 'Transitions' })).toBeNull();
    expect(onSelect).not.toHaveBeenCalled();
    expect(onSlideshowChange).not.toHaveBeenCalled();
  });

  it.each(['off', 'no-slideshow', 'legacy'] as const)('hides transitions for %s media controls', mode => {
    render(<I18nProvider initialLanguage="en" initialTranslations={en}>
      <BackgroundMediaPicker deviceId="one" activeId={null} deviceAspect={1} deviceW={720} deviceH={720}
        slideshow={mode === 'no-slideshow' ? undefined : { ...slideshow, enabled: mode !== 'off' }}
        onSelect={vi.fn()} onSlideshowChange={vi.fn()} />
    </I18nProvider>);
    expect(screen.queryByRole('button', { name: 'Slideshow transition' })).toBeNull();
  });
});
