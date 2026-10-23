export interface FramePacket {
  image: ImageBitmap;
  timestamp: number;
  generation: number;
  mask?: Float32Array;
  maskWidth?: number;
  maskHeight?: number;
  inferenceMs?: number;
}

export interface FrameSource {
  readonly kind: 'demo' | 'camera' | 'file';
  readonly label: string;
  start(): Promise<void>;
  capture(timestamp: number, generation: number): Promise<FramePacket | null>;
  stop(): void;
}

export interface Segmenter {
  initialize(): Promise<void>;
  segment(frame: FramePacket): Promise<FramePacket>;
  dispose(): void;
}

export interface StudioStats {
  fps: number;
  inferenceMs: number;
  renderMs: number;
  dropped: number;
  logicalWidth: number;
  logicalHeight: number;
}
