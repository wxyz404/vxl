import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('studio renders, changes looks, isolates demo regions, and exports a PNG', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  const snapshot = page.getByRole('button', { name: 'Snapshot', exact: true });
  await expect(snapshot).toBeEnabled();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.getByRole('button', { name: 'Pause preview' }).click();
  const colors = await page.getByTestId('output-canvas').evaluate(canvas => {
    const c = canvas as HTMLCanvasElement, gl = c.getContext('webgl2')!;
    const pixels = new Uint8Array(c.width * c.height * 4); gl.readPixels(0, 0, c.width, c.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    const unique = new Set<string>(); for (let i = 0; i < pixels.length; i += 4) unique.add(`#${[pixels[i], pixels[i + 1], pixels[i + 2]].map(n => n.toString(16).padStart(2, '0')).join('')}`);
    return [...unique];
  });
  expect(colors.length).toBeGreaterThan(8); expect(colors.length).toBeLessThanOrEqual(32);
  await page.getByRole('button', { name: /Sprite Scene/ }).click();
  await page.getByRole('switch', { name: 'Person separation', exact: true }).click();
  await expect(page.getByText('Illustrated demo mask', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Background', exact: true }).click();
  await page.getByLabel('Color palette', { exact: true }).selectOption('ember');
  await page.getByRole('button', { name: 'Compare', exact: true }).click();
  await expect(page.getByLabel('Original video preview')).toBeVisible();
  const download = page.waitForEvent('download');
  await snapshot.click();
  expect((await download).suggestedFilename()).toMatch(/^vxl-.*\.png$/);
  expect(errors).toEqual([]);
});

test('GPU output stays on the imported palette and retains integer-sized pixels', async ({ page }) => {
  await page.goto('/'); await expect(page.getByRole('button', { name: 'Snapshot', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Pause preview' }).click();
  await page.getByLabel('Import palette file', { exact: true }).setInputFiles({ name: 'test.json', mimeType: 'application/json', buffer: Buffer.from('["#000000", "#ffffff"]') });
  await expect(page.getByText('Palette imported.', { exact: true })).toBeVisible();
  await expect.poll(async () => page.getByTestId('output-canvas').evaluate(canvas => {
    const c = canvas as HTMLCanvasElement, gl = c.getContext('webgl2')!;
    const pixels = new Uint8Array(c.width * c.height * 4); gl.readPixels(0, 0, c.width, c.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let invalid = 0;
    for (let i = 0; i < pixels.length; i += 4) if (!(pixels[i] === pixels[i + 1] && pixels[i + 1] === pixels[i + 2] && (pixels[i] === 0 || pixels[i] === 255) && pixels[i + 3] === 255)) invalid++;
    return invalid;
  })).toBe(0);
});

test('invalid presets are rejected without replacing the active look', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Import preset file', { exact: true }).setInputFiles({ name: 'broken.json', mimeType: 'application/json', buffer: Buffer.from('{"version":99}') });
  await expect(page.getByRole('alert')).toContainText('not a supported VXL');
  await expect(page.getByRole('button', { name: /Pixel Video/ })).toHaveClass(/active/);
});

test('real worker loads the local model and returns a matching frame and confidence mask offline', async ({ page, context }) => {
  test.skip(process.env.VXL_TEST_PREVIEW === '1', 'Production worker coverage uses the full camera flow instead of importing source files.');
  await page.goto('/'); await expect(page.getByRole('button', { name: 'Snapshot', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Pause preview' }).click();
  await context.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  const result = await page.evaluate(async () => {
    const path = '/src/vision/segmenter.ts';
    const { PersonSegmenter } = await import(/* @vite-ignore */ path);
    const segmenter = new PersonSegmenter();
    try {
      await segmenter.initialize();
      const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 180;
      const c = canvas.getContext('2d')!; c.fillStyle = '#968573'; c.fillRect(0, 0, 320, 180);
      const output = await segmenter.segment({ image: await createImageBitmap(canvas), timestamp: performance.now(), generation: 7 });
      const result = { width: output.image.width, height: output.image.height, generation: output.generation, maskLength: output.mask.length, expected: output.maskWidth * output.maskHeight, valid: [...output.mask].every((v: number) => Number.isFinite(v) && v >= 0 && v <= 1), inferenceMs: output.inferenceMs };
      output.image.close(); return result;
    } finally { segmenter.dispose(); }
  });
  expect(result.width).toBe(320); expect(result.height).toBe(180); expect(result.generation).toBe(7);
  expect(result.maskLength).toBeGreaterThan(0); expect(result.maskLength).toBe(result.expected); expect(result.valid).toBe(true); expect(result.inferenceMs).toBeGreaterThan(0);
});

test('records a playable silent clip and unlocks source controls after stopping', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/'); await expect(page.getByRole('button', { name: 'Record clip', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Record clip', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Webcam', exact: false })).toBeDisabled();
  await expect(page.getByRole('button', { name: /Stop 0:0[1-9]/ })).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: /Stop 0:/ }).click();
  const file = await download; expect(file.suggestedFilename()).toMatch(/\.(webm|mp4)$/);
  await expect(page.getByRole('button', { name: 'Webcam', exact: false })).toBeEnabled();
  const bytes = await readFile((await file.path())!);
  expect(bytes.length).toBeGreaterThan(1000);
  await page.getByLabel('Open video file', { exact: true }).setInputFiles({ name: file.suggestedFilename(), mimeType: file.suggestedFilename().endsWith('.webm') ? 'video/webm' : 'video/mp4', buffer: bytes });
  await expect(page.getByText(file.suggestedFilename(), { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Snapshot', exact: true })).toBeEnabled();
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('synthetic webcam runs real person segmentation and releases tracks on source changes', async ({ page, context }) => {
  await context.grantPermissions(['camera']);
  await page.addInitScript(() => {
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    (window as unknown as { cameraTracks: MediaStreamTrack[] }).cameraTracks = [];
    navigator.mediaDevices.getUserMedia = async options => {
      const stream = await original(options);
      (window as unknown as { cameraTracks: MediaStreamTrack[] }).cameraTracks.push(...stream.getTracks());
      return stream;
    };
  });
  await page.goto('/'); await expect(page.getByRole('button', { name: 'Snapshot', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Webcam', exact: false }).click();
  await expect(page.getByRole('button', { name: 'Snapshot', exact: true })).toBeEnabled();
  await page.getByRole('switch', { name: 'Person separation', exact: true }).click();
  await expect(page.getByText('Person model ready', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Pause preview' }).click();
  await page.getByRole('switch', { name: 'Person separation', exact: true }).click();
  await page.getByRole('switch', { name: 'Person separation', exact: true }).click();
  await page.getByRole('button', { name: 'Studio scene', exact: false }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { cameraTracks: MediaStreamTrack[] }).cameraTracks.map(track => track.readyState))).toEqual(['ended']);
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('missing model falls back to whole-frame styling and can be retried', async ({ page, context }) => {
  await context.grantPermissions(['camera']);
  await page.route('**/vision/*.tflite', route => route.fulfill({ status: 404, body: 'Missing' }));
  await page.goto('/'); await expect(page.getByRole('button', { name: 'Snapshot', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Webcam', exact: false }).click();
  await expect(page.getByRole('button', { name: 'Snapshot', exact: true })).toBeEnabled();
  await page.getByRole('switch', { name: 'Person separation', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Whole-frame styling is still available');
  await expect(page.getByText('Whole-frame fallback', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Snapshot', exact: true })).toBeEnabled();
  await page.unroute('**/vision/*.tflite');
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByText('Person model ready', { exact: true })).toBeVisible();
});

test('camera denial is recoverable and mobile layout stays within the viewport', async ({ page }) => {
  await page.addInitScript(() => { navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Denied', 'NotAllowedError'); }; });
  await page.goto('/'); await expect(page.getByRole('button', { name: 'Snapshot', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Webcam', exact: false }).click();
  await expect(page.getByRole('alert')).toContainText('Camera permission was declined');
  await page.getByRole('button', { name: 'Studio scene', exact: false }).click();
  await expect(page.getByRole('button', { name: 'Snapshot', exact: true })).toBeEnabled();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/mobile.png', fullPage: true });
});
