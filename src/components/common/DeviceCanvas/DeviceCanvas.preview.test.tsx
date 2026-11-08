import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useShaderRenderer } from '../../../hooks/useShaderRenderer';
import { DeviceCanvas } from './DeviceCanvas';

vi.mock('../../../hooks/useShaderRenderer', () => ({ useShaderRenderer: vi.fn() }));
vi.mock('../../../lib/i18n', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

describe('DeviceCanvas selected-effect fallback', () => {
  beforeEach(() => {
    vi.mocked(useShaderRenderer).mockReturnValue({ ready: false, loading: false, error: 'WebGL2 not supported' });
  });

  function canvas(effect: string | null = 'ball') {
    return <DeviceCanvas devices={[]} selectedIds={new Set()} primaryDeviceId={null}
      onSelectDevice={vi.fn()} onSetSelection={vi.fn()} shaderEffect={effect}
      shaderFallback={<div data-testid="focused-effect" />} />;
  }

  it('shows the focused look while the local renderer is unavailable or loading', () => {
    const { queryByTestId, rerender } = render(canvas());
    expect(queryByTestId('focused-effect')).toBeInTheDocument();
    vi.mocked(useShaderRenderer).mockReturnValue({ ready: false, loading: true, error: null });
    rerender(canvas('wave'));
    expect(queryByTestId('focused-effect')).toBeInTheDocument();
  });

  it('releases the fallback when the shader draws and leaves non-shader streams visible', () => {
    const { queryByTestId, rerender } = render(canvas());
    vi.mocked(useShaderRenderer).mockReturnValue({ ready: true, loading: false, error: null });
    rerender(canvas());
    expect(queryByTestId('focused-effect')).not.toBeInTheDocument();
    vi.mocked(useShaderRenderer).mockReturnValue({ ready: false, loading: false, error: null });
    rerender(canvas(null));
    expect(queryByTestId('focused-effect')).not.toBeInTheDocument();
  });
});
