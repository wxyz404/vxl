import { describe, expect, it } from 'vitest';
import { copyPreset, hexRgb, logicalSize, parsePalette, parsePreset, PRESETS } from '../src/core/presets';

describe('portable styles', () => {
  it('round-trips the bundled presets without sharing mutable palette arrays', () => {
    for (const preset of PRESETS) {
      expect(parsePreset(JSON.stringify(preset))).toEqual(preset);
      const clone = copyPreset(preset); clone.foreground.palette[0] = '#ffffff';
      expect(preset.foreground.palette[0]).not.toBe('#ffffff');
    }
  });
  it('rejects incompatible versions, bad colors, missing fields, and dangerous shader settings', () => {
    const original = PRESETS[0];
    const invalid = [
      { ...original, version: 2 }, { ...original, resolution: 0 }, { ...original, stability: -1 },
      { ...original, foreground: { ...original.foreground, palette: ['#fff', '#000'] } },
      { ...original, background: { ...original.background, outlineWidth: 50 } },
      { ...original, foreground: { ...original.foreground, palette: new Array(33).fill('#ffffff') } },
      { ...original, background: undefined },
    ];
    for (const value of invalid) expect(() => parsePreset(JSON.stringify(value))).toThrow();
  });
  it('accepts palette arrays and named palette objects, rejecting arbitrary input', () => {
    expect(parsePalette('["#112233", "#abcdef"]')).toEqual(['#112233', '#abcdef']);
    expect(parsePalette('{"name":"Test","colors":["#112233","#abcdef"]}')).toEqual(['#112233', '#abcdef']);
    for (const text of ['null', '{}', '[]', '["red","blue"]', '["#123456"]']) expect(() => parsePalette(text)).toThrow();
  });
});
describe('logical pixel grid', () => {
  it('preserves landscape, portrait, and unusual source proportions', () => {
    expect(logicalSize(1920, 1080, 320)).toEqual([320, 180]);
    expect(logicalSize(1080, 1920, 160)).toEqual([90, 160]);
    expect(logicalSize(640, 480, 320)).toEqual([320, 240]);
    expect(logicalSize(32, 16, 160)).toEqual([32, 16]);
    expect(logicalSize(10000, 1, 160)).toEqual([160, 1]);
  });
  it('converts palette colors without changing their values', () => {
    expect(hexRgb('#ff0080')).toEqual([1, 0, 128 / 255]);
  });
});
