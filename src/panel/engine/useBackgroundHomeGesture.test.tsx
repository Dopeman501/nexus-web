import { createRef } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useBackgroundHomeGesture } from './useBackgroundHomeGesture';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function mount(enabled = true, resetKey = 'y70:profile:page:home') {
  const rootRef = createRef<HTMLDivElement>();
  const onHome = vi.fn();
  function Harness(props: { enabled: boolean; resetKey: string }) {
    useBackgroundHomeGesture({ ...props, rootRef, onHome });
    return <div ref={rootRef}>
      <div data-testid="background"><span data-testid="empty-cell" /></div>
      <div data-panel-widget-id="clock"><span data-testid="widget" /></div>
      <button data-testid="button">Control</button>
      <div data-panel-scrollable="true" data-testid="scroll" />
      <div data-panel-hit="true" data-testid="chrome" />
      <div role="tablist"><span data-testid="page-dot" /></div>
      <div contentEditable suppressContentEditableWarning data-testid="editable" />
    </div>;
  }
  const view = render(<Harness enabled={enabled} resetKey={resetKey} />);
  const update = (nextEnabled: boolean, nextKey = resetKey) => view.rerender(<Harness enabled={nextEnabled} resetKey={nextKey} />);
  return { ...view, onHome, update, background: view.getByTestId('background') };
}

type Contact = { id?: number; x?: number; y?: number; time?: number; pointerType?: string; isPrimary?: boolean; button?: number };
function pointer(target: EventTarget, type: string, options: Contact = {}) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    pointerId: { value: options.id ?? 1 },
    clientX: { value: options.x ?? 100 },
    clientY: { value: options.y ?? 200 },
    timeStamp: { value: options.time ?? 0 },
    pointerType: { value: options.pointerType ?? 'touch' },
    isPrimary: { value: options.isPrimary ?? true },
    button: { value: options.button ?? 0 },
  });
  act(() => { target.dispatchEvent(event); });
}

function tap(target: EventTarget, time: number, options: Contact = {}) {
  pointer(target, 'pointerdown', { ...options, time });
  pointer(target, 'pointerup', { ...options, time: time + 40 });
}

describe('empty-background home double tap', () => {
  it.each(['touch', 'mouse', 'pen'])('returns home once for two nearby brief %s taps', pointerType => {
    const { background, getByTestId, onHome } = mount();
    tap(background, 0, { pointerType });
    expect(onHome).not.toHaveBeenCalled();
    tap(getByTestId('empty-cell'), 150, { pointerType, x: 110, y: 205 });
    expect(onHome).toHaveBeenCalledTimes(1);
    // Compatibility click/dblclick events must not invoke the gesture again.
    background.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 2 }));
    background.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, detail: 2 }));
    expect(onHome).toHaveBeenCalledTimes(1);
    tap(background, 250, { pointerType });
    expect(onHome).toHaveBeenCalledTimes(1);
  });

  it('requires a close pair in time and position', () => {
    const { background, onHome } = mount();
    tap(background, 0);
    tap(background, 1_000);
    expect(onHome).not.toHaveBeenCalled();
    tap(background, 1_150, { x: 300 });
    expect(onHome).not.toHaveBeenCalled();
    tap(background, 1_300, { x: 305 });
    expect(onHome).toHaveBeenCalledTimes(1);
  });

  it.each(['widget', 'button', 'scroll', 'chrome', 'editable', 'page-dot'])('never counts or bridges taps on %s', id => {
    const { background, getByTestId, onHome } = mount();
    tap(background, 0);
    tap(getByTestId(id), 100);
    tap(background, 200);
    expect(onHome).not.toHaveBeenCalled();
    tap(getByTestId(id), 300);
    tap(getByTestId(id), 400);
    expect(onHome).not.toHaveBeenCalled();
  });

  it('requires both contact ends on the empty surface', () => {
    const { background, getByTestId, onHome } = mount();
    tap(background, 0);
    pointer(background, 'pointerdown', { time: 100 });
    pointer(getByTestId('widget'), 'pointerup', { time: 140 });
    tap(background, 200);
    expect(onHome).not.toHaveBeenCalled();
    pointer(getByTestId('widget'), 'pointerdown', { time: 300 });
    pointer(background, 'pointerup', { time: 340 });
    expect(onHome).not.toHaveBeenCalled();
  });

  it('rejects a swipe even if its release returns to the start', () => {
    const { background, onHome } = mount();
    tap(background, 0);
    pointer(background, 'pointerdown', { time: 100 });
    pointer(document, 'pointermove', { time: 120, x: 180 });
    pointer(background, 'pointerup', { time: 140 });
    tap(background, 200);
    expect(onHome).not.toHaveBeenCalled();
  });

  it('rejects a hold, right mouse button, and cancelled contact', () => {
    const { background, onHome } = mount();
    pointer(background, 'pointerdown', { time: 0 });
    pointer(background, 'pointerup', { time: 600 });
    tap(background, 700);
    expect(onHome).not.toHaveBeenCalled();
    tap(background, 800, { button: 2, pointerType: 'mouse' });
    tap(background, 900);
    expect(onHome).not.toHaveBeenCalled();
    pointer(background, 'pointerdown', { time: 1_000 });
    pointer(background, 'pointercancel', { time: 1_040 });
    tap(background, 1_100);
    expect(onHome).not.toHaveBeenCalled();
  });

  it('cancels a multitouch sequence, including a second contact outside the panel', () => {
    const { background, onHome } = mount();
    tap(background, 0);
    pointer(background, 'pointerdown', { time: 100 });
    pointer(document.body, 'pointerdown', { time: 110, id: 2, isPrimary: false });
    pointer(document.body, 'pointerup', { time: 120, id: 2, isPrimary: false });
    pointer(background, 'pointerup', { time: 140 });
    tap(background, 200);
    expect(onHome).not.toHaveBeenCalled();
    tap(background, 300);
    expect(onHome).toHaveBeenCalledTimes(1);
  });

  it('clears taps while blocked and when the device/profile/page/home key changes', () => {
    const { background, onHome, update } = mount();
    tap(background, 0);
    update(false);
    tap(background, 100);
    tap(background, 200);
    expect(onHome).not.toHaveBeenCalled();
    update(true);
    tap(background, 300);
    expect(onHome).not.toHaveBeenCalled();
    update(true, 'another-profile');
    tap(background, 400);
    expect(onHome).not.toHaveBeenCalled();
    tap(background, 500);
    expect(onHome).toHaveBeenCalledTimes(1);
  });

  it.each(['blur', 'hidden', 'outside', 'lost-capture'])('clears the current sequence on %s', interruption => {
    const { background, onHome } = mount();
    tap(background, 0);
    if (interruption === 'blur') window.dispatchEvent(new Event('blur'));
    if (interruption === 'hidden') {
      vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
      document.dispatchEvent(new Event('visibilitychange'));
      vi.restoreAllMocks();
    }
    if (interruption === 'outside') tap(document.body, 70);
    if (interruption === 'lost-capture') {
      pointer(background, 'pointerdown', { time: 70 });
      pointer(background, 'lostpointercapture', { time: 80 });
      pointer(background, 'pointerup', { time: 90 });
    }
    tap(background, 100);
    expect(onHome).not.toHaveBeenCalled();
  });

  it('keeps the first tap through normal implicit-capture release after pointerup', () => {
    const { background, onHome } = mount();
    tap(background, 0);
    pointer(background, 'lostpointercapture', { time: 45 });
    tap(background, 150);
    expect(onHome).toHaveBeenCalledTimes(1);
  });

  it('detaches its document listeners when unmounted', () => {
    const { background, onHome, unmount } = mount();
    const retiredRoot = background.parentElement!;
    tap(background, 0);
    unmount();
    // Reattach the retired subtree so stale document listeners would receive
    // the second tap, rather than passing only because the target is detached.
    document.body.append(retiredRoot);
    try {
      tap(background, 100);
      expect(onHome).not.toHaveBeenCalled();
    } finally { retiredRoot.remove(); }
  });
});
