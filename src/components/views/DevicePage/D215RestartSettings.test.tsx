import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { restartD215Screen, type D215RestartResult } from '../../../api/d215Restart';
import { D215RestartSettings } from './D215RestartSettings';

vi.mock('../../../api/d215Restart', () => ({ restartD215Screen: vi.fn() }));

const COPY = 'devices.jungle-leopard-d215.restart';
const button = () => screen.getByRole('button', { name: `${COPY}.label` });
const deferred = () => {
  let resolve!: (result: D215RestartResult) => void;
  return { promise: new Promise<D215RestartResult>(complete => { resolve = complete; }), resolve: (result: D215RestartResult) => resolve(result) };
};

beforeEach(() => { vi.mocked(restartD215Screen).mockReset(); });

describe('D215 restart setting', () => {
  it('sends only an explicit click, stays disabled while pending and reports reconnection', async () => {
    const pending = deferred();
    vi.mocked(restartD215Screen).mockReturnValue(pending.promise);
    render(<D215RestartSettings recordId="one" />);
    expect(button()).toBeEnabled();
    expect(restartD215Screen).not.toHaveBeenCalled();
    expect(screen.queryByRole('status')).toBeNull();
    fireEvent.click(button());
    const restarting = screen.getByRole('button', { name: `${COPY}.restarting` });
    expect(restarting).toBeDisabled();
    fireEvent.click(restarting);
    expect(restartD215Screen).toHaveBeenCalledExactlyOnceWith('one', expect.any(AbortSignal));
    await act(async () => pending.resolve({ status: 'restarted' }));
    expect(button()).toBeEnabled();
    expect(screen.getByRole('status')).toHaveTextContent(`${COPY}.restarted`);
  });

  it.each(['busy', 'unavailable', 'failed', 'uncertain'] as const)('shows actionable %s status without retrying', async status => {
    vi.mocked(restartD215Screen).mockResolvedValue({ status });
    render(<D215RestartSettings recordId="one" />);
    fireEvent.click(button());
    await screen.findByText(`${COPY}.${status}`);
    expect(button()).toBeEnabled();
    expect(restartD215Screen).toHaveBeenCalledTimes(1);
  });

  it('handles an unexpected request rejection without claiming success', async () => {
    vi.mocked(restartD215Screen).mockRejectedValue(new Error('offline'));
    render(<D215RestartSettings recordId="one" />);
    fireEvent.click(button());
    await screen.findByText(`${COPY}.uncertain`);
    expect(button()).toBeEnabled();
  });

  it('cancels the former record and ignores its late result while another screen restarts', async () => {
    const first = deferred();
    const second = deferred();
    vi.mocked(restartD215Screen).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { rerender } = render(<D215RestartSettings recordId="one" />);
    fireEvent.click(button());
    const oldSignal = vi.mocked(restartD215Screen).mock.calls[0][1]!;
    rerender(<D215RestartSettings recordId="two" />);
    expect(oldSignal.aborted).toBe(true);
    expect(button()).toBeEnabled();
    fireEvent.click(button());
    await act(async () => first.resolve({ status: 'restarted' }));
    expect(screen.getByRole('button', { name: `${COPY}.restarting` })).toBeDisabled();
    expect(screen.queryByText(`${COPY}.restarted`)).toBeNull();
    await act(async () => second.resolve({ status: 'failed' }));
    expect(screen.getByRole('status')).toHaveTextContent(`${COPY}.failed`);
  });

  it('aborts its request on unmount and ignores a late reply after reopening', async () => {
    const pending = deferred();
    vi.mocked(restartD215Screen).mockReturnValue(pending.promise);
    const { unmount } = render(<D215RestartSettings recordId="one" />);
    fireEvent.click(button());
    const signal = vi.mocked(restartD215Screen).mock.calls[0][1]!;
    unmount();
    expect(signal.aborted).toBe(true);
    render(<D215RestartSettings recordId="one" />);
    await act(async () => pending.resolve({ status: 'restarted' }));
    expect(button()).toBeEnabled();
    expect(screen.queryByRole('status')).toBeNull();
  });
});
