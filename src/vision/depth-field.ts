import type { DepthField } from '../core/types';

export const MAX_DEPTH_AGE = 1000;
export const MAX_DEPTH_REUSE = 12_000;
export function usableDepth(field: DepthField | undefined, timestamp: number, generation: number) {
  const budget = field?.maxAgeMs ?? MAX_DEPTH_AGE;
  return Boolean(field && Number.isFinite(budget) && budget > 0 && budget <= MAX_DEPTH_REUSE && field.generation === generation && timestamp >= field.timestamp && timestamp - field.timestamp <= budget &&
    field.width > 0 && field.height > 0 && field.values.length === field.width * field.height);
}
export function depthPlane(distance: number): 'foreground' | 'middle ground' | 'background' {
  return distance < 1 / 3 ? 'foreground' : distance < 2 / 3 ? 'middle ground' : 'background';
}

/** Depth Anything returns inverse relative depth: larger means nearer. Reject flat/invalid output. */
export function normalizeDepth(input: Float32Array): Float32Array | undefined {
  if (!input.length || input.some(value => !Number.isFinite(value))) return;
  const sorted = input.slice().sort();
  const low = sorted[Math.floor((sorted.length - 1) * 0.02)];
  const high = sorted[Math.floor((sorted.length - 1) * 0.98)];
  if (high - low < 1e-5) return;
  return input.map(value => 1 - Math.max(0, Math.min(1, (value - low) / (high - low))));
}

export type DepthRequest = { type: 'initialize' } | { type: 'estimate'; id: number; image: ImageBitmap };
export type DepthResponse = { type: 'ready' } | { type: 'error'; message: string } |
  { type: 'result'; id: number; values?: Float32Array; width: number; height: number; inferenceMs: number };
