import { describe, expect, it } from 'vitest';
import { DepthHistory } from '../src/vision/depth-history';
import { MAX_DEPTH_REUSE, usableDepth } from '../src/vision/depth-field';

const field = (timestamp = 0, value = 0.8) => ({ values: new Float32Array(4).fill(value), width: 2, height: 2, timestamp, generation: 1 });
describe('continuous presentation of sparse live depth', () => {
  it('covers multiple slow inference cycles without dropping styling at the old one-second limit', () => {
    const history = new DepthHistory();
    history.accept(field(), 1800, 1800);
    expect(history.sample(1800, 1, 1800)?.strength).toBe(0);
    expect(history.sample(2100, 1, 2100)?.strength).toBe(1);
    for (let t = 2200; t < 6000; t += 50) {
      const depth = history.sample(t, 1, t);
      expect(depth?.strength).toBe(1); expect(usableDepth(depth, t, 1)).toBe(true);
    }
    history.accept(field(4200, 0.6), 1800, 6000);
    expect(history.sample(6000, 1, 6000)?.strength).toBe(1);
    expect(history.sample(6000, 1, 6000)?.values[0]).toBeCloseTo(0.8);
    expect(history.sample(6150, 1, 6150)?.values[0]).toBeCloseTo(0.7);
    expect(history.sample(6300, 1, 6300)?.values[0]).toBeCloseTo(0.6);
  });
  it('fades genuinely old estimates to zero before bounded expiry and recovers smoothly', () => {
    const history = new DepthHistory(); history.accept(field(), 30, 0);
    expect(history.sample(300, 1, 300)?.strength).toBe(1);
    expect(history.sample(3000, 1, 3000)?.strength).toBe(1);
    expect(history.sample(3500, 1, 3500)?.strength).toBeCloseTo(0.5);
    expect(history.sample(4000, 1, 4000)?.strength).toBe(0);
    expect(history.sample(4001, 1, 4001)).toBeUndefined();
    history.accept(field(4100), 30, 4100);
    expect(history.sample(4100, 1, 4100)?.strength).toBe(0);
    expect(history.sample(4250, 1, 4250)?.strength).toBeCloseTo(0.5);
    expect(history.sample(4400, 1, 4400)?.strength).toBe(1);
    history.accept(field(4500), 60_000, 4500);
    expect(history.sample(4500, 1, 4500)?.maxAgeMs).toBe(MAX_DEPTH_REUSE);
    expect(history.sample(4501 + MAX_DEPTH_REUSE, 1, 4501 + MAX_DEPTH_REUSE)).toBeUndefined();
  });
  it('animates matching paused frames, fades worker failures, and never blends across resets/sources', () => {
    const history = new DepthHistory(); history.accept(field(100), 1500, 10_000);
    expect(history.sample(100, 1, 10_150)?.strength).toBeCloseTo(0.5);
    expect(history.needsRepaint).toBe(true);
    expect(history.sample(100, 1, 10_300)?.strength).toBe(1);
    expect(history.needsRepaint).toBe(false);
    history.stop(11_000);
    expect(history.sample(100, 1, 11_500)?.strength).toBeCloseTo(0.5);
    expect(history.sample(100, 1, 12_000)).toBeUndefined();
    history.reset(); expect(history.sample(100, 1, 12_000)).toBeUndefined(); expect(history.needsRepaint).toBe(false);
    history.accept(field(100, 0.2), 1500, 13_000);
    expect(history.sample(100, 2, 13_300)).toBeUndefined();
    expect(history.sample(100, 1, 13_300)?.values[0]).toBeCloseTo(0.2);
  });
});
