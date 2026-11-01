import type { FramePacket, FrameSource } from '../core/types';
import { authoredFace } from '../vision/face-geometry';

/** Pin a decoded frame synchronously before handing it to async image/vision work. */
class VideoFrameCapture {
  private canvas = new OffscreenCanvas(1,1);
  private context = this.canvas.getContext('2d',{alpha:false})!;
  private lastTime = -1;
  async capture(video: HTMLVideoElement,timestamp: number,generation: number,force=false):Promise<FramePacket|null> {
    if(video.readyState<2||!video.videoWidth||!video.videoHeight||(!force&&video.currentTime===this.lastTime)) return null;
    const time=video.currentTime;
    if(this.canvas.width!==video.videoWidth||this.canvas.height!==video.videoHeight) {
      this.canvas.width=video.videoWidth;this.canvas.height=video.videoHeight;
    }
    // createImageBitmap(video) can race decoder buffer release at the end of a clip.
    this.context.drawImage(video,0,0,this.canvas.width,this.canvas.height);
    const image=await createImageBitmap(this.canvas);
    this.lastTime=time;
    return {image,timestamp,generation};
  }
}

export class CameraSource implements FrameSource {
  readonly kind = 'camera' as const;
  readonly label: string;
  private stream?: MediaStream;
  private video = document.createElement('video');
  private frames = new VideoFrameCapture();
  constructor(private deviceId?: string, label?: string) { this.label = label || 'Webcam'; }
  async start() {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera access needs localhost or HTTPS. Open VXL on this computer using localhost.');
    this.stream = await navigator.mediaDevices.getUserMedia({ video: { ...(this.deviceId ? { deviceId: { exact: this.deviceId } } : {}), width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } }, audio: false });
    this.video.muted = true;
    this.video.playsInline = true;
    this.video.srcObject = this.stream;
    await this.video.play();
  }
  async capture(timestamp: number, generation: number) {
    return this.frames.capture(this.video,timestamp,generation);
  }
  stop() { this.video.pause(); this.stream?.getTracks().forEach(track => track.stop()); this.video.srcObject = null; }
  get tracks() { return this.stream?.getVideoTracks() ?? []; }
}

export class FileSource implements FrameSource {
  readonly kind = 'file' as const;
  readonly label: string;
  readonly video = document.createElement('video');
  private url: string;
  private frames = new VideoFrameCapture();
  private controller = new AbortController();
  private started = false;
  private nextSample = 0;
  private timelineOrigin = 0;
  private playbackError?: unknown;
  stepping = false;
  sampleTime = 0;
  get duration() { return this.video.duration; }
  get finished() { return this.stepping && this.nextSample >= this.duration - 0.0000001; }
  constructor(file: File) { this.label = file.name; this.url = URL.createObjectURL(file); }
  async start() {
    this.video.muted = true;
    this.video.loop = false;
    this.video.playsInline = true;
    await this.waitFor('loadeddata', () => { this.video.src = this.url; this.video.load(); });
    this.started = true;
    if (!this.stepping) await this.video.play();
  }
  async capture(timestamp: number, generation: number) {
    if (this.playbackError) throw this.playbackError;
    if (!this.stepping) return this.frames.capture(this.video,timestamp,generation);
    // Some browser-recorded WebM files reveal their duration only after a seek.
    if (!Number.isFinite(this.duration)) {
      await this.waitFor('seeked', () => { this.video.currentTime = 1e10; });
      if (!Number.isFinite(this.duration)) throw new Error('This clip has no finite duration. Try an MP4 or another video export.');
    }
    if (this.finished) return null;
    const time = this.nextSample;
    if (Math.abs(this.video.currentTime - time) > 0.00001 || this.video.readyState < 2) {
      await this.waitFor('seeked', () => { this.video.currentTime = time; });
    }
    this.sampleTime = time;
    // Media time preserves motion history even when processing takes several seconds.
    return this.frames.capture(this.video, this.timelineOrigin + time * 1000, generation, true);
  }
  configureProcessing(enabled: boolean, paused = false) {
    if (this.stepping === enabled) return;
    this.controller.abort(); this.controller = new AbortController();
    this.stepping = enabled; this.nextSample = this.video.currentTime;
    this.timelineOrigin = performance.now() - this.nextSample * 1000;
    this.playbackError = undefined;
    if (enabled || paused) this.video.pause();
    else if (this.started) void this.video.play().catch(error => { if (error?.name !== 'AbortError') this.playbackError = error; });
  }
  commitFrame(fps: number) { this.nextSample = this.sampleTime + 1 / fps; }
  restart() {
    this.nextSample = 0; this.timelineOrigin = performance.now();
    if (!this.stepping) this.video.currentTime = 0;
  }
  private waitFor(event: 'loadeddata' | 'seeked', action: () => void): Promise<void> {
    const signal = this.controller.signal;
    return new Promise((resolve, reject) => {
      const cleanup = () => { clearTimeout(timer); this.video.removeEventListener(event, done); this.video.removeEventListener('error', error); signal.removeEventListener('abort', abort); };
      const done = () => { cleanup(); resolve(); };
      const error = () => { cleanup(); reject(new Error(`The video could not be decoded. Try a supported MP4 or WebM file.${this.video.error?.message ? ` (${this.video.error.message})` : ''}`)); };
      const abort = () => { cleanup(); reject(new DOMException('Source changed', 'AbortError')); };
      const timer = setTimeout(error, 15_000);
      this.video.addEventListener(event, done, { once: true }); this.video.addEventListener('error', error, { once: true });
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) { abort(); return; }
      try { action(); } catch (reason) { cleanup(); reject(reason); }
    });
  }
  stop() { this.controller.abort(); this.started = false; this.video.pause(); this.video.removeAttribute('src'); this.video.load(); URL.revokeObjectURL(this.url); }
}

/** A still source yields one owned snapshot; edits reuse the held studio frame. */
export class ImageSource implements FrameSource {
  readonly kind = 'image' as const;
  readonly label: string;
  private bitmap?: ImageBitmap;
  private delivered = false;
  private stopped = false;
  constructor(private file: File) { this.label = file.name; }
  async start() {
    if (!/\.(png|jpe?g)$/i.test(this.file.name) && !['image/png', 'image/jpeg'].includes(this.file.type)) throw new Error('Choose a PNG or JPG image.');
    if (this.file.size > 32 * 1024 * 1024) throw new Error('Choose an image smaller than 32 MB.');
    let image: ImageBitmap;
    try { image = await createImageBitmap(this.file, { imageOrientation: 'from-image' }); }
    catch { throw new Error('This image could not be decoded. Choose a valid PNG or JPG file.'); }
    if (this.stopped) { image.close(); return; }
    if (image.width * image.height > 16_777_216) { image.close(); throw new Error('Choose an image with at most 16 million pixels.'); }
    // Composite transparent PNGs onto a predictable neutral background before styling.
    const canvas = new OffscreenCanvas(image.width, image.height), context = canvas.getContext('2d')!;
    context.fillStyle = '#202421'; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(image, 0, 0); image.close();
    const bitmap = await createImageBitmap(canvas);
    if (this.stopped) bitmap.close(); else this.bitmap = bitmap;
  }
  async capture(timestamp: number, generation: number): Promise<FramePacket | null> {
    if (this.delivered || !this.bitmap) return null;
    this.delivered = true;
    const image = await createImageBitmap(this.bitmap);
    return { image, timestamp, generation };
  }
  retryCapture() { this.delivered = false; }
  stop() { this.stopped = true; this.bitmap?.close(); this.bitmap = undefined; }
}

/** A generated test scene, not a demonstration of neural recognition. */
export class DemoSource implements FrameSource {
  readonly kind = 'demo' as const;
  readonly label = 'Studio scene';
  private canvas = document.createElement('canvas');
  private context: CanvasRenderingContext2D;
  private time = 0;
  motion = true;
  constructor() {
    this.canvas.width = 960; this.canvas.height = 540;
    this.context = this.canvas.getContext('2d')!;
  }
  async start() {}
  async capture(timestamp: number, generation: number): Promise<FramePacket> {
    if (this.motion) this.time += 1 / 30;
    const c = this.context, t = this.time, sway = Math.sin(t * 0.7) * 8;
    const wall = c.createLinearGradient(0, 0, 960, 540); wall.addColorStop(0, '#c4b39a'); wall.addColorStop(1, '#847b65');
    c.fillStyle = wall; c.fillRect(0, 0, 960, 540);
    c.fillStyle = '#9c8d76'; c.fillRect(0, 376, 960, 164);
    c.fillStyle = '#6e6654'; c.fillRect(0, 374, 960, 4);
    // Window, daylight, and a distant landscape.
    c.fillStyle = '#504f44'; c.fillRect(64, 42, 286, 282);
    const sky = c.createLinearGradient(0, 48, 0, 310); sky.addColorStop(0, '#9fc3c1'); sky.addColorStop(1, '#e9dbac');
    c.fillStyle = sky; c.fillRect(74, 52, 266, 262);
    c.fillStyle = '#7f9c80'; c.beginPath(); c.moveTo(74, 238); c.lineTo(145, 180); c.lineTo(218, 226); c.lineTo(287, 166); c.lineTo(340, 230); c.lineTo(340, 314); c.lineTo(74, 314); c.fill();
    c.fillStyle = '#526f61'; c.beginPath(); c.moveTo(74, 278); c.lineTo(187, 232); c.lineTo(263, 268); c.lineTo(340, 226); c.lineTo(340, 314); c.lineTo(74, 314); c.fill();
    c.fillStyle = '#504f44'; c.fillRect(201, 49, 8, 269); c.fillRect(70, 179, 275, 8);
    c.fillStyle = '#e9d8b6'; c.fillRect(56, 315, 302, 12);
    // Framed art.
    c.fillStyle = '#524b40'; c.fillRect(690, 56, 146, 167); c.fillStyle = '#ddc9a6'; c.fillRect(699, 65, 128, 149);
    c.fillStyle = '#bd795d'; c.beginPath(); c.arc(763, 117, 29, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#67836a'; c.beginPath(); c.moveTo(706, 204); c.lineTo(750, 146); c.lineTo(788, 204); c.fill();
    c.fillStyle = '#374f49'; c.beginPath(); c.moveTo(742, 204); c.lineTo(789, 144); c.lineTo(819, 204); c.fill();
    // Desk, lamp, books, and plant.
    c.fillStyle = '#5b493a'; c.fillRect(62, 415, 824, 19); c.fillRect(82, 434, 16, 106); c.fillRect(850, 434, 16, 106);
    c.fillStyle = '#ad7953'; c.fillRect(58, 405, 832, 13);
    c.strokeStyle = '#3c443c'; c.lineWidth = 8; c.beginPath(); c.moveTo(166, 401); c.lineTo(166, 332); c.lineTo(206, 294); c.stroke();
    c.fillStyle = '#d5b77e'; c.beginPath(); c.moveTo(180, 290); c.lineTo(232, 290); c.lineTo(253, 327); c.lineTo(164, 327); c.fill();
    c.fillStyle = '#414c44'; c.fillRect(139, 395, 58, 10);
    ['#8a5c4c','#b09d74','#5a7465'].forEach((color, i) => { c.fillStyle = color; c.fillRect(254 + i * 3, 391 - i * 17, 113 - i * 9, 15); });
    c.fillStyle = '#bd815d'; c.beginPath(); c.moveTo(746, 356); c.lineTo(811, 356); c.lineTo(799, 405); c.lineTo(758, 405); c.fill();
    c.strokeStyle = '#435f47'; c.lineWidth = 5;
    for (let i = 0; i < 7; i++) {
      const x = 778 + Math.sin(i * 2.4) * 43 + sway * (i % 2 ? 0.2 : -0.2), y = 276 + i * 9;
      c.beginPath(); c.moveTo(777, 363); c.quadraticCurveTo(778, y, x, y); c.stroke();
      c.fillStyle = i % 2 ? '#6d8953' : '#456a4b'; c.beginPath(); c.ellipse(x, y, 25, 11, i * 0.8, 0, Math.PI * 2); c.fill();
    }
    // A deliberately illustrated foreground character with a known demo mask.
    const x = 514 + sway;
    c.fillStyle = '#4b5148'; c.beginPath(); c.roundRect(x - 101, 353, 202, 190, 44); c.fill();
    c.fillStyle = '#344e52'; c.beginPath(); c.moveTo(x - 73, 540); c.lineTo(x - 86, 376); c.quadraticCurveTo(x - 79, 322, x - 37, 318); c.lineTo(x + 38, 318); c.quadraticCurveTo(x + 79, 323, x + 85, 379); c.lineTo(x + 73, 540); c.fill();
    c.fillStyle = '#bc886c'; c.fillRect(x - 21, 291, 42, 43);
    c.fillStyle = '#d0a080'; c.beginPath(); c.ellipse(x, 250, 51, 65, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#382f2d'; c.beginPath(); c.moveTo(x - 51, 264); c.bezierCurveTo(x - 74, 179, x + 13, 158, x + 50, 210); c.lineTo(x + 54, 263); c.lineTo(x + 37, 244); c.lineTo(x + 30, 214); c.quadraticCurveTo(x - 10, 237, x - 36, 222); c.lineTo(x - 38, 260); c.fill();
    c.fillStyle = '#39332d'; c.fillRect(x - 28, 253, 9, 5); c.fillRect(x + 18, 253, 9, 5);
    c.strokeStyle = '#925f50'; c.lineWidth = 3; c.beginPath(); c.moveTo(x - 10, 283); c.quadraticCurveTo(x + 1, 290, x + 13, 282); c.stroke();
    c.strokeStyle = '#a77c64'; c.beginPath(); c.moveTo(x + 1, 258); c.lineTo(x - 3, 274); c.lineTo(x + 5, 275); c.stroke();
    c.fillStyle = '#273f45'; c.beginPath(); c.moveTo(x - 66, 363); c.lineTo(x - 48, 442); c.lineTo(x + 49, 442); c.lineTo(x + 65, 363); c.lineTo(x + 72, 540); c.lineTo(x - 73, 540); c.fill();
    c.fillStyle = '#405d5c'; c.fillRect(x - 12, 335, 5, 89);
    // RGB texture detail for checking stability and simplification.
    c.globalAlpha = 0.08;
    for (let i = 0; i < 45; i++) { c.strokeStyle = i % 2 ? '#fff5d8' : '#282f2d'; c.beginPath(); c.moveTo(0, i * 13); c.lineTo(960, i * 13); c.stroke(); }
    c.globalAlpha = 1;
    const mw = 240, mh = 135, mask = new Float32Array(mw * mh);
    for (let py = 0; py < mh; py++) for (let px = 0; px < mw; px++) {
      const dx = px * 4 - x, y = py * 4;
      const head = (dx / 56) ** 2 + ((y - 249) / 73) ** 2 < 1;
      const neck = Math.abs(dx) < 22 && y > 290 && y < 339;
      const torso = y > 324 && Math.abs(dx) < Math.min(85, 36 + (y - 316) * 0.85);
      mask[py * mw + px] = head || neck || torso ? 1 : 0;
    }
    // Authored demonstration depth: window vista, wall, desk/plant, then character.
    // This is a fixture, not a claim of neural recognition or measured distance.
    const values = new Float32Array(mw * mh);
    for (let py = 0; py < mh; py++) for (let px = 0; px < mw; px++) {
      const i = py * mw + px, sx = px * 4, sy = py * 4;
      let distance = sy > 376 ? 0.65 - (sy - 376) / 164 * 0.3 : 0.78;
      if (sx > 74 && sx < 340 && sy > 52 && sy < 314) distance = 0.96;
      if (sy > 405 && sx > 58 && sx < 890) distance = 0.43;
      if (sx > 730 && sx < 830 && sy > 270 && sy < 405) distance = 0.48;
      values[i] = mask[i] ? 0.12 : distance;
    }
    return { image: await createImageBitmap(this.canvas), timestamp, generation, mask, maskWidth: mw, maskHeight: mh,
      depth: { values, width: mw, height: mh, timestamp, generation },
      face: { observation: authoredFace(x/960,250/540,102/960,130/540,timestamp,generation), strength:1, allowWarp:true } };
  }
  stop() {}
}

export function explainCaptureError(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError') return 'Camera permission was declined. Allow camera access in your browser, then try again.';
    if (error.name === 'NotFoundError') return 'No camera was found. Connect a camera or open a video file.';
    if (error.name === 'NotReadableError') return 'The camera is unavailable. Close other apps using it, or select another camera.';
    if (error.name === 'OverconstrainedError') return 'That camera is no longer available. Refresh the device list and choose another.';
    if (error.name === 'NotSupportedError') return 'This browser could not play the video source. Try another camera or a supported video format in Chrome or Edge.';
  }
  return error instanceof Error ? error.message : 'The source could not be opened.';
}
