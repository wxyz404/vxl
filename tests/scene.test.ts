import { expect, it } from 'vitest';
import { sceneDifference } from '../src/core/scene';

it('distinguishes stationary/noisy frames from a cut and ignores alpha changes', () => {
  const original = new Uint8ClampedArray([100, 120, 140, 255, 100, 120, 140, 255]);
  expect(sceneDifference(original, new Uint8ClampedArray([101, 119, 141, 0, 99, 121, 139, 0]))).toBeLessThan(0.01);
  expect(sceneDifference(original, new Uint8ClampedArray([0, 0, 0, 255, 0, 0, 0, 255]))).toBeGreaterThan(0.22);
  expect(sceneDifference(original, original)).toBe(0);
});
