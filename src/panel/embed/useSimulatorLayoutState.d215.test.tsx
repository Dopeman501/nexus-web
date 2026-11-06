import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useSimulatorLayoutState } from './useSimulatorLayoutState';

function message(data: unknown, origin = window.location.origin) {
  act(() => window.dispatchEvent(new MessageEvent('message', { data, origin, source: window.parent })));
}

describe('D215 simulator composition editing', () => {
  it('mirrors family and editor mode without replacing saved layout when the tab changes', () => {
    const { result } = renderHook(() => useSimulatorLayoutState());
    const layout = { layoutSchemaVersion: 2, surface: 'lcd-wide', pages: [{ id: 'p', widgets: [] }],
      d215Panels: { enabled: true, items: [{ id: 'c', type: 'clock', x: 0.5, y: 0.5, diameter: 0.4 }] } };
    message({ type: 'simulator/init', surface: 'lcd-wide', deviceFamily: 'jungle-leopard-d215', panelsEditing: true,
      layout, theme: {}, themeMode: 'dark', selectedWidgetId: 'c', brightness: 100, screenOn: true, showPanel: true });
    expect(result.current.deviceFamily).toBe('jungle-leopard-d215');
    expect(result.current.panelsEditing).toBe(true);
    expect(result.current.layoutState.layout).toBe(layout);
    message({ type: 'simulator/set-panels-editor', deviceFamily: 'jungle-leopard-d215', panelsEditing: false, widgetEditing: true });
    expect(result.current.panelsEditing).toBe(false);
    expect(result.current.widgetEditing).toBe(true);
    expect(result.current.layoutState.layout).toBe(layout);
    message({ type: 'simulator/set-panels-editor', deviceFamily: 'other-lcd', panelsEditing: true }, 'https://untrusted.example');
    expect(result.current.deviceFamily).toBe('jungle-leopard-d215');
    expect(result.current.panelsEditing).toBe(false);
    expect(result.current.widgetEditing).toBe(true);
  });
});
