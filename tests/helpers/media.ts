import { FileSource } from '../../src/capture/sources';
import { Studio } from '../../src/core/studio';
import { copyPreset, PRESETS } from '../../src/core/presets';
import { PixelRenderer } from '../../src/render/renderer';
import { authoredFace } from '../../src/vision/face-geometry';
import type { FramePacket } from '../../src/core/types';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export async function makeVideo() {
  const response = await fetch('/tests/fixtures/processing.webm');
  if (!response.ok) throw new Error('Missing authored video fixture');
  return new File([await response.blob()], 'sample.webm', { type: 'video/webm' });
}

export async function sequentialSource() {
  const source = new FileSource(await makeVideo()); source.configureProcessing(true);
  const times: number[] = [], clocks: number[] = [];
  try {
    await source.start();
    for (let i = 0; i < 4; i++) {
      const frame = await source.capture(performance.now(), 1);
      if (!frame) throw new Error('No decoded sample');
      times.push(source.sampleTime); clocks.push(frame.timestamp); frame.image.close();
      // Artificial processing delay must not skip timeline samples.
      await sleep(90); source.commitFrame(30);
    }
    const paused = source.video.paused;
    source.restart(); const replay = await source.capture(performance.now(), 2); replay?.image.close();
    return { times, clocks, paused, replayTime: source.sampleTime, duration: source.duration };
  } finally { source.stop(); }
}

/** Controlled latency proves scheduling and matching, independently of neural accuracy. */
export async function controlledProcessing(effort: number, delay: number, cancel = false) {
  const NativeWorker = window.Worker, originalRender = PixelRenderer.prototype.render;
  const frames: { timestamp: number; face?: number; depth?: number; passes?: number; source: string }[] = [];
  const workers: SlowWorker[] = [];
  class SlowWorker {
    onmessage?: (event: { data: unknown }) => void;
    timers: ReturnType<typeof setTimeout>[] = [];
    ended = false;
    constructor(private url: URL) { workers.push(this); }
    postMessage(message: { type: string; id: number; timestamp: number; generation: number; image?: ImageBitmap }) {
      const send = (data: unknown, latency: number) => this.timers.push(setTimeout(() => this.onmessage?.({ data }), latency));
      if (message.type === 'initialize') { send({ type: 'ready' }, 1); return; }
      message.image?.close();
      if (String(this.url).includes('depth.worker')) send({ type: 'result', id: message.id, values: new Float32Array([0, 0.3, 0.7, 1]), width: 2, height: 2, inferenceMs: delay }, delay);
      else send({ type: 'result', id: message.id, timestamp: message.timestamp, generation: message.generation, landmarks: authoredFace(.5, .5, .5, .6).landmarks, inferenceMs: delay }, delay);
    }
    terminate() { this.ended = true; this.timers.forEach(clearTimeout); }
  }
  window.Worker = SlowWorker as unknown as typeof Worker;
  const preset = copyPreset(PRESETS[0]); preset.resolution = 160; preset.fileProcessing = effort;
  preset.face.enabled = true; preset.depth.enabled = true;
  const errors: string[] = [], source = new FileSource(await makeVideo());
  let done!: () => void, lastExpired = false, studio!: Studio;
  const finished = new Promise<void>(resolve => { done = resolve; });
  PixelRenderer.prototype.render = function(frame: FramePacket, look) {
    frames.push({ timestamp: frame.timestamp, face: frame.face?.observation.timestamp, depth: frame.depth?.timestamp, passes: frame.refinementPasses, source: studio.currentSource?.kind ?? '' });
    return originalRender.call(this, frame, look);
  };
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    studio = new Studio(document.createElement('canvas'), document.createElement('canvas'), preset, {
      onStats: stats => { lastExpired = stats.processingWaitExpired ?? false; }, onError: error => errors.push(error), onSource() {}, onVision() {}, onEnded: done,
    });
    studio.fpsLimit = 15;
    await studio.setSource(source);
    if (cancel) {
      while (!workers.length) await sleep(16);
      await sleep(40);
      const { DemoSource } = await import('../../src/capture/sources');
      await studio.setSource(new DemoSource()); await sleep(delay + 150); done();
    }
    await Promise.race([finished, new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('Processing did not finish')), 20_000); })]);
    await sleep(1000); // Capture final diagnostic status after completion.
    return { frames, errors, expired: lastExpired, stoppedWorkers: workers.filter(worker => worker.ended).length, duration: source.duration };
  } finally { clearTimeout(timeout); studio?.dispose(); PixelRenderer.prototype.render = originalRender; window.Worker = NativeWorker; }
}

export async function refinementComparison() {
  const image = await createImageBitmap(await (await fetch('/tests/fixtures/astronaut.png')).blob());
  const canvas = document.createElement('canvas'), renderer = new PixelRenderer(canvas), preset = copyPreset(PRESETS[0]);
  preset.resolution = 160;
  const frame: FramePacket = { image, timestamp: 100, generation: 1 };
  const read = () => { const c = new OffscreenCanvas(canvas.width, canvas.height).getContext('2d')!; c.drawImage(canvas, 0, 0); return c.getImageData(0, 0, canvas.width, canvas.height).data; };
  const outputs: string[] = [], changed: number[] = [], paletteOnly: boolean[] = [];
  const palette = new Set(preset.foreground.palette.map(color => color.toLowerCase()));
  let baseline: Uint8ClampedArray | undefined;
  try {
    for (let level = 0; level <= 4; level++) {
      renderer.resetHistory(); renderer.render({ ...frame, refinementPasses: level }, preset);
      const pixels = read(); baseline ??= pixels;
      let difference = 0, valid = true;
      for (let i=0; i<pixels.length; i+=4) {
        if (pixels[i]!==baseline[i] || pixels[i+1]!==baseline[i+1] || pixels[i+2]!==baseline[i+2]) difference++;
        if (!palette.has('#'+Array.from(pixels.slice(i,i+3), v => v.toString(16).padStart(2,'0')).join(''))) valid = false;
      }
      changed.push(difference); paletteOnly.push(valid); outputs.push(canvas.toDataURL());
    }
    // Returning to zero must reproduce the unmodified branch exactly.
    renderer.render({ ...frame, refinementPasses: 0 }, preset);
    const zeroRestored = read().every((value, index) => value === baseline![index]);
    return { changed, paletteOnly, zeroRestored, outputs, glError: canvas.getContext('webgl2')!.getError() };
  } finally { image.close(); renderer.dispose(); }
}
