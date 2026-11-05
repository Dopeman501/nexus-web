import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { PanelLayout, PanelWidget } from '../../../panel/types';
import { D215PanelsEditor } from './D215PanelsEditor';

vi.mock('../../../panel/editor/PanelWidgetCatalog', () => ({
  PanelWidgetCatalog: ({ onAdd, canAddSize }: { onAdd: (type: string, size: string) => void; canAddSize: (size: string) => boolean }) => (
    <button disabled={!canAddSize('2x2round')} onClick={() => onAdd('monitoring', '2x2round')}>add circle</button>
  ),
}));
vi.mock('./D215PanelBackgroundSettings', () => ({
  D215PanelBackgroundSettings: ({ background, onChange }: { background?: { color?: string }; onChange: (patch: { color: string }) => void }) => (
    <input aria-label="circle background" value={background?.color ?? ''} onChange={event => onChange({ color: event.target.value })} />
  ),
}));
vi.mock('../../../panel/widgets/registry', () => ({
  lookupApp: () => ({
    meta: { i18nKey: 'monitoring', sizes: ['2x2round'] },
    Settings: ({ widget, surface, onUpdate }: { widget: PanelWidget; surface: string; onUpdate: (config: { label: string }) => void }) => (
      <label>{surface}<input aria-label="sensor label" value={String(widget.config?.label ?? '')}
        onChange={event => onUpdate({ label: event.target.value })} /></label>
    ),
  }),
  appAvailableForSurface: () => true,
}));

const copy = 'devices.jungle-leopard-d215.panels';
const initial: PanelLayout = { layoutSchemaVersion: 2, surface: 'lcd-wide', pages: [{ id: 'page', widgets: [] }] };
const changed = vi.fn();
function Harness({ value = initial }: { value?: PanelLayout }) {
  const [layout, setLayout] = useState(value);
  const [selectedId, onSelect] = useState<string | null>(null);
  return <D215PanelsEditor layout={layout} canvas={{ width: 1680, height: 756 }} selectedId={selectedId}
    onSelect={onSelect} onChange={next => { changed(next); setLayout(next); }} />;
}

describe('D215 Panels editor', () => {
  it('toggles backgrounds and edits only the selected circle while retaining disabled settings', () => {
    changed.mockClear();
    const items = ['cpu', 'gpu'].map(id => ({ id, type: 'monitoring', x: 0.5, y: 0.5, diameter: 0.4,
      background: { color: id === 'cpu' ? '#ff0000' : '#0000ff' } }));
    render(<Harness value={{ ...initial, d215Panels: { enabled: true, items } }} />);
    const toggle = screen.getByRole('switch', { name: `${copy}.backgrounds` });
    expect(toggle).toBeChecked();
    fireEvent.click(screen.getAllByRole('button', { name: /monitoring/ })[0]);
    expect(screen.getByLabelText('circle background')).toHaveValue('#ff0000');
    fireEvent.change(screen.getByLabelText('circle background'), { target: { value: '#00ff00' } });
    expect(changed.mock.lastCall?.[0].d215Panels.items.map((item: { background: { color: string } }) => item.background.color))
      .toEqual(['#00ff00', '#0000ff']);
    fireEvent.click(toggle);
    expect(screen.queryByLabelText('circle background')).not.toBeInTheDocument();
    expect(changed.mock.lastCall?.[0].d215Panels.backgroundsEnabled).toBe(false);
    fireEvent.click(toggle);
    expect(screen.getByLabelText('circle background')).toHaveValue('#00ff00');
    fireEvent.click(screen.getAllByRole('button', { name: /monitoring/ })[1]);
    expect(screen.getByLabelText('circle background')).toHaveValue('#0000ff');
  });

  it('adds six independent circles, enables the mode and refuses a seventh', () => {
    changed.mockClear();
    render(<Harness />);
    for (let i = 0; i < 6; i++) fireEvent.click(screen.getByRole('button', { name: 'add circle' }));
    expect(changed).toHaveBeenCalledTimes(6);
    const saved = changed.mock.lastCall?.[0] as PanelLayout;
    expect(saved.d215Panels?.enabled).toBe(true);
    expect(saved.d215Panels?.items).toHaveLength(6);
    expect(new Set(saved.d215Panels?.items.map(item => item.id)).size).toBe(6);
    expect(saved.pages).toBe(initial.pages);
    expect(screen.getByRole('button', { name: 'add circle' })).toBeDisabled();
    expect(screen.queryByText('panel.playlist.playlist')).not.toBeInTheDocument();
  });

  it('edits one circle config, retains it when switching modes and removes only the chosen instance', () => {
    changed.mockClear();
    const items = ['cpu', 'gpu'].map(id => ({ id, type: 'monitoring', x: 0.5, y: 0.5, diameter: 0.4, config: { label: id } }));
    render(<Harness value={{ ...initial, d215Panels: { enabled: true, items } }} />);
    fireEvent.click(screen.getAllByRole('button', { name: /monitoring/ })[0]);
    expect(screen.getByLabelText('sensor label')).toHaveValue('cpu');
    expect(screen.getByText('lcd-round')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('sensor label'), { target: { value: 'CPU temperature' } });
    const saved = changed.mock.lastCall?.[0] as PanelLayout;
    expect(saved.d215Panels?.items.map(item => item.config?.label)).toEqual(['CPU temperature', 'gpu']);
    fireEvent.click(screen.getByRole('switch', { name: `${copy}.enabled` }));
    expect(changed.mock.lastCall?.[0].d215Panels).toMatchObject({ enabled: false, items: saved.d215Panels?.items });
    fireEvent.click(screen.getByRole('button', { name: 'devices.panels.widgetSettings.remove' }));
    expect(changed.mock.lastCall?.[0].d215Panels.items.map((item: { id: string }) => item.id)).toEqual(['gpu']);
    expect(items[0].config.label).toBe('cpu');
  });
});
