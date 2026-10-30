import { describe, expect, it } from 'vitest';
import { paletteFromPixels } from '../src/core/palette-import';

describe('PNG palette colors', () => {
  it('preserves first-seen order, removes duplicates, and skips transparent pixels', () => {
    expect(paletteFromPixels(new Uint8ClampedArray([
      17, 34, 51, 255, 255, 0, 255, 0, 171, 205, 239, 255,
      17, 34, 51, 255, 0, 0, 0, 128,
    ]))).toEqual(['#112233', '#abcdef', '#000000']);
  });

  it('accepts the full 32-color renderer limit', () => {
    const pixels = new Uint8ClampedArray(Array.from({ length: 32 }, (_, i) => [i, 0, 0, 255]).flat());
    expect(paletteFromPixels(pixels)).toHaveLength(32);
  });

  it('rejects an image with more colors than the renderer can use', () => {
    const pixels = new Uint8ClampedArray(Array.from({ length: 33 }, (_, i) => [i, 0, 0, 255]).flat());
    expect(() => paletteFromPixels(pixels)).toThrow('more than 32 colors');
  });

  it('rejects empty, transparent, and single-color images', () => {
    for (const pixels of [[], [255, 0, 0, 0], [0, 0, 0, 255, 0, 0, 0, 255]]) {
      expect(() => paletteFromPixels(new Uint8ClampedArray(pixels))).toThrow('at least 2 distinct colors');
    }
  });
});
