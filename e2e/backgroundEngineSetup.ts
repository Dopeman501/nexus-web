import { build } from 'vite';
import { fileURLToPath } from 'node:url';
export default async function setup() {
  await build({ configFile: fileURLToPath(new URL('./fixtures/transition-engines/vite.config.ts', import.meta.url)) });
}
