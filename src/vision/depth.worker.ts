import { AutoModel, AutoImageProcessor, RawImage, Tensor, env } from '@huggingface/transformers';
import { normalizeDepth, type DepthRequest, type DepthResponse } from './depth-field';

// WASM works without WebGPU, cross-origin isolation, or competing with the WebGL renderer.
env.allowLocalModels = false;
env.backends.onnx.wasm!.numThreads = 1;
let model: Awaited<ReturnType<typeof AutoModel.from_pretrained>>;
let processor: Awaited<ReturnType<typeof AutoImageProcessor.from_pretrained>>;
const send = (message: DepthResponse, transfer: Transferable[] = []) => self.postMessage(message, { transfer });
self.onmessage = async (event: MessageEvent<DepthRequest>) => {
  const message = event.data;
  try {
    if (message.type === 'initialize') {
      const options = { revision: '4472b7362082ad9968fee890ca0f1e5aca36b93d' };
      processor = await AutoImageProcessor.from_pretrained('onnx-community/depth-anything-v2-small', options);
      // Multiples of 14, following the upstream video example's adjustable processor size.
      processor.size = { width: 280, height: 280 };
      model = await AutoModel.from_pretrained('onnx-community/depth-anything-v2-small', { ...options, device: 'wasm', dtype: 'q8' });
      send({ type: 'ready' });
      return;
    }
    const start = performance.now();
    const canvas = new OffscreenCanvas(message.image.width, message.image.height);
    const context = canvas.getContext('2d')!;
    context.drawImage(message.image, 0, 0); message.image.close();
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    const inputs = await processor(new RawImage(pixels.data, canvas.width, canvas.height, 4));
    const output = await model(inputs);
    const tensor = output.predicted_depth;
    const [height, width] = tensor.dims.slice(-2);
    const values = normalizeDepth(Float32Array.from(tensor.data as Float32Array));
    send({ type: 'result', id: message.id, values, width, height, inferenceMs: performance.now() - start }, values ? [values.buffer] : []);
    for (const value of Object.values(inputs)) if (value instanceof Tensor) value.dispose();
    for (const value of Object.values(output)) if (value instanceof Tensor) value.dispose();
  } catch (error) {
    if (message.type === 'estimate') message.image.close();
    send({ type: 'error', message: error instanceof Error ? error.message : 'Depth estimation failed.' });
  }
};
