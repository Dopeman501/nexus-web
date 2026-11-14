import { inflateSync } from 'node:zlib';

/** Decode Playwright's non-interlaced eight-bit RGB/RGBA PNGs without another dependency. */
export function decodePng(png: Buffer): Uint8Array {
  if (!png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error('Expected PNG');
  let width = 0, height = 0, channels = 0;
  const chunks: Buffer[] = [];
  for (let offset = 8; offset < png.length;) {
    const length = png.readUInt32BE(offset);
    const kind = png.toString('ascii', offset + 4, offset + 8);
    const data = png.subarray(offset + 8, offset + 8 + length);
    if (kind === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      channels = data[9] === 6 ? 4 : data[9] === 2 ? 3 : 0;
      if (data[8] !== 8 || !channels || data[12] !== 0) throw new Error('Unsupported PNG layout');
    }
    if (kind === 'IDAT') chunks.push(data);
    offset += length + 12;
  }
  const raw = inflateSync(Buffer.concat(chunks));
  const stride = width * channels;
  const decoded = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const at = y * stride + x;
      const left = x >= channels ? decoded[at - channels] : 0;
      const above = y ? decoded[at - stride] : 0;
      const upperLeft = y && x >= channels ? decoded[at - stride - channels] : 0;
      let predictor = 0;
      if (filter === 1) predictor = left;
      else if (filter === 2) predictor = above;
      else if (filter === 3) predictor = Math.floor((left + above) / 2);
      else if (filter === 4) {
        const p = left + above - upperLeft;
        const a = Math.abs(p - left), b = Math.abs(p - above), c = Math.abs(p - upperLeft);
        predictor = a <= b && a <= c ? left : b <= c ? above : upperLeft;
      } else if (filter !== 0) throw new Error('Unsupported PNG filter');
      decoded[at] = raw[y * (stride + 1) + x + 1] + predictor;
    }
  }
  const rgb = new Uint8Array(width * height * 3);
  for (let source = 0, target = 0; source < decoded.length; source += channels) {
    rgb[target++] = decoded[source]; rgb[target++] = decoded[source + 1]; rgb[target++] = decoded[source + 2];
  }
  return rgb;
}

export function pixelDifference(a: Uint8Array, b: Uint8Array) {
  if (a.length !== b.length) throw new Error('Screenshots have different dimensions');
  let changed = 0, absolute = 0;
  for (let at = 0; at < a.length; at += 3) {
    let largest = 0;
    for (let channel = 0; channel < 3; channel++) {
      const delta = Math.abs(a[at + channel] - b[at + channel]);
      absolute += delta; largest = Math.max(largest, delta);
    }
    if (largest > 12) changed++;
  }
  return { changedFraction: changed / (a.length / 3), meanChannelError: absolute / a.length };
}
