/// <reference lib="webworker" />
import { FilesetResolver, ImageSegmenter } from '@mediapipe/tasks-vision';
import type { VisionRequest, VisionResponse } from './protocol';

const scope = self as unknown as DedicatedWorkerGlobalScope;
let segmenter: ImageSegmenter | undefined;
function reply(message: VisionResponse, transfer: Transferable[] = []) { scope.postMessage(message, transfer); }

scope.onmessage = async (event: MessageEvent<VisionRequest>) => {
  const message = event.data;
  try {
    if (message.type === 'initialize') {
      // ESM loader explicitly installs ModuleFactory in module workers.
      const runtime = await FilesetResolver.forVisionTasks(`${message.baseUrl}vision/wasm`, true);
      const response = await fetch(`${message.baseUrl}vision/selfie_segmenter_landscape.tflite`);
      if (!response.ok || !response.headers.get('content-type')?.includes('octet-stream') && response.headers.get('content-type')?.includes('text/html')) {
        throw new Error('Person model is not installed. Run pnpm models:setup, then retry.');
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length < 100_000 || new TextDecoder().decode(bytes.slice(4, 8)) !== 'TFL3') throw new Error('Person model is missing or invalid. Run pnpm models:setup, then retry.');
      segmenter?.close();
      segmenter = await ImageSegmenter.createFromOptions(runtime, {
        baseOptions: { modelAssetBuffer: bytes, delegate: 'CPU' },
        runningMode: 'VIDEO', outputCategoryMask: false, outputConfidenceMasks: true,
      });
      reply({ type: 'ready' });
      return;
    }
    if (!segmenter) throw new Error('The segmenter has not been initialized.');
    const start = performance.now();
    // Copy inside the callback: MediaPipe releases callback-owned masks afterward.
    segmenter.segmentForVideo(message.image, message.timestamp, result => {
      const masks = result.confidenceMasks;
      if (!masks?.length) throw new Error('The segmentation model returned no mask.');
      // Landscape selfie model contains background at 0 and person at 1.
      const person = masks[1] ?? masks[0];
      const mask = new Float32Array(person.getAsFloat32Array());
      reply({ type: 'result', id: message.id, image: message.image, mask,
        width: person.width, height: person.height, inferenceMs: performance.now() - start },
      [message.image, mask.buffer]);
    });
  } catch (error) {
    if (message.type === 'segment') message.image.close();
    reply({ type: 'error', id: message.type === 'segment' ? message.id : undefined,
      message: error instanceof Error ? error.message : 'Person segmentation could not start.' });
  }
};
