import { describe, expect, it } from 'vitest';
import { copyPreset, parsePreset, PRESETS } from '../src/core/presets';
import { colorStatistics, mappingParameters, paletteRamp, regionSamples, sourceAnchors, type Color } from '../src/render/palette-mapping';

describe('experimental palette interpretation', () => {
  it('keeps legacy presets on the current method and validates portable experiments', () => {
    const preset = copyPreset(PRESETS[0]);
    const legacy = JSON.parse(JSON.stringify(preset));
    delete legacy.foreground.colorMapping; delete legacy.background.colorMapping;
    const expectedLegacy=copyPreset(preset);
    expectedLegacy.foreground.colorMapping.mode='nearest';expectedLegacy.background.colorMapping.mode='nearest';
    expect(parsePreset(JSON.stringify(legacy))).toEqual(expectedLegacy);
    for (const mode of ['mood', 'correspondence', 'ramp'] as const) {
      preset.foreground.colorMapping.mode = mode;
      expect(parsePreset(JSON.stringify(preset))).toEqual(preset);
    }
    for (const value of [{ mode: 'unknown' }, { strength: -1 }, { strength: 1.01 }, { ramp: ['#ffffff'] }, { ramp: Array(5).fill('red') }]) {
      const bad = copyPreset(preset); Object.assign(bad.foreground.colorMapping, value);
      expect(() => parsePreset(JSON.stringify(bad))).toThrow();
    }
  });
  it('orders automatic ramp tones regardless of swatch order and drops obsolete authored stops', () => {
    const palette = ['#ffffff', '#000000', '#777777'];
    expect(paletteRamp(palette)).toEqual(paletteRamp([...palette].reverse()));
    expect(paletteRamp(palette)[0]).toBe('#000000'); expect(paletteRamp(palette)[4]).toBe('#ffffff');
    const authored = ['#ffffff', '#777777', '#000000', '#777777', '#ffffff'];
    expect(paletteRamp(palette, authored)).toEqual(authored);
    expect(paletteRamp(['#abcdef', '#000000'], Array(5).fill('#ABCDEF'))).toEqual(Array(5).fill('#abcdef'));
    expect(paletteRamp(['#000000', '#888888'], authored)).not.toContain('#777777');
  });
  it('finds minority color families deterministically instead of selecting only dominant shades', () => {
    const colors: Color[] = [...Array.from({ length: 200 }, () => [0.5, 0, 0] as Color), [0.5, 0.2, 0], [0.5, 0, 0.2]];
    const anchors = sourceAnchors(colors, 3);
    expect(anchors).toEqual(sourceAnchors([...colors].reverse(), 3));
    expect(anchors).toHaveLength(3);
    expect(anchors.some(c => c[1] > 0.19)).toBe(true); expect(anchors.some(c => c[2] > 0.19)).toBe(true);
  });
  it('handles flat and empty source regions without invented clusters or invalid statistics', () => {
    const style = copyPreset(PRESETS[0]).foreground;
    for (const samples of [[], [[0, 0, 0]], [[1, 1, 1]], Array(32).fill([0.5, 0.5, 0.5])] as Color[][]) {
      const result = mappingParameters(samples, style);
      expect(result.source).toHaveLength(samples.length ? 1 : 0);
      expect([...result.sourceStats.mean, ...result.sourceStats.spread, ...result.targetStats.spread].every(Number.isFinite)).toBe(true);
      expect(result.range.every(Number.isFinite)).toBe(true);
      expect(result.range[1] - result.range[0]).toBeGreaterThanOrEqual(0.1499);
    }
    expect(colorStatistics([[0.5, 0, 0], [0.5, 0, 0]]).spread).toEqual([0, 0, 0]);
  });
  it('samples confident region ownership with top-left masks and ignores uncertain/transparent pixels', () => {
    const pixels = new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 0]);
    const samples = regionSamples(pixels, 2, 2, new Float32Array([1, 0, 0.5, 1]), 2, 2);
    expect(samples).toEqual([[[1, 0, 0]], [[0, 1, 0]]]);
    expect(regionSamples(pixels, 2, 2)[0]).toHaveLength(3);
  });
});
