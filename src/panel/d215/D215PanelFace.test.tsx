import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PanelOpaqueProvider, useReportOpaque } from '../widgets/common/PanelOpaqueContext';
import type { AppManifest, WidgetProps } from '../widgets/types';
import { D215PanelFace } from './D215PanelFace';

vi.mock('./D215PanelBackgroundLayer', () => ({ D215PanelBackgroundLayer: ({ covered }: { covered: boolean }) =>
  <div data-testid="background" data-covered={covered} /> }));
const app = { Widget: ({ widget }: WidgetProps) => {
  useReportOpaque(widget.id, widget.config?.opaque === true);
  return <div data-testid="widget" />;
} } as AppManifest;

describe('D215 circle coverage ownership', () => {
  it('pauses only its own background when its widget is opaque, without covering the display', () => {
    const report = vi.fn();
    const item = { id: 'one', type: 'gallery', x: 0.5, y: 0.5, diameter: 0.4,
      config: { opaque: true }, background: { mode: 'shader' as const } };
    const props = { item, app, backgroundsEnabled: true, themeMode: 'dark' as const, editing: false, contentStyle: {} };
    const { rerender } = render(<PanelOpaqueProvider value={report}><D215PanelFace {...props} /></PanelOpaqueProvider>);
    expect(screen.getByTestId('background')).toHaveAttribute('data-covered', 'true');
    expect(report).not.toHaveBeenCalled();
    rerender(<D215PanelFace {...props} item={{ ...item, config: { opaque: false } }} />);
    expect(screen.getByTestId('background')).toHaveAttribute('data-covered', 'false');
    rerender(<D215PanelFace {...props} backgroundsEnabled={false} />);
    expect(screen.queryByTestId('background')).not.toBeInTheDocument();
    expect(screen.getByTestId('widget')).toBeInTheDocument();
  });
});
