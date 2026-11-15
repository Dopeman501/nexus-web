import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { KeyReaction } from '../../../api/keyReactive';
import { TypeReactivePalette } from './TypeReactivePalette';

vi.mock('../../../lib/i18n', () => ({ useTranslation: () => ({
  t: (key: string, params?: Record<string, string | number>) => params?.position ? `${key} ${params.position}` : key,
}) }));

const changed = vi.fn();
function Harness({ initial = { color: '#000000' } }: { initial?: Pick<KeyReaction, 'color' | 'colors'> }) {
  const [config, setConfig] = useState(initial);
  return <TypeReactivePalette config={config} onChange={colors => {
    changed(colors);
    setConfig({ color: colors[0], colors });
  }} />;
}
const swatch = (color: string) => screen.getByRole('button', { name: color, exact: true });
const picker = () => screen.getByRole('button', { name: 'lighting.keyReactions.color.addCustom' });
const add = () => screen.getByRole('button', { name: 'lighting.keyReactions.color.add' });
const input = () => screen.getByRole('textbox', { name: 'common.hexColor' });

describe('TypeReactivePalette', () => {
  beforeEach(() => changed.mockClear());

  it('shows legacy custom and black swatches, selection and accessible cycle position without saving', () => {
    render(<Harness initial={{ color: '#123456' }} />);
    expect(swatch('#123456')).toHaveAttribute('aria-pressed', 'true');
    expect(swatch('#123456')).toHaveAccessibleDescription('lighting.keyReactions.color.position 1');
    expect(swatch('#000000')).toHaveAttribute('aria-pressed', 'false');
    expect(changed).not.toHaveBeenCalled();
  });

  it('toggles multiple colours in selection order and re-adds at the end', () => {
    render(<Harness />);
    fireEvent.click(swatch('#ff2d55'));
    fireEvent.click(swatch('#0a84ff'));
    expect(swatch('#ff2d55')).toHaveAccessibleDescription('lighting.keyReactions.color.position 2');
    fireEvent.click(swatch('#000000'));
    expect(changed).toHaveBeenLastCalledWith(['#ff2d55', '#0a84ff']);
    expect(swatch('#ff2d55')).toHaveAccessibleDescription('lighting.keyReactions.color.position 1');
    fireEvent.click(swatch('#000000'));
    expect(changed).toHaveBeenLastCalledWith(['#ff2d55', '#0a84ff', '#000000']);
  });

  it('retains the last selected colour', () => {
    render(<Harness />);
    fireEvent.click(swatch('#000000'));
    expect(changed).not.toHaveBeenCalled();
    expect(swatch('#000000')).toHaveAttribute('aria-pressed', 'true');
  });

  it('abandons a custom draft on Escape and does not apply intermediate valid hex edits', () => {
    render(<Harness />);
    fireEvent.click(picker());
    fireEvent.change(input(), { target: { value: '#123456' } });
    fireEvent.change(input(), { target: { value: '#abcdef' } });
    expect(changed).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('textbox')).toBeNull();
    fireEvent.click(picker());
    expect(input()).toHaveValue('#000000');
  });

  it('adds arbitrary custom colours only with Add and makes their swatches removable', () => {
    render(<Harness />);
    fireEvent.click(picker());
    fireEvent.change(input(), { target: { value: '#ABCDEF' } });
    fireEvent.click(add());
    expect(changed).toHaveBeenLastCalledWith(['#000000', '#abcdef']);
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(swatch('#abcdef')).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(swatch('#abcdef'));
    expect(changed).toHaveBeenLastCalledWith(['#000000']);
    expect(screen.queryByRole('button', { name: '#abcdef', exact: true })).toBeNull();
  });

  it('cannot add a colour already selected', () => {
    render(<Harness />);
    fireEvent.click(picker());
    expect(add()).toBeDisabled();
    fireEvent.change(input(), { target: { value: '#000000' } });
    fireEvent.click(add());
    expect(changed).not.toHaveBeenCalled();
  });

  it('caps the palette at sixteen but allows removing a selection to free a slot', () => {
    const colors = Array.from({ length: 16 }, (_, i) => `#${(i + 1).toString(16).padStart(6, '0')}`);
    render(<Harness initial={{ color: colors[0], colors }} />);
    expect(swatch('#ffffff')).toBeDisabled();
    expect(picker()).toBeDisabled();
    expect(screen.getByText('lighting.keyReactions.color.limit')).toBeInTheDocument();
    fireEvent.click(swatch(colors[0]));
    expect(picker()).toBeEnabled();
    fireEvent.click(swatch('#ffffff'));
    expect(changed).toHaveBeenLastCalledWith([...colors.slice(1), '#ffffff']);
    expect(picker()).toBeDisabled();
  });
});
