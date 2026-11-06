import { useState } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { PanelConfigValue, PanelWidget } from '../../types';
import { MonitoringSettings } from './MonitoringSettings';
import { MonitoringWidget } from './MonitoringWidget';
import { MonitoringTouch } from './MonitoringTouch';

const mockSensors = vi.hoisted(() => ({
  summary: [],
  cpu: [
    { id: 'cpu-total', name: 'CPU Total', type: 'Load', value: 12, units: '%', formatted: '12%', parent: { id: 'cpu', name: 'CPU' } },
    { id: 'cpu-temp', name: 'CPU Package', type: 'Temperature', value: 95, units: '°C', formatted: '95 °C', parent: { id: 'cpu', name: 'CPU' } },
    { id: 'cpu-power', name: 'CPU Power', type: 'Power', value: 45, units: 'W', formatted: '45 W', parent: { id: 'cpu', name: 'CPU' } },
  ],
  gpu: [], memory: [], storage: [], storageComponents: {}, storageSensors: [], motherboard: [],
  motherboardModel: '', cpuModel: '', gpuModel: '', gpuModels: [], gpuComponents: [], memoryTotal: '',
}));
const mockExtras = vi.hoisted(() => ({
  batteries: [], nics: [], coolers: [], psus: [], nvmeStorage: [], embeddedControllers: [], memoryModules: [],
}));
vi.mock('../../../hooks/useSensors', () => ({
  useSensors: () => mockSensors,
  isSmartStorageComponentId: (id: string) => id.startsWith('smart/'),
}));
vi.mock('../../../hooks/useSensorExtras', () => ({ useSensorExtras: () => mockExtras }));
vi.mock('../../../hooks/useFpsSensors', () => ({ useFpsSensors: () => [] }));
vi.mock('../../../hooks/useNetworkMonitor', () => ({
  useNetworkMonitor: () => ({ series: [], sampleCount: 60, totalRate: 0, totalRateIn: 0, totalRateOut: 0, entries: [] }),
}));
vi.mock('../../../hooks/useUiSettings', () => ({
  useUiSettings: () => ({ settings: { preferredCpuTempSensorId: '', preferredGpuTempSensorId: '' }, update: vi.fn(), reload: vi.fn() }),
  useTempSensorPrefs: () => ({ cpuId: '', gpuId: '' }),
  useUnitPrefs: () => ({ monitoringTempUnit: 'c', timeFormat: 'system', numberFormat: 'system' }),
}));

function widgetWith(config: Record<string, PanelConfigValue> = {}, id = 'monitoring-text'): PanelWidget {
  return {
    id, type: 'monitoring', size: '2x2round', col: 0, row: 0,
    config: { slotCount: 1, slot0_device: 'cpu', slot0_sensor: 'cpu-total', slot0_design: 'bar', ...config },
  };
}

function microWith(config: Record<string, PanelConfigValue> = {}): PanelWidget {
  return { ...widgetWith(), size: '2x2', config: {
    slotCount: 3, micro_device: 'cpu', micro_sensor0: 'cpu-total', micro_sensor1: 'cpu-temp', micro_sensor2: 'cpu-power',
    ...config,
  } };
}

function Editor({ initial = widgetWith(), onUpdate = () => {} }: {
  initial?: PanelWidget; onUpdate?: (patch: Record<string, PanelConfigValue>) => void;
}) {
  const [widget, setWidget] = useState(initial);
  const update = (patch: Record<string, PanelConfigValue>) => {
    onUpdate(patch);
    setWidget(current => ({ ...current, config: { ...current.config, ...patch } }));
  };
  return <>
    <MonitoringWidget widget={widget} />
    <MonitoringSettings widget={widget} surface="lcd-round" desktopEditor onUpdate={update} onResize={() => {}} />
  </>;
}

// jsdom cannot resolve var() inheritance. Walk the actual reading's ancestors
// to inspect the effective explicit override, independent of wrapper structure.
function inheritedVariable(element: HTMLElement, variable: string): string {
  for (let current: HTMLElement | null = element; current; current = current.parentElement) {
    const value = current.style.getPropertyValue(variable);
    if (value) return value;
  }
  return '';
}

function gradientBackground(container: HTMLElement): string {
  return Array.from(container.querySelectorAll<HTMLElement>('[style*="background"]'))
    .map(element => element.style.background).find(value => value.includes('linear-gradient')) ?? '';
}

describe('Monitoring text colour', () => {
  it('places the text picker below Color by value and offers custom, white and black choices', () => {
    render(<Editor />);
    const valueColor = screen.getByRole('switch', { name: 'monitoring.settings.valueColor' });
    const textColor = screen.getByText('panel.settings.textColor');
    expect(valueColor.compareDocumentPosition(textColor) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole('button', { name: '#ffffff', exact: true })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '#000000', exact: true })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'common.customColor' })).toBeInTheDocument();
  });

  it('keeps the picker available for a text-only design without value colouring', () => {
    render(<Editor initial={widgetWith({ slot0_design: 'text' })} />);
    expect(screen.queryByRole('switch', { name: 'monitoring.settings.valueColor' })).not.toBeInTheDocument();
    expect(screen.getByText('panel.settings.textColor')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '#ffffff', exact: true })).toBeInTheDocument();
  });

  it('commits the selected colour, retains it when reopening settings and resets to inheritance', () => {
    const onUpdate = vi.fn();
    const { unmount } = render(<Editor onUpdate={onUpdate} />);
    fireEvent.click(screen.getByRole('button', { name: '#8b5cf6', exact: true }));
    expect(onUpdate).toHaveBeenLastCalledWith({ textColor: '#8b5cf6' });
    expect(inheritedVariable(screen.getByRole('img', { name: '12%' }), '--text')).toBe('#8b5cf6');
    unmount();
    render(<Editor initial={widgetWith({ textColor: '#8b5cf6' })} onUpdate={onUpdate} />);
    expect(screen.getByRole('button', { name: '#8b5cf6', exact: true })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(within(screen.getByRole('group', { name: 'panel.settings.textColor' }))
      .getByRole('button', { name: /monitoring\.settings\.resetLabel/ }));
    expect(onUpdate).toHaveBeenLastCalledWith({ textColor: null });
    expect(inheritedVariable(screen.getByRole('img', { name: '12%' }), '--text')).toBe('');
  });

  it('keeps colour choices independent between two panel instances', () => {
    render(<>
      <section aria-label="First panel"><Editor /></section>
      <section aria-label="Second panel"><Editor initial={widgetWith({ textColor: '#000000' }, 'second')} /></section>
    </>);
    const first = within(screen.getByRole('region', { name: 'First panel' }));
    const second = within(screen.getByRole('region', { name: 'Second panel' }));
    fireEvent.click(first.getByRole('button', { name: '#ffffff', exact: true }));
    expect(inheritedVariable(first.getByRole('img', { name: '12%' }), '--text')).toBe('#ffffff');
    expect(inheritedVariable(second.getByRole('img', { name: '12%' }), '--text')).toBe('#000000');
    expect(second.getByRole('button', { name: '#000000', exact: true })).toHaveAttribute('aria-pressed', 'true');
  });

  it('preserves a value-coloured gauge while overriding only its text', () => {
    const initial = widgetWith({ slot0_sensor: 'cpu-temp', slot0_valueColor: true });
    const { container, rerender } = render(<MonitoringWidget widget={initial} />);
    const gradient = gradientBackground(container);
    expect(gradient).toContain('linear-gradient');
    rerender(<MonitoringWidget widget={{ ...initial, config: { ...initial.config, textColor: '#ff00aa' } }} />);
    const reading = screen.getByRole('img', { name: '95 °C' });
    expect(inheritedVariable(reading, '--text')).toBe('#ff00aa');
    expect(inheritedVariable(reading, '--panel-ink-accent')).toBe('#ff00aa');
    expect(inheritedVariable(reading, '--panel-accent')).toMatch(/^hsl\(0\.0,/);
    expect(inheritedVariable(reading, '--gauge-track')).toBe('');
    expect(gradientBackground(container)).toBe(gradient);
  });

  it('leaves legacy, reset and malformed text colours inherited', () => {
    const { container, rerender } = render(<MonitoringWidget widget={widgetWith()} />);
    for (const value of [undefined, null, '', 'not-a-colour', 'url(https://example.invalid/paint)', 42, true]) {
      rerender(<MonitoringWidget widget={widgetWith(value === undefined ? {} : { textColor: value })} />);
      expect(inheritedVariable(screen.getByRole('img', { name: '12%' }), '--text')).toBe('');
      expect(container.querySelector('[style*="example.invalid"]')).not.toBeInTheDocument();
    }
  });

  it('rejects malformed imported colours in settings and allows clearing any saved override', () => {
    for (const textColor of ['url(https://example.invalid/paint)', 'not-a-colour', 42]) {
      const onUpdate = vi.fn();
      const { container, unmount } = render(<Editor initial={widgetWith({ textColor })} onUpdate={onUpdate} />);
      expect(container.querySelector('[style*="example.invalid"]')).not.toBeInTheDocument();
      const reset = within(screen.getByRole('group', { name: 'panel.settings.textColor' }))
        .getByRole('button', { name: /monitoring\.settings\.resetLabel/ });
      expect(reset).toBeEnabled();
      fireEvent.click(reset);
      expect(onUpdate).toHaveBeenLastCalledWith({ textColor: null });
      expect(inheritedVariable(screen.getByRole('img', { name: '12%' }), '--text')).toBe('');
      unmount();
    }
  });

  it('opens the custom picker at the rendered colour for accepted short and hashless hex imports', () => {
    for (const [textColor, canonical] of [['#abc', '#AABBCC'], [' AbC ', '#AABBCC'], ['ABCDEF', '#ABCDEF']]) {
      const { unmount } = render(<Editor initial={widgetWith({ textColor })} />);
      expect(inheritedVariable(screen.getByRole('img', { name: '12%' }), '--text')).toBe(canonical.toLowerCase());
      fireEvent.click(screen.getByRole('button', { name: 'common.customColor' }));
      expect(screen.getByRole('textbox', { name: 'common.hexColor' })).toHaveValue(canonical);
      unmount();
    }
  });

  it('applies one colour to every slot in a multi-slot widget', () => {
    const widget = { ...widgetWith(), size: '4x2' as const, config: {
      ...widgetWith().config, slotCount: 2, slot1_device: 'cpu', slot1_sensor: 'cpu-temp', slot1_design: 'text', textColor: '#00ccaa',
    } };
    render(<MonitoringWidget widget={widget} />);
    expect(inheritedVariable(screen.getByRole('img', { name: '12%' }), '--text')).toBe('#00ccaa');
    expect(inheritedVariable(screen.getByRole('img', { name: '95 °C' }), '--text')).toBe('#00ccaa');
  });

  it('offers the shared text picker in Micro mode and applies the colour to all readings', () => {
    render(<Editor initial={microWith()} />);
    fireEvent.click(screen.getByRole('button', { name: '#ffffff', exact: true }));
    for (const name of ['12%', '95 °C', '45 W']) {
      expect(inheritedVariable(screen.getByRole('img', { name }), '--text')).toBe('#ffffff');
    }
  });

  it('retains each source widget colour when touch view combines different panel instances', () => {
    const first = widgetWith({ textColor: '#ff00aa' }, 'first');
    const second = widgetWith({ slot0_sensor: 'cpu-temp', textColor: '#00ccaa' }, 'second');
    render(<MonitoringTouch widget={first} pageWidgets={[first, second]} />);
    expect(inheritedVariable(screen.getByRole('img', { name: '12%' }), '--text')).toBe('#ff00aa');
    expect(inheritedVariable(screen.getByRole('img', { name: '95 °C' }), '--text')).toBe('#00ccaa');
  });
});
