import { DemoSource, FileSource, ImageSource, explainCaptureError } from '../capture/sources';
import { PixelRenderer } from '../render/renderer';
import { PersonSegmenter } from '../vision/segmenter';
import type { Preset } from './presets';
import type { FramePacket, FrameSource, StudioStats } from './types';
import { sceneDifference } from './scene';
import { SceneDepthEstimator } from '../vision/depth';
import type { DepthStatus } from './types';
import type { FaceStatus } from './types';
import { FaceTracker } from '../vision/face';
import { faceGeometry } from '../vision/face-geometry';
import { processingPolicy, settleFrame } from './file-processing';

export interface StudioCallbacks {
  onStats(stats: StudioStats): void;
  onError(message: string): void;
  onVision(status: 'off' | 'loading' | 'ready' | 'demo' | 'error'): void;
  onSource(source: FrameSource): void;
  onEnded(): void;
  onDepth?(status: DepthStatus, message?: string): void;
  onFace?(status: FaceStatus, message?: string): void;
}

export class Studio {
  private renderer: PixelRenderer;
  private segmenter = new PersonSegmenter();
  private source?: FrameSource;
  private frame?: FramePacket;
  private preset: Preset;
  private generation = 0;
  private busy = false;
  private disposed = false;
  private raf = 0;
  private lastCapture = 0;
  private lastStats = performance.now();
  private frames = 0;
  private dropped = 0;
  private stats: StudioStats = { fps: 0, inferenceMs: 0, renderMs: 0, dropped: 0, logicalWidth: 320, logicalHeight: 180 };
  private visionFailed = false;
  private splitLastFrame = false;
  private lastSourceTime = 0;
  private contextLost = false;
  private dirty = false;
  private sceneCanvas = document.createElement('canvas');
  private sceneContext: CanvasRenderingContext2D;
  private previousScene?: Uint8ClampedArray;
  private sourceEnded = false;
  private depth: SceneDepthEstimator;
  private face: FaceTracker;
  private faceOverlay?: HTMLCanvasElement;
  private work = new AbortController();
  paused = false;
  fpsLimit = 30;

  constructor(private canvas: HTMLCanvasElement, private original: HTMLCanvasElement, preset: Preset, private callbacks: StudioCallbacks) {
    this.preset = preset;
    this.depth = new SceneDepthEstimator((status, message) => this.callbacks.onDepth?.(status, message), () => { this.dirty = true; });
    this.face = new FaceTracker((status,message)=>this.callbacks.onFace?.(status,message),()=>{this.dirty=true;});
    this.sceneCanvas.width = 16; this.sceneCanvas.height = 9;
    this.sceneContext = this.sceneCanvas.getContext('2d', { willReadFrequently: true })!;
    this.renderer = new PixelRenderer(canvas);
    canvas.addEventListener('webglcontextlost', this.onContextLost);
    canvas.addEventListener('webglcontextrestored', this.onContextRestored);
    this.raf = requestAnimationFrame(this.tick);
  }
  private onContextLost = (event: Event) => {
    event.preventDefault(); this.contextLost = true;
    this.callbacks.onError('The graphics device was reset. VXL will recover when it becomes available.');
  };
  private onContextRestored = () => {
    try { this.renderer.dispose(); this.renderer = new PixelRenderer(this.canvas); this.contextLost = false; this.dirty = true; }
    catch (error) { this.callbacks.onError(explainCaptureError(error)); }
  };

  async setSource(source: FrameSource) {
    this.cancelWork();
    const generation = ++this.generation;
    this.segmenter.dispose(); this.segmenter = new PersonSegmenter();
    this.depth.dispose();
    this.face.dispose();
    this.source?.stop(); this.source = undefined;
    this.frame?.image.close(); this.frame = undefined;
    this.renderer.resetHistory(); this.splitLastFrame = false; this.lastSourceTime = 0; this.previousScene = undefined; this.sourceEnded = false;
    this.stats.mediaTime = this.stats.mediaDuration = this.stats.processingMs = undefined;
    this.stats.processingWaitExpired = false;
    try {
      if (source instanceof FileSource) source.configureProcessing(this.preset.fileProcessing > 0);
      await source.start();
      if (this.disposed || generation !== this.generation) { source.stop(); return; }
      this.source = source; this.paused = false; this.visionFailed = false;
      if ('tracks' in source) {
        for (const track of (source as { tracks: MediaStreamTrack[] }).tracks) track.addEventListener('ended', () => {
          if (this.source !== source || this.disposed) return;
          this.paused = true; this.callbacks.onEnded();
          this.callbacks.onError('The camera disconnected. Choose another camera or return to the studio scene.');
        }, { once: true });
      }
      if (source instanceof FileSource) {
        source.video.addEventListener('seeking', () => {
          if (this.source !== source || source.stepping) return;
          this.cancelWork(); ++this.generation; this.renderer.resetHistory(); this.depth.reset(); this.face.reset();
        });
        source.video.addEventListener('ended', () => {
          if (this.source !== source || this.disposed || source.stepping) return;
          this.sourceEnded = true;
          // A short clip can end before its first queued bitmap has been painted.
          if (this.frame) { this.paused = true; this.callbacks.onEnded(); }
        });
      }
      this.callbacks.onSource(source);
      this.updateVisionStatus();
    } catch (error) { source.stop(); if (!this.disposed && generation === this.generation) this.callbacks.onError(explainCaptureError(error)); throw error; }
  }

  setPreset(preset: Preset) {
    if (this.disposed) return;
    this.cancelWork();
    const processingChanged = this.preset.fileProcessing !== preset.fileProcessing;
    const faceOnly=JSON.stringify({...this.preset,face:undefined})===JSON.stringify({...preset,face:undefined});
    if (this.preset.segmentation !== preset.segmentation) { ++this.generation; this.visionFailed = false; }
    this.preset = preset;
    if (processingChanged && this.source instanceof FileSource) {
      ++this.generation; this.depth.reset(); this.face.reset(); this.previousScene = undefined;
      this.source.configureProcessing(preset.fileProcessing > 0, this.paused);
    }
    if(!faceOnly){this.renderer.resetHistory();this.updateVisionStatus();}
    this.dirty = true;
    if (!preset.depth.enabled) this.depth.dispose();
    if (!preset.face.enabled || preset.face.strength===0) this.face.dispose();
  }
  private updateVisionStatus() {
    if (!this.preset.segmentation) this.callbacks.onVision('off');
    else if (this.source?.kind === 'demo') this.callbacks.onVision('demo');
    else if (this.visionFailed) this.callbacks.onVision('error');
    else this.callbacks.onVision('loading');
  }
  retryVision() { this.segmenter.dispose(); this.segmenter = new PersonSegmenter(); this.visionFailed = false; this.dirty = true; this.updateVisionStatus(); }
  retryDepth() { this.depth.dispose(); this.dirty = true; }
  retryFace() {this.face.dispose();this.dirty=true;}
  setFaceOverlay(canvas?:HTMLCanvasElement) {this.faceOverlay=canvas;this.dirty=true;}
  refreshColorReference() { this.renderer.refreshColorReference(); this.dirty = true; }
  private cancelWork() { this.work.abort(); this.work = new AbortController(); }
  setPaused(paused: boolean) {
    if (this.source?.kind === 'image') return;
    this.cancelWork();
    this.paused = paused;
    if (this.source instanceof FileSource) {
      if (paused) this.source.video.pause();
      else {
        if (this.sourceEnded || this.source.video.ended || this.source.finished) { this.source.restart(); this.sourceEnded = false; this.renderer.resetHistory(); this.depth.reset(); this.face.reset(); }
        if (!this.source.stepping) void this.source.video.play().catch(error => this.callbacks.onError(explainCaptureError(error)));
      }
    }
    if (!paused) this.renderer.resetHistory();
  }
  get currentSource() { return this.source; }
  get hasFrame() { return Boolean(this.frame); }

  private tick = (now: number) => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.tick);
    if (now - this.lastStats >= 1000) {
      this.stats.fps = this.frames * 1000 / (now - this.lastStats);
      this.stats.dropped = this.dropped; this.frames = 0; this.lastStats = now;
      this.callbacks.onStats({ ...this.stats });
    }
    if (this.contextLost) return;
    if (this.paused) {
      if ((this.dirty || (this.preset.depth.enabled && this.depth.needsRepaint) || (this.preset.face.enabled && this.face.needsRepaint)) && this.frame && !this.busy) {
        if (this.preset.segmentation && !this.frame.mask && this.source?.kind !== 'demo' && !this.visionFailed) {
          this.busy = true; void this.segmentFrozenFrame().finally(() => { this.busy = false; });
        } else this.paint(this.frame);
      }
      return;
    }
    if (!this.source || now - this.lastCapture < 1000 / this.fpsLimit - 1) return;
    if (this.busy) { if (!(this.source instanceof FileSource && this.source.stepping)) this.dropped++; return; }
    this.lastCapture = now;
    this.busy = true;
    void this.process(now).finally(() => { this.busy = false; });
  };

  private async segmentFrozenFrame() {
    const generation = this.generation;
    try {
      const frame = this.frame!;
      const output = await this.segmenter.segment({ ...frame, image: await createImageBitmap(frame.image), generation });
      if (this.disposed || generation !== this.generation) { output.image.close(); return; }
      this.frame?.image.close(); this.frame = output;
      this.callbacks.onVision('ready'); this.paint(output);
    } catch (error) {
      if (this.disposed || generation !== this.generation) return;
      this.visionFailed = true; this.callbacks.onVision('error');
      this.callbacks.onError(`${explainCaptureError(error)} Whole-frame styling is still available.`);
      if (this.frame) this.paint(this.frame);
    }
  }

  private async process(now: number) {
    const source = this.source!, generation = this.generation;
    const signal = this.work.signal, started = performance.now();
    let packet: FramePacket | null = null;
    try {
      packet = await source.capture(now, generation);
      if (!packet) { if ((this.dirty || (this.preset.depth.enabled && this.depth.needsRepaint) || (this.preset.face.enabled && this.face.needsRepaint)) && this.frame) this.paint(this.frame); return; }
      if (this.disposed || generation !== this.generation || signal.aborted) { packet.image.close(); packet = null; return; }
      // Drop a queued frame when paused during capture; preserve the frozen frame.
      if (this.paused) { packet.image.close(); return; }
      if (source instanceof FileSource) {
        if (source.video.currentTime < this.lastSourceTime || source.video.currentTime - this.lastSourceTime > 0.75) { this.renderer.resetHistory(); this.depth.reset(); this.face.reset(); }
        this.lastSourceTime = source.video.currentTime;
      }
      if (this.preset.segmentation && source.kind !== 'demo' && !this.visionFailed) {
        const transferred = packet; packet = null;
        try {
          packet = await this.segmenter.segment(transferred);
          if (generation === this.generation && !this.disposed) this.callbacks.onVision('ready');
        } catch (error) {
          if (generation === this.generation && !this.disposed) {
            this.visionFailed = true; this.callbacks.onVision('error');
            this.callbacks.onError(`${explainCaptureError(error)} Whole-frame styling is still available.`);
            if (source instanceof ImageSource) source.retryCapture();
          }
          return;
        }
      }
      if (this.disposed || generation !== this.generation || this.paused || signal.aborted) { packet.image.close(); packet = null; return; }
      const effort = source.kind === 'file' || source.kind === 'image' ? processingPolicy(this.preset.fileProcessing) : processingPolicy(0);
      this.stats.processingWaitExpired = false;
      if (effort.passes > 0) {
        const held = packet, thumbnail = this.sceneThumbnail(held);
        const result = await settleFrame(() => {
          this.updateEstimates(held, thumbnail, true);
          return (!this.preset.depth.enabled || this.depth.hasCompleted(held)) &&
            (!this.preset.face.enabled || this.preset.face.strength === 0 || this.face.hasCompleted(held));
        }, effort.waitMs, signal);
        if (result.cancelled || this.disposed || generation !== this.generation) { packet.image.close(); packet = null; return; }
        this.stats.processingWaitExpired = result.expired;
      }
      this.frame?.image.close(); this.frame = packet; packet = null;
      this.paint(this.frame); this.frames++;
      this.stats.processingMs = performance.now() - started;
      if (source instanceof FileSource) {
        this.stats.mediaTime = source.stepping ? source.sampleTime : source.video.currentTime; this.stats.mediaDuration = source.duration;
        if (source.stepping) { source.commitFrame(this.fpsLimit); if (source.finished) this.sourceEnded = true; }
      }
      if (this.sourceEnded || source.kind === 'image') { this.paused = true; this.callbacks.onEnded(); }
    } catch (error) {
      packet?.image.close();
      if (!this.disposed && generation === this.generation && !signal.aborted) { this.paused = true; this.callbacks.onEnded(); this.callbacks.onError(explainCaptureError(error)); }
    } finally {
      if (signal.aborted && source instanceof ImageSource && source === this.source && !this.frame) source.retryCapture();
    }
  }
  private sceneThumbnail(frame: FramePacket) {
    this.sceneContext.drawImage(frame.image, 0, 0, 16, 9);
    const thumbnail = this.sceneContext.getImageData(0, 0, 16, 9).data;
    if (this.previousScene && sceneDifference(this.previousScene, thumbnail) > 0.22) { this.renderer.refreshColorReference(); this.depth.reset(); this.face.reset(); }
    this.previousScene = thumbnail;
    return thumbnail;
  }
  private updateEstimates(frame: FramePacket, thumbnail: Uint8ClampedArray, exact: boolean) {
    let renderFrame = frame;
    if (this.preset.depth.enabled) {
      if (this.source?.kind === 'demo') this.callbacks.onDepth?.('demo');
      else renderFrame = { ...renderFrame, depth: this.depth.update(frame, thumbnail, exact) };
    }
    if(this.preset.face.enabled&&this.preset.face.strength>0) {
      if(this.source?.kind==='demo')this.callbacks.onFace?.('demo');
      else {
        const field = this.face.update(frame, this.paused || exact);
        renderFrame = { ...renderFrame, face: exact && field?.observation.timestamp !== frame.timestamp ? undefined : field };
      }
      const field=renderFrame.face;
      if(field&&this.source?.kind!=='demo') {
        const ratio=Math.min(1,this.preset.resolution/Math.max(frame.image.width,frame.image.height));
        const geometry=faceGeometry(field.observation.landmarks,frame.image.width*ratio,frame.image.height*ratio);
        if(geometry&&field.allowWarp)this.callbacks.onFace?.(geometry.width<12?'small':'tracking');
      }
    } else renderFrame={...renderFrame,face:undefined};
    return renderFrame;
  }
  private paint(frame: FramePacket) {
    const start = performance.now();
    const uploaded = this.source?.kind === 'image' || this.source?.kind === 'file';
    const effort = processingPolicy(uploaded ? this.preset.fileProcessing : 0);
    const renderFrame = { ...this.updateEstimates(frame, this.sceneThumbnail(frame), uploaded && (effort.passes > 0 || this.source?.kind === 'image')), refinementPasses: effort.passes };
    const split = Boolean(this.preset.segmentation && frame.mask);
    if (split !== this.splitLastFrame) this.renderer.resetHistory();
    this.splitLastFrame = split;
    const size = this.renderer.render(renderFrame, this.preset);
    if(this.faceOverlay)this.renderer.drawFaceOverlay(this.faceOverlay);
    this.stats.renderMs = performance.now() - start; this.stats.inferenceMs = frame.inferenceMs ?? 0;
    this.stats.faceInferenceMs=this.face.inferenceMs;
    this.stats.logicalWidth = size.width; this.stats.logicalHeight = size.height;
    if (this.original.width !== this.canvas.width || this.original.height !== this.canvas.height) { this.original.width = this.canvas.width; this.original.height = this.canvas.height; }
    this.original.getContext('2d')!.drawImage(frame.image, 0, 0, this.original.width, this.original.height);
    this.dirty = false;
  }
  dispose() {
    this.cancelWork();
    this.disposed = true; ++this.generation; cancelAnimationFrame(this.raf);
    this.source?.stop(); this.segmenter.dispose(); this.frame?.image.close(); this.frame = undefined;
    this.depth.dispose();
    this.face.dispose();
    this.renderer.dispose();
    this.canvas.removeEventListener('webglcontextlost', this.onContextLost);
    this.canvas.removeEventListener('webglcontextrestored', this.onContextRestored);
  }
}
