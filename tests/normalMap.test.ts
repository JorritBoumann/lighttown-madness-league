import { describe, it, expect } from 'vitest';
import { heightToNormals } from '../src/render/textures';

/**
 * The fast normal-map filter against the one it replaced, which is kept here
 * verbatim: the arena has to look exactly as it did, only built sooner.
 */

function reference(src: Uint8ClampedArray, size: number, strength: number, out: Uint8ClampedArray): void {
  const at = (x: number, y: number): number => {
    const xi = ((x % size) + size) % size;
    const yi = ((y % size) + size) % size;
    return src[(yi * size + xi) * 4]! / 255;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx =
        at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1) -
        (at(x - 1, y - 1) + 2 * at(x - 1, y) + at(x - 1, y + 1));
      const dy =
        at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1) -
        (at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1));
      const nx = -dx * strength;
      const ny = -dy * strength;
      const len = Math.hypot(nx, ny, 1);
      const i = (y * size + x) * 4;
      out[i] = ((nx / len) * 0.5 + 0.5) * 255;
      out[i + 1] = ((ny / len) * 0.5 + 0.5) * 255;
      out[i + 2] = ((1 / len) * 0.5 + 0.5) * 255;
      out[i + 3] = 255;
    }
  }
}

function heights(size: number, seed: number): Uint8ClampedArray {
  const src = new Uint8ClampedArray(size * size * 4);
  let s = seed;
  for (let i = 0; i < size * size; i++) {
    s = (s * 1103515245 + 12345) >>> 0;
    // Mostly smooth with sharp edges, like the drawn height fields.
    src[i * 4] = (s >>> 24) > 200 ? 255 : 128 + ((s >>> 16) % 7);
  }
  return src;
}

describe('heightToNormals', () => {
  it.each([1, 2, 3, 17, 64, 256])('matches the original filter byte for byte at %i px', (size) => {
    for (const strength of [0.8, 2.2, 3.2]) {
      const src = heights(size, size * 31 + Math.round(strength * 10));
      const want = new Uint8ClampedArray(size * size * 4);
      const got = new Uint8ClampedArray(size * size * 4);
      reference(src, size, strength, want);
      heightToNormals(src, size, strength, got);
      expect(Buffer.from(got).equals(Buffer.from(want))).toBe(true);
    }
  });

  it('is faster than the original', () => {
    const size = 512;
    const src = heights(size, 7);
    const out = new Uint8ClampedArray(size * size * 4);
    const time = (fn: () => void): number => {
      fn();
      const t = performance.now();
      for (let i = 0; i < 3; i++) fn();
      return (performance.now() - t) / 3;
    };
    const before = time(() => reference(src, size, 2.2, out));
    const after = time(() => heightToNormals(src, size, 2.2, out));
    console.log(`512px normal map: ${before.toFixed(1)}ms before, ${after.toFixed(1)}ms after`);
    expect(after).toBeLessThan(before);
  });
});
