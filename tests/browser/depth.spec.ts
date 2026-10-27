import { test, expect } from '@playwright/test';
import { copyPreset, PRESETS } from '../../src/core/presets';

test('live styling remains active with slow asynchronous estimates and an occasional invalid result', async ({ page, context }) => {
  test.setTimeout(60_000);
  await context.grantPermissions(['camera']);
  // Exercise the real studio and GPU with deterministic 1.8 s depth latency, without a download.
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    const state = { replies: 0, stopped: false, samples: [] as { styled: boolean; status: string }[] };
    (window as unknown as { depthLiveCheck: typeof state }).depthLiveCheck = state;
    class SlowDepthWorker {
      onmessage?: (event: { data: unknown }) => void;
      onerror = null;
      private timer?: ReturnType<typeof setTimeout>;
      postMessage(message: { type: string; id: number; image?: ImageBitmap }) {
        if (message.type === 'initialize') { this.timer = setTimeout(() => this.onmessage?.({ data: { type: 'ready' } }), 20); return; }
        message.image?.close();
        this.timer = setTimeout(() => {
          state.replies++;
          this.onmessage?.({ data: { type: 'result', id: message.id, width: 16, height: 9, inferenceMs: 1800,
            values: state.replies % 3 === 0 ? undefined : Float32Array.from({ length: 144 }, (_, i) => (i % 16) / 15) } });
        }, 1800);
      }
      terminate() { clearTimeout(this.timer); state.stopped = true; }
    }
    window.Worker = function(url: string | URL, options?: WorkerOptions) {
      return String(url).includes('depth.worker') ? new SlowDepthWorker() : new NativeWorker(url, options);
    } as unknown as typeof Worker;
  });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Snapshot', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Webcam', exact: false }).click();
  await expect(page.getByRole('button', { name: 'Snapshot', exact: true })).toBeEnabled();
  await page.getByRole('tab', { name: 'Experimental Settings', exact: true }).click();
  await page.getByRole('switch', { name: 'Depth-aware styling', exact: true }).click();
  await page.getByLabel('Depth preview', { exact: true }).selectOption('depth');
  await expect(page.getByText('Estimated depth active', { exact: true })).toBeVisible();
  await page.evaluate(() => {
    const state = (window as unknown as { depthLiveCheck: { replies: number; samples: { styled: boolean; status: string }[]; timer?: ReturnType<typeof setInterval> } }).depthLiveCheck;
    const tiny = document.createElement('canvas'); tiny.width = 16; tiny.height = 9;
    const context = tiny.getContext('2d')!; context.imageSmoothingEnabled = false;
    state.timer = setInterval(() => {
      const output = document.querySelector('[data-testid="output-canvas"]') as HTMLCanvasElement;
      context.drawImage(output, 0, 0, 16, 9);
      const pixels = context.getImageData(0, 0, 16, 9).data;
      const styled = pixels.every((value, i) => i % 4 > 1 || value === pixels[i - i % 4 + 2]);
      // Begin after the first styled image, then record every sample, including any fallback.
      if (styled || state.samples.length) state.samples.push({ styled, status: document.querySelector('.depth-status')?.textContent ?? '' });
    }, 100);
  });
  await page.waitForFunction(() => (window as unknown as { depthLiveCheck: { replies: number } }).depthLiveCheck.replies >= 5, undefined, { timeout: 30_000 });
  const samples = await page.evaluate(() => {
    const state = (window as unknown as { depthLiveCheck: { samples: { styled: boolean; status: string }[]; timer: ReturnType<typeof setInterval> } }).depthLiveCheck;
    clearInterval(state.timer); return state.samples;
  });
  expect(samples.length).toBeGreaterThan(25);
  expect(samples.filter(sample => !sample.styled || sample.status !== 'Estimated depth active')).toEqual([]);
  await page.getByRole('switch', { name: 'Depth-aware styling', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { depthLiveCheck: { stopped: boolean } }).depthLiveCheck.stopped)).toBe(true);
});

test('experimental depth tab styles the paused demo, previews depth, and turns off cleanly', async ({ page }) => {
  const errors: string[] = [], modelRequests: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (/huggingface|depth\.worker|ort-wasm/.test(request.url())) modelRequests.push(request.url()); });
  // Isolate toggling from unrelated temporal history accumulated while the scene moves.
  const preset = copyPreset(PRESETS[0]); preset.stability = 0; preset.outlineStability = 0;
  await page.addInitScript(value => localStorage.setItem('vxl.preset.v1', JSON.stringify(value)), preset);
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Snapshot', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Pause preview' }).click();
  const canvas = page.getByTestId('output-canvas');
  const before = await canvas.evaluate(c => (c as HTMLCanvasElement).toDataURL());
  await page.getByRole('tab', { name: 'Experimental Settings', exact: true }).click();
  const toggle = page.getByRole('switch', { name: 'Depth-aware styling', exact: true });
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await expect(page.getByRole('slider', { name: 'Distant simplification', exact: true })).toBeDisabled();
  await toggle.click();
  await expect(page.getByText('Authored demo depth · not AI detection')).toBeVisible();
  await expect.poll(() => canvas.evaluate(c => (c as HTMLCanvasElement).toDataURL())).not.toBe(before);
  await page.getByLabel('Depth preview', { exact: true }).selectOption('planes');
  await expect.poll(async () => canvas.evaluate(c => {
    const tiny = document.createElement('canvas'); tiny.width = 32; tiny.height = 18;
    const ctx = tiny.getContext('2d')!; ctx.imageSmoothingEnabled = false; ctx.drawImage(c as HTMLCanvasElement, 0, 0, 32, 18);
    const data = ctx.getImageData(0, 0, 32, 18).data;
    return new Set(Array.from({ length: 32 * 18 }, (_, i) => `${data[i * 4]},${data[i * 4 + 1]},${data[i * 4 + 2]}`)).size;
  })).toBe(3);
  await toggle.click();
  await expect.poll(() => canvas.evaluate(c => (c as HTMLCanvasElement).toDataURL())).toBe(before);
  expect(modelRequests).toEqual([]); expect(errors).toEqual([]);
  await page.reload();
  await page.getByRole('tab', { name: 'Experimental Settings', exact: true }).click();
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
});

test('relative depth preserves near colors, quiets distance, obeys palettes, and rejects stale fields', async ({ page }) => {
  test.skip(process.env.VXL_TEST_PREVIEW === '1', 'Analytic fixtures import source modules.');
  await page.route('**/__depth-fixture', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Depth fixture</title>' }));
  await page.goto('/__depth-fixture');
  const result = await page.evaluate(async () => {
    const path = '/tests/helpers/depth.ts'; return (await import(/* @vite-ignore */ path)).depthFixture();
  });
  const at = (data: number[], x: number, y = 20) => data.slice((y * result.w + x) * 4, (y * result.w + x) * 4 + 3);
  expect(result.glError).toBe(0); expect(result.paletteOnly).toBe(true);
  expect(at(result.styled, 12)).toEqual(at(result.baseline, 12));
  expect(at(result.styled, 80).reduce((a, b) => a + b)).toBeGreaterThan(at(result.baseline, 80).reduce((a, b) => a + b));
  expect(at(result.planes, 12)).toEqual([56, 199, 166]);
  expect(at(result.planes, 44)).toEqual([232, 173, 74]);
  expect(at(result.planes, 80)).toEqual([102, 145, 219]);
  expect(at(result.map, 12, 8)).toEqual([0, 0, 0]); expect(at(result.map, 12, 56)).toEqual([255, 255, 255]);
  expect(result.disabled).toEqual(result.baseline); expect(result.stale).toEqual(result.baseline); expect(result.wrongSource).toEqual(result.baseline);
  expect(result.fadedOut).toEqual(result.baseline);
});

test('real depth worker downloads and estimates a local synthetic scene', async ({ page }) => {
  test.skip(process.env.VXL_TEST_DEPTH_MODEL !== '1', 'Opt-in network/model smoke check.');
  test.skip(process.env.VXL_TEST_PREVIEW === '1', 'Direct worker fixture imports source modules.');
  test.setTimeout(180_000);
  await page.route('**/__depth-model', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Depth model</title>' }));
  await page.goto('/__depth-model');
  const result = await page.evaluate(async () => {
    const path = '/src/vision/depth.ts', sourcePath = '/src/capture/sources.ts';
    const { SceneDepthEstimator } = await import(/* @vite-ignore */ path);
    const { DemoSource } = await import(/* @vite-ignore */ sourcePath);
    const source = new DemoSource(); source.motion = false;
    const frame = await source.capture(100, 1); delete frame.depth;
    const statuses: string[] = [];
    return await new Promise<{ min: number; max: number; width: number; height: number; elapsed: number; statuses: string[] }>((resolve, reject) => {
      const start = performance.now(), scene = new Uint8ClampedArray(16 * 9 * 4);
      let timer: ReturnType<typeof setTimeout>;
      const estimator = new SceneDepthEstimator((status: string, message?: string) => {
        statuses.push(status); if (status === 'error') { clearTimeout(timer); estimator.dispose(); frame.image.close(); reject(new Error(message)); }
      }, () => {
        const field = estimator.update(frame, scene);
        if (field) { clearTimeout(timer); estimator.dispose(); frame.image.close(); resolve({ min: Math.min(...field.values), max: Math.max(...field.values), width: field.width, height: field.height, elapsed: performance.now() - start, statuses }); }
      });
      timer = setTimeout(() => { estimator.dispose(); frame.image.close(); reject(new Error('Depth model check timed out')); }, 150_000);
      estimator.update(frame, scene);
    });
  });
  expect(result.min).toBe(0); expect(result.max).toBe(1); expect(result.width).toBeGreaterThan(1); expect(result.height).toBeGreaterThan(1);
  console.log('Depth worker smoke check:', JSON.stringify(result));
});

test('real depth and person models coexist on live and paused synthetic camera input', async ({ page, context }) => {
  test.skip(process.env.VXL_TEST_DEPTH_MODEL !== '1', 'Opt-in network/model integration check.');
  test.setTimeout(180_000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await context.grantPermissions(['camera']);
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Snapshot', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Webcam', exact: false }).click();
  await expect(page.getByRole('button', { name: 'Snapshot', exact: true })).toBeEnabled();
  await page.getByRole('switch', { name: 'Person separation', exact: true }).click();
  await expect(page.getByText('Person model ready', { exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await page.getByRole('tab', { name: 'Experimental Settings', exact: true }).click();
  await page.getByRole('switch', { name: 'Depth-aware styling', exact: true }).click();
  await expect(page.getByText('Estimated depth active', { exact: true })).toBeVisible({ timeout: 150_000 });
  const liveStatuses = await page.evaluate(async () => {
    const statuses: string[] = [];
    const timer = setInterval(() => statuses.push(document.querySelector('.depth-status')?.textContent ?? ''), 100);
    await new Promise(resolve => setTimeout(resolve, 6000)); clearInterval(timer); return statuses;
  });
  expect(liveStatuses.length).toBeGreaterThan(5);
  expect(liveStatuses.filter(status => status !== 'Estimated depth active' && status !== 'Refreshing depth · keeping the last estimate')).toEqual([]);
  console.log(`Real live depth: ${liveStatuses.length} status samples, no fallback during six seconds of streaming.`);
  await page.getByRole('button', { name: 'Pause preview' }).click();
  await expect(page.getByText('Estimated depth active', { exact: true })).toBeVisible();
  await page.getByLabel('Depth preview', { exact: true }).selectOption('depth');
  await expect(page.getByRole('alert')).toHaveCount(0); expect(errors).toEqual([]);
  await page.getByRole('switch', { name: 'Depth-aware styling', exact: true }).click();
  await expect(page.getByText('Off · no depth model running', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Studio scene', exact: false }).click();
  await expect(page.getByRole('button', { name: 'Pause preview' })).toBeEnabled();
});
