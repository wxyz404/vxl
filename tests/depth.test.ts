import { describe, expect, it } from 'vitest';
import { copyPreset, parsePreset, PRESETS } from '../src/core/presets';
import { depthPlane, MAX_DEPTH_AGE, normalizeDepth, usableDepth } from '../src/vision/depth-field';

describe('relative scene depth', () => {
  it('converts inverse depth to near-zero / far-one and clips outliers', () => {
    const values = Float32Array.from({ length: 101 }, (_, i) => i);
    const depth = normalizeDepth(values)!;
    expect(depth[0]).toBe(1); expect(depth[100]).toBe(0); expect(depth[50]).toBeCloseTo(0.5);
    expect(normalizeDepth(new Float32Array([1, 1, 1]))).toBeUndefined();
    expect(normalizeDepth(new Float32Array([1, NaN, 3]))).toBeUndefined();
    expect(normalizeDepth(new Float32Array())).toBeUndefined();
  });
  it('does not reuse old, future, malformed, or other-source depth fields', () => {
    const field = { values: new Float32Array(4), width: 2, height: 2, generation: 3, timestamp: 100 };
    expect(usableDepth(field, 100 + MAX_DEPTH_AGE, 3)).toBe(true);
    expect(usableDepth(field, 101 + MAX_DEPTH_AGE, 3)).toBe(false);
    expect(usableDepth(field, 99, 3)).toBe(false);
    expect(usableDepth(field, 100, 4)).toBe(false);
    expect(usableDepth({ ...field, width: 3 }, 100, 3)).toBe(false);
    expect(usableDepth(undefined, 100, 3)).toBe(false);
    expect(usableDepth({ ...field, maxAgeMs: 6000 }, 5100, 3)).toBe(true);
    expect(usableDepth({ ...field, maxAgeMs: Infinity }, 100, 3)).toBe(false);
    expect(usableDepth({ ...field, maxAgeMs: 12_001 }, 100, 3)).toBe(false);
  });
  it('labels thirds and upgrades old presets with disabled, independent depth settings', () => {
    expect([0, 1 / 3, 2 / 3, 1].map(depthPlane)).toEqual(['foreground', 'middle ground', 'background', 'background']);
    const old = { ...copyPreset(PRESETS[0]) } as Record<string, unknown>; delete old.depth;
    const first = parsePreset(JSON.stringify(old)), second = parsePreset(JSON.stringify(old));
    expect(first.depth.enabled).toBe(false);
    first.depth.haze = 1; expect(second.depth.haze).toBe(0.12);
    expect(() => parsePreset(JSON.stringify({ ...old, depth: { enabled: true, haze: -1 } }))).toThrow();
  });
});
