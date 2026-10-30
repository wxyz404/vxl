/** Relative distance, 0 = near and 1 = far; never meters. Top-left origin. */
export interface DepthField {
  values: Float32Array;
  width: number;
  height: number;
  timestamp: number;
  generation: number;
  /** Bounded reuse budget for asynchronous live estimates. Raw/authored fields default to 1 s. */
  maxAgeMs?: number;
  /** Presentation strength, allowing continuous fade-in/out without changing depth measurements. */
  strength?: number;
}
export type DepthStatus = 'off' | 'loading' | 'estimating' | 'ready' | 'holding' | 'demo' | 'stale' | 'error';

/** Source-normalized, top-left coordinates. Geometry, never an identity descriptor. */
export interface FaceObservation {
  landmarks: Float32Array;
  timestamp: number;
  generation: number;
  inferenceMs: number;
  /** Changes when spatial continuity is lost; unrelated to personal identity. */
  continuity?: number;
}
export interface FaceField {
  observation: FaceObservation;
  strength: number;
  allowWarp: boolean;
}
export type FaceStatus = 'off' | 'loading' | 'estimating' | 'tracking' | 'no-face' | 'small' | 'stale' | 'demo' | 'error';

export interface FramePacket {
  image: ImageBitmap;
  timestamp: number;
  generation: number;
  mask?: Float32Array;
  maskWidth?: number;
  maskHeight?: number;
  inferenceMs?: number;
  depth?: DepthField;
  face?: FaceField;
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
  faceInferenceMs?: number;
  renderMs: number;
  dropped: number;
  logicalWidth: number;
  logicalHeight: number;
}
