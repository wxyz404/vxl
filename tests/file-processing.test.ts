import { afterEach, describe, expect, it, vi } from 'vitest';
import { processingPolicy, settleFrame } from '../src/core/file-processing';
import { parsePreset, PRESETS } from '../src/core/presets';

afterEach(() => vi.useRealTimers());
describe('uploaded-media processing policy', () => {
  it('keeps old presets off and bounds imported effort', () => {
    const { fileProcessing: _effort, ...legacy } = PRESETS[0];
    expect(parsePreset(JSON.stringify(legacy)).fileProcessing).toBe(0);
    for (const effort of [-1, 0.5, 5]) expect(() => parsePreset(JSON.stringify({ ...legacy, fileProcessing: effort }))).toThrow();
    expect([0, 1, 2, 3, 4].map(level => processingPolicy(level))).toEqual([
      { passes: 0, waitMs: 0 }, { passes: 1, waitMs: 250 }, { passes: 2, waitMs: 750 },
      { passes: 3, waitMs: 1500 }, { passes: 4, waitMs: 3000 },
    ]);
  });
  it('waits for the held frame rather than ending on the first empty estimate', async () => {
    vi.useFakeTimers(); let complete = false;
    const step = vi.fn(() => complete), work = settleFrame(step, 750, new AbortController().signal);
    await vi.advanceTimersByTimeAsync(300); complete = true;
    await vi.advanceTimersByTimeAsync(16);
    expect(await work).toEqual({ cancelled: false, expired: false });
    expect(step.mock.calls.length).toBeGreaterThan(1);
  });
  it('bounds slow workers and cancels promptly on source or setting changes', async () => {
    vi.useFakeTimers(); const controller = new AbortController();
    const timed = settleFrame(() => false, 250, controller.signal);
    await vi.advanceTimersByTimeAsync(250);
    expect(await timed).toEqual({ cancelled: false, expired: true });
    const cancelled = settleFrame(() => false, 3000, controller.signal);
    controller.abort();
    expect(await cancelled).toEqual({ cancelled: true, expired: false });
    expect(vi.getTimerCount()).toBe(0);
  });
});
