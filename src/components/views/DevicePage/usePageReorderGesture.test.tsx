import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { useLayoutEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePageReorderGesture, type PageReorderGestureOptions } from './usePageReorderGesture';

const deferred = () => {
  let resolve!: (ok: boolean) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<boolean>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const order = Array.from({ length: 10 }, (_, index) => `p${index}`);
const base = {
  enabled: true, ownerKey: 'profile:y70', pageId: 'p0', pageIds: order, frameWidth: 100,
  bounds: { left: 0, right: 600, top: 0, bottom: 800 }, reducedMotion: false,
};
function mount(overrides: Partial<PageReorderGestureOptions> = {}) {
  const onCommit = vi.fn().mockResolvedValue(true), onBusyChange = vi.fn();
  let api!: ReturnType<typeof usePageReorderGesture>;
  function Harness(props: Partial<PageReorderGestureOptions>) {
    const value = usePageReorderGesture({ ...base, onCommit, onBusyChange, ...props });
    useLayoutEffect(() => { api = value; });
    return <>
      {(['left', 'right'] as const).map(corner => <button key={corner} data-testid={corner}
        onPointerDown={event => value.onPointerDown(event, corner)} onPointerMove={value.onPointerMove}
        onPointerUp={value.onPointerUp} onPointerCancel={value.onPointerCancel} onLostPointerCapture={value.onLostPointerCapture}
        onKeyDown={event => value.onKeyDown(event, corner)}>Grab</button>)}
    </>;
  }
  const view = render(<Harness {...overrides} />);
  const left = view.getByTestId('left'), right = view.getByTestId('right');
  const capture = vi.fn(), release = vi.fn();
  for (const button of [left, right]) {
    Object.assign(button, { setPointerCapture: capture, hasPointerCapture: () => true, releasePointerCapture: release });
  }
  return { ...view, left, right, capture, release, onCommit, onBusyChange, get api() { return api; },
    update: (props: Partial<PageReorderGestureOptions>) => view.rerender(<Harness {...overrides} {...props} />) };
}

function pointer(target: Element, type: string, x = 200, y = 100, id = 1) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, { clientX: { value: x }, clientY: { value: y }, pointerId: { value: id },
    pointerType: { value: 'touch' }, isPrimary: { value: id === 1 }, button: { value: 0 } });
  act(() => { target.dispatchEvent(event); });
}
const press = (element: Element, x = 200, y = 100, id = 1) => pointer(element, 'pointerdown', x, y, id);
const move = (element: Element, x: number, y = 100, id = 1) => pointer(element, 'pointermove', x, y, id);
const up = (element: Element, x = 200, y = 100, id = 1) => pointer(element, 'pointerup', x, y, id);
const key = (element: Element, key: string, repeat = false) => fireEvent.keyDown(element, { key, repeat });

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe('Y70 corner page reorder gesture', () => {
  it('ignores another contact and its click on controls outside the corner handles', () => {
    const fixture = mount();
    const other = document.createElement('button');
    const clicked = vi.fn(); other.addEventListener('click', clicked); document.body.append(other);
    try {
      press(fixture.left); move(fixture.left, 310);
      press(other, 500, 100, 2); up(other, 500, 100, 2); fireEvent.click(other);
      expect(clicked).not.toHaveBeenCalled();
      expect(fixture.api.phase).toBe('grabbed');
      expect(fixture.api.dx).toBe(110);
    } finally { other.remove(); }
  });
  it('uses the latest same-scope commit so current configs and Home survive a drag', () => {
    const fixture = mount();
    press(fixture.left);
    move(fixture.left, 310);
    const latestCommit = vi.fn().mockResolvedValue(true);
    fixture.update({ onCommit: latestCommit });
    up(fixture.left, 310);
    expect(latestCommit).toHaveBeenCalledExactlyOnceWith('p0', 2, order);
    expect(fixture.onCommit).not.toHaveBeenCalled();
  });
  it.each(['left', 'right'] as const)('captures %s immediately, follows the pointer and commits once on release', async corner => {
    const fixture = mount(); const handle = fixture[corner];
    press(handle);
    expect(fixture.api.phase).toBe('grabbed'); expect(fixture.api.corner).toBe(corner);
    expect(fixture.capture).toHaveBeenCalledWith(1); expect(fixture.onBusyChange).toHaveBeenCalledWith(true);
    move(handle, 310, 140);
    expect(fixture.api.dx).toBe(110); expect(fixture.api.dy).toBe(40); expect(fixture.api.destination).toBe(2);
    up(handle, 310, 140); up(handle, 310, 140);
    expect(fixture.onCommit).toHaveBeenCalledExactlyOnceWith('p0', 2, order);
    expect(fixture.api.phase).toBe('saving'); expect(fixture.api.dx).toBe(0); expect(fixture.api.dy).toBe(0);
    await act(async () => { await Promise.resolve(); });
    expect(fixture.api.phase).toBe('settling'); expect(fixture.release).toHaveBeenCalledWith(1);
    act(() => { vi.advanceTimersByTime(300); });
    expect(fixture.api.phase).toBe('idle'); expect(fixture.onBusyChange).toHaveBeenLastCalledWith(false);
  });

  it('a release during opening and subthreshold movement never reorder', () => {
    const fixture = mount();
    press(fixture.left); up(fixture.left);
    expect(fixture.onCommit).not.toHaveBeenCalled(); expect(fixture.api.phase).toBe('settling');
    act(() => { vi.advanceTimersByTime(300); });
    press(fixture.left); move(fixture.left, 204, 104); up(fixture.left, 204, 104);
    expect(fixture.onCommit).not.toHaveBeenCalled();
  });

  it('a moved drop back at its original position leaves order unchanged', () => {
    const fixture = mount(); press(fixture.left); move(fixture.left, 310); move(fixture.left, 200); up(fixture.left);
    expect(fixture.onCommit).not.toHaveBeenCalled();
  });

  it.each(['escape', 'cancel', 'capture', 'blur', 'hidden', 'resize', 'outside'])('%s cancels without committing', reason => {
    const fixture = mount(); press(fixture.left); move(fixture.left, 310);
    if (reason === 'escape') fireEvent.keyDown(window, { key: 'Escape' });
    if (reason === 'cancel') pointer(fixture.left, 'pointercancel');
    if (reason === 'capture') pointer(fixture.left, 'lostpointercapture');
    if (reason === 'blur') fireEvent(window, new Event('blur'));
    if (reason === 'hidden') {
      vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
      fireEvent(document, new Event('visibilitychange'));
    }
    if (reason === 'resize') fireEvent(window, new Event('resize'));
    if (reason === 'outside') up(fixture.left, 650);
    else up(fixture.left, 310);
    expect(fixture.onCommit).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(300); }); expect(fixture.api.phase).toBe('idle');
  });

  it('ignores other pointers and retains the original grab anchor', () => {
    const fixture = mount(); press(fixture.left); move(fixture.left, 255);
    press(fixture.right, 500, 100, 2); move(fixture.right, 580, 200, 2); up(fixture.right, 580, 200, 2);
    expect(fixture.api.corner).toBe('left'); expect(fixture.api.dx).toBe(55);
    up(fixture.left, 255); expect(fixture.onCommit).toHaveBeenCalledExactlyOnceWith('p0', 1, order);
  });

  it('edge dwell advances through the full ten-page order with one timer', () => {
    const fixture = mount({ frameWidth: 1000 });
    press(fixture.left, 500); move(fixture.left, 590);
    expect(fixture.api.destination).toBe(0);
    act(() => { vi.advanceTimersByTime(450 * 9); });
    expect(fixture.api.destination).toBe(9); expect(vi.getTimerCount()).toBe(0);
    up(fixture.left, 590); expect(fixture.onCommit).toHaveBeenCalledExactlyOnceWith('p0', 9, order);
  });

  it('a stationary corner at the edge and leaving the edge never auto reorder', () => {
    const fixture = mount(); press(fixture.left, 590);
    act(() => { vi.advanceTimersByTime(900); }); expect(fixture.api.destination).toBe(0);
    move(fixture.left, 580); move(fixture.left, 400);
    const target = fixture.api.destination;
    act(() => { vi.advanceTimersByTime(900); }); expect(fixture.api.destination).toBe(target);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keyboard pickup, arrows and drop use the same complete snapshot', async () => {
    const fixture = mount({ pageId: 'p4' });
    key(fixture.right, 'Enter'); expect(fixture.api.input).toBe('keyboard');
    key(fixture.right, 'ArrowLeft'); key(fixture.right, 'ArrowUp'); expect(fixture.api.destination).toBe(2);
    key(fixture.right, ' '); expect(fixture.onCommit).toHaveBeenCalledExactlyOnceWith('p4', 2, order);
    await act(async () => { await Promise.resolve(); vi.advanceTimersByTime(300); });
    expect(fixture.api.phase).toBe('idle');
  });

  it.each(['Escape', 'Tab'])('keyboard %s cancels, repeated pickup keys are ignored', keyName => {
    const fixture = mount(); key(fixture.left, ' '); key(fixture.left, ' ', true);
    key(fixture.left, 'ArrowRight'); key(fixture.left, keyName);
    expect(fixture.onCommit).not.toHaveBeenCalled();
  });

  it.each(['false', 'reject'])('failed save %s releases busy state with reduced motion', async outcome => {
    const pending = deferred(); const fixture = mount({ reducedMotion: true, onCommit: () => pending.promise });
    press(fixture.left); move(fixture.left, 310); up(fixture.left, 310);
    expect(fixture.api.phase).toBe('saving');
    await act(async () => { if (outcome === 'false') pending.resolve(false); else pending.reject(new Error('save failed')); await Promise.resolve(); });
    expect(fixture.api.phase).toBe('idle'); expect(fixture.onBusyChange).toHaveBeenLastCalledWith(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['owner', 'page', 'order', 'disabled'])('a changed %s retires a grabbed session', changed => {
    const fixture = mount(); press(fixture.left); move(fixture.left, 310);
    fixture.update(changed === 'owner' ? { ownerKey: 'other' } : changed === 'page' ? { pageId: 'p1' }
      : changed === 'order' ? { pageIds: [...order].reverse() } : { enabled: false });
    up(fixture.left, 310); expect(fixture.onCommit).not.toHaveBeenCalled(); expect(fixture.api.phase).toBe('idle');
    expect(fixture.release).toHaveBeenCalledWith(1);
  });

  it('late save completion after an owner change cannot affect the next owner', async () => {
    const pending = deferred(); const fixture = mount({ onCommit: () => pending.promise });
    press(fixture.left); move(fixture.left, 310); up(fixture.left, 310);
    fixture.update({ ownerKey: 'other' }); expect(fixture.api.phase).toBe('idle');
    await act(async () => { pending.resolve(true); await Promise.resolve(); });
    expect(fixture.api.phase).toBe('idle'); expect(vi.getTimerCount()).toBe(0);
  });

  it('unmount releases capture, timers and busy state, ignoring late saves', async () => {
    const pending = deferred(); const fixture = mount({ onCommit: () => pending.promise });
    press(fixture.left); move(fixture.left, 590); fixture.unmount();
    expect(fixture.release).toHaveBeenCalledWith(1); expect(vi.getTimerCount()).toBe(0);
    expect(fixture.onBusyChange).toHaveBeenLastCalledWith(false);
    await act(async () => { pending.resolve(true); await Promise.resolve(); });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('unmount while saving never starts a late settling timer', async () => {
    const pending = deferred(); const fixture = mount({ onCommit: () => pending.promise });
    press(fixture.left); move(fixture.left, 310); up(fixture.left, 310);
    expect(fixture.api.phase).toBe('saving'); fixture.unmount();
    await act(async () => { pending.resolve(true); await Promise.resolve(); });
    expect(vi.getTimerCount()).toBe(0); expect(fixture.onBusyChange).toHaveBeenLastCalledWith(false);
  });

  it('the normal capture release cannot cancel an in-flight commit', async () => {
    const pending = deferred(); const send = vi.fn(() => pending.promise);
    const fixture = mount({ onCommit: send });
    press(fixture.left); move(fixture.left, 310); up(fixture.left, 310);
    pointer(fixture.left, 'lostpointercapture'); pointer(fixture.left, 'pointercancel');
    expect(fixture.api.phase).toBe('saving'); expect(send).toHaveBeenCalledTimes(1);
    await act(async () => { pending.resolve(true); await Promise.resolve(); });
    expect(fixture.api.phase).toBe('settling');
  });

  it('fewer than two pages and invalid selected identities cannot be grabbed', () => {
    const fixture = mount({ pageIds: ['p0'] }); press(fixture.left); key(fixture.left, 'Enter');
    expect(fixture.api.phase).toBe('idle'); expect(fixture.capture).not.toHaveBeenCalled();
    fixture.update({ pageId: 'missing' }); press(fixture.left); expect(fixture.api.phase).toBe('idle');
  });
});
