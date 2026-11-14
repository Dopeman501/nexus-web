import { expect, type Page, type TestInfo } from '@playwright/test';
import { inflateSync } from 'node:zlib';
import { picture } from './backgroundTransitionsFixture';

export function pixels(png: Buffer): Uint8Array {
  let width = 0, height = 0, channels = 0;
  const chunks: Buffer[] = [];
  for (let offset = 8; offset < png.length;) {
    const size = png.readUInt32BE(offset), kind = png.toString('ascii', offset + 4, offset + 8);
    const data = png.subarray(offset + 8, offset + 8 + size);
    if (kind === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      if (data[8] !== 8 || ![2, 6].includes(data[9]) || data[12] !== 0) throw new Error('Unsupported PNG');
      channels = data[9] === 6 ? 4 : 3;
    } else if (kind === 'IDAT') chunks.push(data);
    offset += size + 12;
  }
  const raw = inflateSync(Buffer.concat(chunks)), stride = width * channels;
  const output = new Uint8Array(width * height * 3), previous = new Uint8Array(stride);
  const paeth = (a: number, b: number, c: number) => {
    const estimate = a + b - c, aa = Math.abs(estimate - a), bb = Math.abs(estimate - b), cc = Math.abs(estimate - c);
    return aa <= bb && aa <= cc ? a : bb <= cc ? b : c;
  };
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)], line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const decoded = new Uint8Array(stride);
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? decoded[x - channels] : 0, up = previous[x], corner = x >= channels ? previous[x - channels] : 0;
      const predictor = filter === 0 ? 0 : filter === 1 ? left : filter === 2 ? up : filter === 3 ? Math.floor((left + up) / 2) : paeth(left, up, corner);
      decoded[x] = (line[x] + predictor) & 255;
    }
    for (let x = 0; x < width; x++) output.set(decoded.subarray(x * channels, x * channels + 3), (y * width + x) * 3);
    previous.set(decoded);
  }
  return output;
}
export function difference(left: Uint8Array, right: Uint8Array) {
  expect(left.length).toBe(right.length);
  let total = 0;
  for (let i = 0; i < left.length; i++) total += Math.abs(left[i] - right[i]);
  return total / left.length;
}
export const shot = async (page: Page, info: TestInfo, name: string) => pixels(await page.locator('.panel-root').screenshot({ path: info.outputPath(`${name}.png`) }));
export async function reference(page: Page, id: string): Promise<Uint8Array> {
  await page.evaluate(async source => {
    const image = document.createElement('img'); image.dataset.fixtureReference = '';
    image.src = 'data:image/svg+xml;base64,' + btoa(source);
    image.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;object-fit:cover;z-index:2147483647';
    await image.decode(); document.body.append(image);
  }, picture(id));
  try { return pixels(await page.locator('.panel-root').screenshot()); }
  finally { await page.locator('[data-fixture-reference]').evaluate(element => element.remove()); }
}
export function endpoints(start: Uint8Array, middle: Uint8Array, end: Uint8Array, expectedStart: Uint8Array, expectedEnd: Uint8Array) {
  expect(difference(start, expectedStart)).toBeLessThan(5);
  expect(difference(end, expectedEnd)).toBeLessThan(5);
  expect(difference(middle, expectedStart)).toBeGreaterThan(2);
  expect(difference(middle, expectedEnd)).toBeGreaterThan(2);
  expect(difference(start, end)).toBeGreaterThan(20);
}
