export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob), anchor = document.createElement('a');
  anchor.href = url; anchor.download = filename; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
export function exportJson(value: unknown, filename: string) {
  downloadBlob(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }), filename);
}
export function timestampName() { return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19); }

export class CanvasRecorder {
  private recorder?: MediaRecorder;
  private stream?: MediaStream;
  private chunks: Blob[] = [];
  private bytes = 0;
  private timeout?: ReturnType<typeof setTimeout>;
  private captureTimer?: ReturnType<typeof setInterval>;
  private surface?: HTMLCanvasElement;
  get active() { return this.recorder?.state === 'recording'; }

  start(canvas: HTMLCanvasElement, grid: { width: number; height: number }, onStop: (blob: Blob, extension: string) => void, onError: (message: string) => void) {
    if (typeof MediaRecorder === 'undefined' || !canvas.captureStream) throw new Error('This browser cannot record the canvas. Use Chrome or Edge, or save a snapshot.');
    // VP8 is more reliable than VP9 on software and integrated graphics encoders.
    const type = ['video/webm;codecs=vp8', 'video/webm', 'video/mp4', 'video/webm;codecs=vp9'].find(t => MediaRecorder.isTypeSupported(t));
    if (!type) throw new Error('This browser has no supported video recording format.');
    // A 2D recording surface also captures WebGL output reliably on software GPUs.
    // Keep its size fixed for the encoder's lifetime.
    const surface = this.surface = document.createElement('canvas');
    const scale = Math.max(1, Math.floor(640 / Math.max(grid.width, grid.height)));
    surface.width = grid.width * scale; surface.height = grid.height * scale;
    surface.style.cssText = 'position:fixed;left:-10000px;top:0;pointer-events:none';
    surface.setAttribute('aria-hidden', 'true');
    document.body.append(surface);
    const context = surface.getContext('2d');
    if (!context) { surface.remove(); throw new Error('The browser could not create a recording surface.'); }
    context.imageSmoothingEnabled = false;
    context.drawImage(canvas, 0, 0, surface.width, surface.height);
    this.stream = surface.captureStream(30);
    const track = this.stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack;
    try { this.recorder = new MediaRecorder(this.stream, { mimeType: type, videoBitsPerSecond: 6_000_000 }); }
    catch (error) { this.dispose(); throw error; }
    this.chunks = []; this.bytes = 0;
    this.recorder.ondataavailable = event => {
      if (event.data.size) { this.chunks.push(event.data); this.bytes += event.data.size; }
      if (this.bytes > 200 * 1024 * 1024) { onError('Recording reached the 200 MB limit and has been saved.'); this.stop(); }
    };
    this.recorder.onerror = () => { onError('Recording stopped because the browser encoder failed.'); this.stop(); };
    this.recorder.onstop = () => {
      const blob = new Blob(this.chunks, { type });
      this.chunks = []; this.stream?.getTracks().forEach(track => track.stop());
      this.stream = undefined; clearTimeout(this.timeout); clearInterval(this.captureTimer); this.recorder = undefined; surface.remove(); this.surface = undefined;
      if (blob.size) onStop(blob, type.includes('mp4') ? 'mp4' : 'webm');
      else onError('The browser did not produce a video. Try recording again or save a snapshot.');
    };
    this.recorder.start(1000);
    const capture = () => { context.drawImage(canvas, 0, 0, surface.width, surface.height); track.requestFrame(); };
    capture();
    this.captureTimer = setInterval(capture, 1000 / 30);
    this.timeout = setTimeout(() => { onError('Recording reached the 5-minute clip limit and has been saved.'); this.stop(); }, 5 * 60_000);
    return { width: surface.width, height: surface.height };
  }
  stop() { if (this.recorder && this.recorder.state !== 'inactive') this.recorder.stop(); }
  dispose() {
    clearTimeout(this.timeout);
    clearInterval(this.captureTimer);
    if (this.recorder) { this.recorder.ondataavailable = null; this.recorder.onstop = null; this.recorder.onerror = null; this.stop(); }
    this.stream?.getTracks().forEach(track => track.stop()); this.chunks = []; this.recorder = undefined;
    this.surface?.remove(); this.surface = undefined;
  }
}
