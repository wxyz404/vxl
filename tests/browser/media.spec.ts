import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { copyPreset, PRESETS } from '../../src/core/presets';

test('PNG and JPG uploads stay editable, export art, and keep processing opt-in', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.route('**/__portrait.png', route => route.fulfill({ contentType: 'image/png', path: 'tests/fixtures/astronaut.png' }));
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Snapshot', exact: true })).toBeEnabled();
  await page.getByRole('tab', { name: 'Experimental Settings', exact: true }).click();
  const effort = page.getByRole('slider', { name: 'Extra processing per frame', exact: true });
  await expect(effort).toHaveValue('0'); await expect(effort).toBeDisabled();
  await page.getByLabel('Open image file', { exact: true }).setInputFiles('tests/fixtures/astronaut.png');
  await expect(page.getByText('IMAGE', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Snapshot', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Play preview', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Record clip', exact: true })).toBeDisabled();
  await expect(effort).toBeEnabled(); await effort.fill('4');
  await expect(page.getByText(/4 extra edge-preserving smoothing passes/)).toBeVisible();
  if (existsSync('public/vision/face_landmarker.task')) {
    await page.getByRole('switch', { name: 'Face readability', exact: true }).click();
    await expect(page.locator('.face-status')).toHaveText('Tracking one face');
    await page.getByRole('switch', { name: 'Face readability', exact: true }).click();
  }
  await page.getByRole('switch', { name: 'Person separation', exact: true }).click();
  await expect(page.getByText('Person model ready', { exact: true })).toBeVisible();
  const saved = page.waitForEvent('download'); await page.getByRole('button', { name: 'Snapshot', exact: true }).click();
  const download = await saved; expect(download.suggestedFilename()).toMatch(/\.png$/);
  expect((await readFile((await download.path())!)).length).toBeGreaterThan(1000);
  const jpg = await page.evaluate(async () => {
    const image = new Image(); image.src = '/__portrait.png'; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = 120; canvas.height = 80;
    canvas.getContext('2d')!.drawImage(image, 0, 0, 120, 80);
    const blob = await new Promise<Blob>(resolve => canvas.toBlob(blob => resolve(blob!), 'image/jpeg'));
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  });
  await page.getByLabel('Open image file', { exact: true }).setInputFiles({ name: 'still.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(jpg) });
  await expect(page.locator('.file-label')).toHaveText('still.jpg');
  await expect(page.getByRole('button', { name: 'Snapshot', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: /Studio scene/ }).click();
  await expect(effort).toBeDisabled(); await expect(page.getByRole('button', { name: 'Pause preview', exact: true })).toBeEnabled();
  expect(errors).toEqual([]); await expect(page.getByRole('alert')).toHaveCount(0);
});

test('corrupt image reports a readable error and another upload recovers', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Open image file', { exact: true }).setInputFiles({ name: 'broken.png', mimeType: 'image/png', buffer: Buffer.from('not an image') });
  await expect(page.getByRole('alert')).toContainText('could not be decoded');
  await page.getByLabel('Open image file', { exact: true }).setInputFiles('tests/fixtures/astronaut.png');
  await expect(page.getByRole('button', { name: 'Snapshot', exact: true })).toBeEnabled();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('transparent PNGs use the documented background and retain their aspect ratio', async ({ page }) => {
  await page.goto('/');
  const bytes = await page.evaluate(async () => {
    const canvas=document.createElement('canvas');canvas.width=16;canvas.height=8;
    const c=canvas.getContext('2d')!;c.fillStyle='#ff0000';c.fillRect(8,0,8,8);
    const blob=await new Promise<Blob>(resolve=>canvas.toBlob(blob=>resolve(blob!),'image/png'));
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  });
  await page.getByLabel('Open image file',{exact:true}).setInputFiles({name:'transparent.png',mimeType:'image/png',buffer:Buffer.from(bytes)});
  await expect(page.getByRole('button',{name:'Snapshot',exact:true})).toBeEnabled();
  const result=await page.getByLabel('Original video preview').evaluate(element=>{
    const canvas=element as HTMLCanvasElement;
    return {ratio:canvas.width/canvas.height,corner:Array.from(canvas.getContext('2d')!.getImageData(0,0,1,1).data)};
  });
  expect(result.ratio).toBe(2);expect(result.corner).toEqual([32,36,33,255]);
});

test('an uploaded image keeps ordinary art available when the person model is missing', async ({ page }) => {
  const preset=copyPreset(PRESETS[0]);preset.segmentation=true;
  await page.addInitScript(value=>localStorage.setItem('vxl.preset.v1',JSON.stringify(value)),preset);
  await page.route('**/vision/*.tflite',route=>route.fulfill({status:404,body:'missing'}));
  await page.goto('/');
  await page.getByLabel('Open image file',{exact:true}).setInputFiles('tests/fixtures/astronaut.png');
  await expect(page.getByRole('alert')).toContainText('Whole-frame styling is still available');
  await expect(page.getByRole('button',{name:'Snapshot',exact:true})).toBeEnabled();
  await expect(page.getByText('IMAGE',{exact:true})).toBeVisible();
});

test('refinement changes actual pixels, stays on-palette, and returns exactly to zero', async ({ page }) => {
  test.skip(process.env.VXL_TEST_PREVIEW === '1', 'Renderer fixture imports source modules.');
  await page.route('**/__media-fixture', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Media fixture</title>' }));
  await page.goto('/__media-fixture');
  const result = await page.evaluate(async () => {
    const path = '/tests/helpers/media.ts'; const { refinementComparison } = await import(/* @vite-ignore */path);
    const { outputs: _images, ...metrics } = await refinementComparison(); return metrics;
  });
  expect(result.changed[0]).toBe(0);
  expect(result.changed.slice(1).every((count: number) => count > 0)).toBe(true);
  expect(result.paletteOnly).toEqual([true, true, true, true, true]);
  expect(result.zeroRestored).toBe(true); expect(result.glError).toBe(0);
});

test('slow sequential video samples preserve their media spacing and replay starts at zero', async ({ page }) => {
  test.skip(process.env.VXL_TEST_PREVIEW === '1', 'Source fixture imports source modules.');
  await page.route('**/__media-fixture', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Media fixture</title>' }));
  await page.goto('/__media-fixture');
  const result = await page.evaluate(async () => { const path='/tests/helpers/media.ts'; return (await import(/* @vite-ignore */path)).sequentialSource(); });
  expect(result.paused).toBe(true); expect(result.replayTime).toBe(0); expect(result.duration).toBeGreaterThan(0);
  result.times.forEach((time: number, index: number) => expect(time).toBeCloseTo(index / 30, 6));
  result.clocks.slice(1).forEach((time: number, index: number) => expect(time - result.clocks[index]).toBeCloseTo(1000 / 30, 6));
});

test('sequential processing waits for matching estimates, bounds latency, and cancels on source change', async ({ page }) => {
  test.setTimeout(90_000);
  test.skip(process.env.VXL_TEST_PREVIEW === '1', 'Controlled worker fixture imports source modules.');
  await page.route('**/__media-fixture', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Media fixture</title>' }));
  await page.goto('/__media-fixture');
  const run = (effort: number, delay: number, cancel = false) => page.evaluate(async params => {
    const path='/tests/helpers/media.ts'; return (await import(/* @vite-ignore */path)).controlledProcessing(...params);
  }, [effort, delay, cancel] as const);
  const matched = await run(2, 120);
  expect(matched.errors).toEqual([]); expect(matched.frames.length).toBeGreaterThan(3);
  expect(matched.frames.every((frame: { timestamp: number; face: number; depth: number; passes: number }) => frame.face === frame.timestamp && frame.depth === frame.timestamp && frame.passes === 2)).toBe(true);
  matched.frames.slice(1).forEach((frame: { timestamp: number }, i: number) => expect(frame.timestamp - matched.frames[i].timestamp).toBeCloseTo(1000/15, 5));
  const bounded = await run(1, 600);
  expect(bounded.errors).toEqual([]); expect(bounded.expired).toBe(true);
  expect(bounded.frames.every((frame: { timestamp: number; face?: number; depth?: number }) => (frame.face === undefined || frame.face === frame.timestamp) && (frame.depth === undefined || frame.depth === frame.timestamp))).toBe(true);
  const cancelled = await run(4, 450, true);
  expect(cancelled.errors).toEqual([]); expect(cancelled.stoppedWorkers).toBeGreaterThan(0);
  expect(cancelled.frames.every((frame: { source: string }) => frame.source === 'demo')).toBe(true);
});

test('uploaded video uses the experimental slider and returning to zero resumes playback', async ({ page }) => {
  const preset = copyPreset(PRESETS[0]); preset.fileProcessing = 4; preset.resolution = 160;
  await page.addInitScript(value => {
    localStorage.setItem('vxl.preset.v1', JSON.stringify(value));
    const state=window as unknown as {playStarts:number[]};state.playStarts=[];
    const play=HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play=function(){state.playStarts.push(this.currentTime);return play.call(this);};
  }, preset);
  await page.goto('/');
  await page.getByLabel('Open video file', { exact: true }).setInputFiles({ name: 'sample.webm', mimeType: 'video/webm', buffer: await readFile('tests/fixtures/processing.webm') });
  await page.getByRole('tab', { name: 'Experimental Settings', exact: true }).click();
  await expect(page.locator('.processing-status')).toContainText('Video position');
  const paused = page.getByRole('button', { name: 'Play preview', exact: true }); await expect(paused).toBeEnabled();
  await page.getByRole('slider', { name: 'Extra processing per frame', exact: true }).fill('0');
  await paused.click();
  expect(await page.evaluate(()=>(window as unknown as {playStarts:number[]}).playStarts[0])).toBe(0);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Snapshot', exact: true })).toBeEnabled();
});
