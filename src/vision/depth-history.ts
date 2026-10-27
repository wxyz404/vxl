import type { DepthField } from '../core/types';
import { MAX_DEPTH_REUSE, usableDepth } from './depth-field';

const BLEND_MS = 300, FADE_MS = 1000;
const smooth = (value: number) => { const t = Math.max(0, Math.min(1, value)); return t * t * (3 - 2 * t); };

/** Present sparse estimates continuously, without pretending that old measurements are new. */
export class DepthHistory {
  private target?: DepthField;
  private from?: Float32Array;
  private presented?: DepthField;
  private transitionStarted = 0;
  private initialStrength = 0;
  private failureStarted?: number;
  private failureStrength = 0;
  needsRepaint = false;
  get hasEstimate() { return Boolean(this.target); }

  accept(field: DepthField, inferenceMs: number, now: number) {
    const previous = this.presented;
    const compatible = previous && previous.generation === field.generation && previous.width === field.width && previous.height === field.height;
    this.from = compatible ? previous.values : undefined;
    this.initialStrength = compatible ? previous.strength ?? 1 : 0;
    // Cover several complete inference cycles, including capture/transfer overhead. Keep a hard cap.
    const holdMs = Math.min(MAX_DEPTH_REUSE - FADE_MS, Math.max(3000, 3 * (inferenceMs + 250)));
    this.target = { ...field, maxAgeMs: holdMs + FADE_MS };
    this.transitionStarted = now; this.failureStarted = undefined;
    this.needsRepaint = true;
  }

  sample(timestamp: number, generation: number, now: number): DepthField | undefined {
    const target = this.target;
    if (!target || !usableDepth(target, timestamp, generation)) { this.presented = undefined; this.needsRepaint = false; return; }
    const blend = smooth((now - this.transitionStarted) / BLEND_MS);
    const age = timestamp - target.timestamp, holdMs = target.maxAgeMs! - FADE_MS;
    const freshness = 1 - smooth((age - holdMs) / FADE_MS);
    let strength = this.initialStrength + (1 - this.initialStrength) * blend;
    strength *= freshness;
    if (this.failureStarted !== undefined) strength = Math.min(strength, this.failureStrength * (1 - smooth((now - this.failureStarted) / FADE_MS)));
    let values = target.values;
    if (this.from && blend < 1) values = values.map((value, i) => this.from![i] + (value - this.from![i]) * blend);
    this.presented = { ...target, values, strength };
    this.needsRepaint = blend < 1 || (this.failureStarted !== undefined && now - this.failureStarted < FADE_MS);
    return this.failureStarted !== undefined && strength === 0 ? undefined : this.presented;
  }

  stop(now: number) {
    this.failureStarted = now; this.failureStrength = this.presented?.strength ?? 0;
    this.needsRepaint = Boolean(this.presented);
  }
  reset() {
    this.target = undefined; this.presented = undefined; this.from = undefined;
    this.failureStarted = undefined; this.needsRepaint = false;
  }
}
