export type VisionRequest =
  | { type: 'initialize'; baseUrl: string }
  | { type: 'segment'; id: number; image: ImageBitmap; timestamp: number };

export type VisionResponse =
  | { type: 'ready' }
  | { type: 'result'; id: number; image: ImageBitmap; mask: Float32Array; width: number; height: number; inferenceMs: number }
  | { type: 'error'; id?: number; message: string };
