import type { DepthField, DepthStatus, FramePacket } from '../core/types';
import { sceneDifference } from '../core/scene';
import { type DepthRequest, type DepthResponse } from './depth-field';
import { DepthHistory } from './depth-history';

/** One in-flight snapshot, no frame queue. Rendering and person separation remain independent. */
export class SceneDepthEstimator {
  private worker?: Worker;
  private ready = false;
  private failed = false;
  private pending = false;
  private epoch = 0;
  private id = 0;
  private lastRequest = -Infinity;
  private history = new DepthHistory();
  private previousScene?: Uint8ClampedArray;
  private generation?: number;
  private request?: { id: number; epoch: number; timestamp: number; generation: number };
  private timer?: ReturnType<typeof setTimeout>;
  private status: DepthStatus = 'off';
  constructor(private notify: (status: DepthStatus, message?: string) => void, private repaint: () => void) {}
  private report(status: DepthStatus, message?: string) {
    if (status === this.status && !message) return;
    this.status = status; this.notify(status, message);
  }
  private post(message: DepthRequest, transfer: Transferable[] = []) { this.worker!.postMessage(message, transfer); }
  private initialize() {
    this.report('loading');
    const worker = this.worker = new Worker(new URL('./depth.worker.ts', import.meta.url), { type: 'module' });
    this.timer = setTimeout(() => this.fail('The depth model took too long to download.'), 120_000);
    worker.onerror = event => { event.preventDefault(); if (this.worker === worker) this.fail(event.message || 'The depth worker stopped.'); };
    worker.onmessage = (event: MessageEvent<DepthResponse>) => {
      if (this.worker !== worker) return;
      const result = event.data;
      clearTimeout(this.timer);
      if (result.type === 'error') { this.fail(result.message); return; }
      if (result.type === 'ready') { this.ready = true; this.report('estimating'); this.repaint(); return; }
      this.pending = false;
      const request = this.request;
      if (!request || result.id !== request.id || request.epoch !== this.epoch) return;
      // A single flat/invalid prediction must not erase a useful field between successful estimates.
      if (result.values && result.values.length === result.width * result.height) {
        const now = performance.now();
        const latency = Math.max(Number.isFinite(result.inferenceMs) ? result.inferenceMs : 0, now - this.lastRequest);
        this.history.accept({ values: result.values, width: result.width, height: result.height, timestamp: request.timestamp, generation: request.generation }, latency, now);
      }
      this.repaint();
    };
    this.post({ type: 'initialize' });
  }
  update(frame: FramePacket, scene: Uint8ClampedArray): DepthField | undefined {
    // Compare adjacent frames for cuts, not each frame against an increasingly old snapshot.
    if ((this.generation !== undefined && this.generation !== frame.generation) || (this.previousScene && sceneDifference(this.previousScene, scene) > 0.22)) this.reset();
    this.generation = frame.generation; this.previousScene = scene.slice();
    if (this.failed) return this.history.sample(frame.timestamp, frame.generation, performance.now());
    if (!this.worker) {
      try { this.initialize(); } catch (error) { this.fail(String(error)); return; }
    }
    const needsEstimate = this.request?.timestamp !== frame.timestamp || this.request.epoch !== this.epoch || this.request.generation !== frame.generation;
    if (this.ready && !this.pending && needsEstimate && performance.now() - this.lastRequest >= 250) {
      this.pending = true; this.lastRequest = performance.now();
      const request = this.request = { id: ++this.id, epoch: this.epoch, timestamp: frame.timestamp, generation: frame.generation };
      // Resize the copy, never transfer the image owned by the renderer or segmenter.
      void createImageBitmap(frame.image, { resizeWidth: 384, resizeHeight: Math.max(1, Math.round(384 * frame.image.height / frame.image.width)) }).then(image => {
        if (!this.worker || request.epoch !== this.epoch) { image.close(); if (this.request === request) this.pending = false; return; }
        this.timer = setTimeout(() => this.fail('Depth estimation stopped responding.'), 15_000);
        this.post({ type: 'estimate', id: request.id, image }, [image]);
      }).catch(error => { if (request.epoch === this.epoch) this.fail(String(error)); });
    }
    const field = this.history.sample(frame.timestamp, frame.generation, performance.now());
    if (this.ready) this.report(field ? frame.timestamp - field.timestamp > field.maxAgeMs! - 1000 ? 'holding' : 'ready' : this.history.hasEstimate ? 'stale' : 'estimating');
    return field;
  }
  get needsRepaint() { return this.history.needsRepaint; }
  reset() { this.epoch++; this.history.reset(); this.previousScene = undefined; this.generation = undefined; this.lastRequest = -Infinity; }
  private fail(message: string) {
    this.failed = true; this.pending = false; clearTimeout(this.timer); this.worker?.terminate(); this.worker = undefined;
    this.history.stop(performance.now()); this.report('error', message); this.repaint();
  }
  dispose() { this.reset(); clearTimeout(this.timer); this.worker?.terminate(); this.worker = undefined; this.request = undefined; this.ready = false; this.pending = false; this.failed = false; this.report('off'); }
}
