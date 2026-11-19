import { mergeConfig, defineConfig } from 'vitest/config';
import base from './vitest.config';

// Keep complete owners in the denominator, including their failure paths.
export default mergeConfig(base, defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reportsDirectory: '../builds/nexus-efficiency-20261117/web/coverage',
      reporter: ['text', 'json', 'json-summary', 'lcov'],
      include: [
        'src/panel/PanelApp.tsx',
        'src/panel/background/PanelBackgroundShader.tsx',
        'src/panel/background/AudioTriggerBackgroundLayer.tsx',
        'src/panel/d215/D215PanelsLayer.tsx',
        'src/panel/d215/D215PanelFace.tsx',
        'src/panel/d215/D215PanelBackgroundLayer.tsx',
        'src/panel/webview/webViewHost.ts',
      ],
      thresholds: { perFile: true, lines: 80, branches: 80 },
    },
  },
}));
