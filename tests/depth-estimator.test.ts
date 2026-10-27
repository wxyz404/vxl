import { afterEach, describe, expect, it, vi } from 'vitest';
import { SceneDepthEstimator } from '../src/vision/depth';
import type { FramePacket } from '../src/core/types';
import type { DepthRequest, DepthResponse } from '../src/vision/depth-field';

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage?: (event: { data: DepthResponse }) => void;
  onerror?: (event: Event) => void;
  sent: DepthRequest[] = [];
  terminate = vi.fn();
  constructor() { FakeWorker.instances.push(this); }
  postMessage(message: DepthRequest) { this.sent.push(message); }
  reply(data: DepthResponse) { this.onmessage?.({ data }); }
}
afterEach(() => { vi.unstubAllGlobals(); FakeWorker.instances = []; });
describe('nonblocking depth lifecycle', () => {
  it('keeps slow live estimates through movement and a bad prediction without toggling to fallback', async () => {
    let now = 0;
    vi.stubGlobal('performance', { now: () => now });
    const image = { width: 640, height: 360, close: vi.fn() } as unknown as ImageBitmap;
    vi.stubGlobal('Worker', FakeWorker); vi.stubGlobal('createImageBitmap', vi.fn(async () => image));
    const notify = vi.fn(), estimator = new SceneDepthEstimator(notify, vi.fn());
    const frame: FramePacket = { image, timestamp: 100, generation: 1 }, scene = new Uint8ClampedArray(16 * 9 * 4);
    try {
      estimator.update(frame, scene); const worker = FakeWorker.instances[0]; worker.reply({ type: 'ready' });
      estimator.update(frame, scene); await Promise.resolve();
      now = 1600;
      worker.reply({ type: 'result', id: 1, values: new Float32Array([0, 0.3, 0.6, 1]), width: 2, height: 2, inferenceMs: 1600 });
      expect(estimator.update({ ...frame, timestamp: 1700 }, scene.slice().fill(36))).toBeDefined();
      await Promise.resolve(); now = 1900;
      expect(estimator.update({ ...frame, timestamp: 2000 }, scene)?.strength).toBe(1);
      now = 3200;
      worker.reply({ type: 'result', id: 2, width: 2, height: 2, inferenceMs: 1600 });
      expect(estimator.update({ ...frame, timestamp: 3300 }, scene.slice().fill(36))?.strength).toBe(1);
      expect(notify.mock.calls.some(([status]) => status === 'stale')).toBe(false);
      expect(FakeWorker.instances).toHaveLength(1);
      // An actual cut still drops the field immediately.
      expect(estimator.update({ ...frame, timestamp: 3400 }, scene.slice().fill(255))).toBeUndefined();
    } finally { estimator.dispose(); await Promise.resolve(); }
  });
  it('queues no frames during download, limits inference to one snapshot, and rejects results after a cut', async () => {
    const image = { width: 640, height: 360, close: vi.fn() } as unknown as ImageBitmap;
    vi.stubGlobal('Worker', FakeWorker); vi.stubGlobal('createImageBitmap', vi.fn(async () => image));
    const estimator = new SceneDepthEstimator(vi.fn(), vi.fn());
    const frame: FramePacket = { image, timestamp: 100, generation: 1 }, scene = new Uint8ClampedArray(16 * 9 * 4);
    try {
      expect(estimator.update(frame, scene)).toBeUndefined();
      const worker = FakeWorker.instances[0];
      estimator.update(frame, scene); expect(worker.sent).toEqual([{ type: 'initialize' }]);
      worker.reply({ type: 'ready' }); estimator.update(frame, scene); await Promise.resolve();
      const request = worker.sent[1]; expect(request.type).toBe('estimate');
      estimator.update({ ...frame, timestamp: 200 }, scene); expect(worker.sent).toHaveLength(2);
      estimator.reset();
      worker.reply({ type: 'result', id: (request as { id: number }).id, values: new Float32Array([0, 0.3, 0.6, 1]), width: 2, height: 2, inferenceMs: 30 });
      expect(estimator.update({ ...frame, timestamp: 300 }, scene)).toBeUndefined();
      await Promise.resolve();
      const next = worker.sent[2] as { id: number };
      worker.reply({ type: 'result', id: next.id, values: new Float32Array([0, 0.3, 0.6, 1]), width: 2, height: 2, inferenceMs: 30 });
      expect(estimator.update({ ...frame, timestamp: 300 }, scene)?.values).toHaveLength(4);
      expect(estimator.update({ ...frame, timestamp: 300 }, new Uint8ClampedArray(scene.length).fill(255))).toBeUndefined();
    } finally { estimator.dispose(); }
    expect(FakeWorker.instances[0].terminate).toHaveBeenCalledOnce();
  });
  it('recovers from a model error after disposal and closes a copied bitmap if disabled before transfer', async () => {
    const copy = { close: vi.fn() } as unknown as ImageBitmap;
    const image = { width: 640, height: 360 } as ImageBitmap;
    let finishCopy!: (image: ImageBitmap) => void;
    vi.stubGlobal('Worker', FakeWorker);
    vi.stubGlobal('createImageBitmap', vi.fn(() => new Promise<ImageBitmap>(resolve => { finishCopy = resolve; })));
    const notify = vi.fn(), estimator = new SceneDepthEstimator(notify, vi.fn());
    const frame = { image, timestamp: 100, generation: 1 }, scene = new Uint8ClampedArray(16 * 9 * 4);
    try {
      estimator.update(frame, scene); FakeWorker.instances[0].reply({ type: 'error', message: 'offline' });
      expect(notify).toHaveBeenCalledWith('error', 'offline');
      estimator.update(frame, scene); expect(FakeWorker.instances).toHaveLength(1);
      estimator.dispose(); estimator.update(frame, scene);
      FakeWorker.instances[0].reply({ type: 'error', message: 'obsolete worker' });
      expect(notify).not.toHaveBeenCalledWith('error', 'obsolete worker');
      FakeWorker.instances[1].reply({ type: 'ready' }); estimator.update(frame, scene);
      estimator.dispose(); finishCopy(copy); await Promise.resolve();
      expect(copy.close).toHaveBeenCalledOnce();
      expect(FakeWorker.instances[1].sent).toHaveLength(1);
    } finally { estimator.dispose(); }
  });
});
