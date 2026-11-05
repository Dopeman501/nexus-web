import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { patchPanelDevice } from '../../../api/panel';
import { D215RotationSettings } from './D215RotationSettings';

vi.mock('../../../api/panel', () => ({ patchPanelDevice: vi.fn() }));
vi.mock('../../../lib/i18n', () => ({
  useTranslation: () => ({
    t: (key: string, values?: { n: number }) => key === 'devices.lcd.rotationDegrees' ? `${values?.n}°` : key,
  }),
}));

const CASES = [
  { angle: 0, portrait: false, flip180: false },
  { angle: 90, portrait: true, flip180: false },
  { angle: 180, portrait: false, flip180: true },
  { angle: 270, portrait: true, flip180: true },
] as const;
const chip = (angle: number) => screen.getByRole('radio', { name: `${angle}°` });
const onSaved = vi.fn();
const onSaveFailed = vi.fn();
const props = { recordId: 'd215', portrait: false, flip180: false, onSaved, onSaveFailed };

beforeEach(() => vi.resetAllMocks());

describe('D215 rotation settings', () => {
  it.each(CASES)('reads the existing $angle° setting without writing', mount => {
    render(<D215RotationSettings {...props} {...mount} />);
    expect(screen.getAllByRole('radio')).toHaveLength(4);
    expect(chip(mount.angle)).toBeChecked();
    expect(patchPanelDevice).not.toHaveBeenCalled();
  });

  it.each(CASES)('saves $angle° as one atomic mount change', async ({ angle, portrait, flip180 }) => {
    vi.mocked(patchPanelDevice).mockResolvedValue({ portrait, flip180 } as Awaited<ReturnType<typeof patchPanelDevice>>);
    render(<D215RotationSettings {...props} portrait={!portrait} flip180={!flip180} />);
    fireEvent.click(chip(angle));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith({ portrait, flip180 }));
    expect(patchPanelDevice).toHaveBeenCalledExactlyOnceWith('d215', { portrait, flip180 });
    expect(onSaveFailed).not.toHaveBeenCalled();
  });

  it('keeps the confirmed selection and blocks duplicate writes while saving', async () => {
    let complete!: (result: Awaited<ReturnType<typeof patchPanelDevice>>) => void;
    vi.mocked(patchPanelDevice).mockImplementation(() => new Promise(resolve => { complete = resolve; }));
    const view = render(<D215RotationSettings {...props} />);
    fireEvent.click(chip(180));
    expect(chip(0)).toBeChecked();
    for (const radio of screen.getAllByRole('radio')) expect(radio).toBeDisabled();
    fireEvent.click(chip(270));
    expect(patchPanelDevice).toHaveBeenCalledTimes(1);
    await act(async () => { complete({ portrait: false, flip180: true } as Awaited<ReturnType<typeof patchPanelDevice>>); });
    view.rerender(<D215RotationSettings {...props} flip180 />);
    expect(chip(180)).toBeChecked();
    expect(chip(270)).toBeEnabled();
  });

  it.each(['missing', 'rejected'] as const)('preserves the selected angle and reports a %s save', async failure => {
    if (failure === 'missing') vi.mocked(patchPanelDevice).mockResolvedValue(null);
    else vi.mocked(patchPanelDevice).mockRejectedValue(new Error('offline'));
    render(<D215RotationSettings {...props} />);
    fireEvent.click(chip(270));
    await waitFor(() => expect(onSaveFailed).toHaveBeenCalledTimes(1));
    expect(chip(0)).toBeChecked();
    expect(chip(270)).toBeEnabled();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it.each(['resolved', 'rejected'] as const)('discards a late %s result after unmount', async outcome => {
    let complete!: (result: Awaited<ReturnType<typeof patchPanelDevice>>) => void;
    let reject!: (reason: Error) => void;
    vi.mocked(patchPanelDevice).mockImplementation(() => new Promise((resolve, fail) => { complete = resolve; reject = fail; }));
    const view = render(<D215RotationSettings {...props} />);
    fireEvent.click(chip(180));
    view.unmount();
    await act(async () => {
      if (outcome === 'resolved') complete({ portrait: false, flip180: true } as Awaited<ReturnType<typeof patchPanelDevice>>);
      else reject(new Error('offline'));
    });
    expect(onSaved).not.toHaveBeenCalled();
    expect(onSaveFailed).not.toHaveBeenCalled();
  });

  it('disables all angles without a record and skips the current selection', () => {
    const view = render(<D215RotationSettings {...props} recordId={undefined} />);
    for (const radio of screen.getAllByRole('radio')) expect(radio).toBeDisabled();
    view.rerender(<D215RotationSettings {...props} />);
    fireEvent.click(chip(0));
    expect(patchPanelDevice).not.toHaveBeenCalled();
  });

  it('uses the saved response and follows external rotation changes', async () => {
    vi.mocked(patchPanelDevice).mockResolvedValue({ portrait: true, flip180: false } as Awaited<ReturnType<typeof patchPanelDevice>>);
    const view = render(<D215RotationSettings {...props} />);
    fireEvent.click(chip(270));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith({ portrait: true, flip180: false }));
    view.rerender(<D215RotationSettings {...props} portrait flip180 />);
    expect(chip(270)).toBeChecked();
  });
});
