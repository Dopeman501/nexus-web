// Promoted from the verified selected sampler engine; see PROVENANCE.md.
import { DataTexture, LinearFilter, RGBAFormat, UnsignedByteType } from 'three';

const MASK_SIZE = 64;

/** Local deterministic data, never an external URL or copied demo artwork. */
export function createGlMask(sampler: string): DataTexture {
  if (sampler !== 'displacementMap' && sampler !== 'luma') {
    throw new Error(`Unsupported GL auxiliary sampler: ${sampler}`);
  }
  const pixels = new Uint8Array(MASK_SIZE * MASK_SIZE * 4);
  for (let y = 0; y < MASK_SIZE; y++) {
    for (let x = 0; x < MASK_SIZE; x++) {
      const u = x / (MASK_SIZE - 1);
      const v = y / (MASK_SIZE - 1);
      const value = sampler === 'displacementMap'
        ? 0.5 + 0.23 * Math.sin(u * Math.PI * 6) + 0.22 * Math.cos(v * Math.PI * 4)
        : Math.min(1, Math.hypot(u - 0.5, v - 0.5) / Math.SQRT1_2);
      const shade = Math.round(Math.max(0, Math.min(1, value)) * 255);
      const offset = (y * MASK_SIZE + x) * 4;
      pixels.set([shade, shade, shade, 255], offset);
    }
  }
  const texture = new DataTexture(pixels, MASK_SIZE, MASK_SIZE, RGBAFormat, UnsignedByteType);
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.needsUpdate = true;
  return texture;
}
