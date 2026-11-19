import { build } from 'vite';
import { fileURLToPath } from 'node:url';
import { ensureVideoFixtures } from './backgroundVideoFixtures';

export default async function setup() {
  ensureVideoFixtures();
  await build({ configFile: fileURLToPath(new URL('./fixtures/efficiency-circle/vite.config.ts', import.meta.url)) });
}
