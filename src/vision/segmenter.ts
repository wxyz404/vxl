import type { FramePacket, Segmenter } from '../core/types';
import type { VisionRequest, VisionResponse } from './protocol';

export class PersonSegmenter implements Segmenter {
  private worker?: Worker;
  private nextId = 0;
  private initializePromise?: Promise<void>;
  private rejectInitialization?: (reason: Error) => void;
  private initializeTimer?: ReturnType<typeof setTimeout>;
  private pending = new Map<number, { frame: Omit<FramePacket, 'image'>; resolve: (value: FramePacket) => void; reject: (reason: Error) => void; timer: ReturnType<typeof setTimeout> }>();

  initialize(): Promise<void> {
    if (this.initializePromise) return this.initializePromise;
    this.initializePromise = new Promise<void>((resolve, reject) => {
      this.rejectInitialization = reject;
      this.worker = new Worker(new URL('./segment.worker.ts', import.meta.url), { type: 'module' });
      const timer = this.initializeTimer = setTimeout(() => this.fail(new Error('Person segmentation took too long to load. Check local model setup and retry.')), 60_000);
      this.worker.onmessage = (event: MessageEvent<VisionResponse>) => {
        const message = event.data;
        if (message.type === 'ready') { clearTimeout(timer); this.rejectInitialization = undefined; resolve(); return; }
        if (message.type === 'error') {
          if (message.id === undefined) { clearTimeout(timer); this.fail(new Error(message.message)); }
          else { const pending = this.pending.get(message.id); if (pending) { clearTimeout(pending.timer); pending.reject(new Error(message.message)); this.pending.delete(message.id); } }
          return;
        }
        const pending = this.pending.get(message.id);
        if (!pending) { message.image.close(); return; }
        clearTimeout(pending.timer); this.pending.delete(message.id);
        pending.resolve({ ...pending.frame, image: message.image, mask: message.mask,
          maskWidth: message.width, maskHeight: message.height, inferenceMs: message.inferenceMs });
      };
      this.worker.onerror = (event) => { clearTimeout(timer); event.preventDefault(); this.fail(new Error(event.message || 'The segmentation worker stopped. Retry person separation.')); };
      this.post({ type: 'initialize', baseUrl: new URL(import.meta.env.BASE_URL, location.href).href });
    });
    return this.initializePromise;
  }

  async segment(frame: FramePacket): Promise<FramePacket> {
    try { await this.initialize(); } catch (error) { frame.image.close(); throw error; }
    return new Promise((resolve, reject) => {
      const id = ++this.nextId;
      const { image, ...metadata } = frame;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('Person segmentation stopped responding. Retry person separation.')); this.fail(new Error('Segmentation timed out.')); }, 15_000);
      this.pending.set(id, { frame: metadata, resolve, reject, timer });
      try { this.post({ type: 'segment', id, image, timestamp: frame.timestamp }, [image]); }
      catch (error) { clearTimeout(timer); this.pending.delete(id); image.close(); reject(error); }
    });
  }

  private post(message: VisionRequest, transfer: Transferable[] = []) { this.worker!.postMessage(message, transfer); }
  private fail(error: Error) {
    clearTimeout(this.initializeTimer);
    this.rejectInitialization?.(error); this.rejectInitialization = undefined;
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
    this.pending.clear(); this.worker?.terminate(); this.worker = undefined; this.initializePromise = undefined;
  }
  dispose() { this.fail(new Error('Segmentation was stopped.')); }
}
