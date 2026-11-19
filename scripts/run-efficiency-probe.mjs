import { build } from 'esbuild';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Run from nexus-web. Only this checked-in entry is bundled; generated output
// is an ignored cache, never a clean-checkout prerequisite or product asset.
const output = resolve('.playwright/efficiency-runtime-probe.mjs');
mkdirSync(resolve('.playwright'), { recursive: true });
await build({ entryPoints: ['e2e/efficiencyRuntimeProbe.ts'], outfile: output, bundle: true,
  platform: 'node', format: 'esm', packages: 'external' });
await import(pathToFileURL(output).href);
