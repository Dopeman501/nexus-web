import { ensureVideoFixtures } from './backgroundVideoFixtures';
import { build } from 'vite';
import { fileURLToPath } from 'node:url';
export default async function setup() {
  ensureVideoFixtures();
  await build({ configFile: fileURLToPath(new URL('./fixtures/video-core/vite.config.ts', import.meta.url)) });
}
