import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AudioTriggerBackgroundLayer } from './AudioTriggerBackgroundLayer';
vi.mock('./PanelBackgroundShader', () => ({ PanelBackgroundShader: (props: { effect: string }) => <div data-testid="shader">{props.effect}</div> }));
vi.mock('./PanelBackgroundMedia', () => ({ PanelBackgroundMedia: (props: { id: string; onFailed: () => void }) => <button data-testid="media" onClick={props.onFailed}>{props.id}</button> }));

describe('Audio Trigger selected background rendering', () => {
  it('mounts only the chosen type, preserving its colour, opacity and frost settings', () => {
    const hook = render(<AudioTriggerBackgroundLayer background={{ mode: 'solid', color: '#ff0000', opacity: 0.4 }} themeMode="dark" surface="lcd-wide" deviceId="one" />);
    expect(hook.container.querySelector('[data-audio-trigger-background]')?.getAttribute('style')).toContain('#ff0000');
    expect(hook.container.querySelector('[data-panel-bg-layer]')?.getAttribute('style')).toContain('0.4');
    expect(screen.queryByTestId('shader')).toBeNull();
    hook.rerender(<AudioTriggerBackgroundLayer background={{ mode: 'shader', effect: 'plasma', frost: 50 }} themeMode="dark" surface="lcd-wide" deviceId="one" />);
    expect(screen.getByTestId('shader').textContent).toBe('plasma');
    expect(hook.container.querySelector('[data-panel-frost]')).not.toBeNull();
  });
  it('falls back safely on missing or failed media and removes that failure with the selection', () => {
    const hook = render(<AudioTriggerBackgroundLayer background={{ mode: 'media', mediaId: 'clip', mediaType: 'animated' }} themeMode="dark" surface="lcd-wide" deviceId="one" />);
    fireEvent.click(screen.getByTestId('media'));
    expect(screen.queryByTestId('media')).toBeNull();
    expect(hook.container.querySelector('[data-panel-bg-layer]')).not.toBeNull();
    hook.rerender(<AudioTriggerBackgroundLayer background={{ mode: 'media', mediaId: 'other', mediaType: 'static' }} themeMode="dark" surface="lcd-wide" deviceId="one" />);
    expect(screen.getByTestId('media').textContent).toBe('other');
    hook.unmount();
  });
});
