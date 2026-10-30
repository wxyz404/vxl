import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const output = resolve(root, process.argv[2] ?? '.cache/palette-mapping-comparison.png');
const base = 'http://127.0.0.1:5183';
process.env.PLAYWRIGHT_BROWSERS_PATH ??= resolve(root, '.cache/playwright');
const { chromium } = await import('@playwright/test');
const server = spawn(process.execPath, [resolve(root, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', '5183'], { cwd: root, stdio: 'ignore', windowsHide: true });
let browser;
try {
  let available = false;
  for (let i = 0; i < 50; i++) { try { await fetch(base); available = true; break; } catch { await new Promise(r => setTimeout(r, 200)); } }
  if (!available) throw new Error('Could not start palette comparison server on port 5183.');
  browser = await chromium.launch({ channel: 'chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1080 } });
  await page.route('**/__comparison', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Palette comparison</title>' }));
  await page.goto(`${base}/__comparison`);
  const sheet = await page.evaluate(async () => {
    const { DemoSource } = await import('/src/capture/sources.ts');
    const { PixelRenderer } = await import('/src/render/renderer.ts');
    const { copyPreset, PRESETS, PALETTES } = await import('/src/core/presets.ts');
    const source = new DemoSource(); source.motion = false;
    const frame = await source.capture(100, 1), canvas = document.createElement('canvas'), renderer = new PixelRenderer(canvas);
    const sheet = document.createElement('canvas'); sheet.width = 1728; sheet.height = 710;
    const c = sheet.getContext('2d'); c.fillStyle = '#151b13'; c.fillRect(0, 0, sheet.width, sheet.height);
    c.fillStyle = '#d8e9c8'; c.font = 'bold 25px Arial'; c.fillText('VXL / experimental palette interpretation', 24, 36);
    c.font = '14px Arial'; c.fillStyle = '#a0b38f'; c.fillText('Same frozen illustration and exact output palettes. Full transfer strength; automatic ramps. Aesthetic comparison, not a camera benchmark.', 24, 62);
    for (const [row, palette] of [PALETTES.ember, PALETTES.mono].entries()) {
      const preset = copyPreset(PRESETS[0]); preset.foreground.palette = [...palette.colors];
      c.fillStyle = '#d8e9c8'; c.font = 'bold 17px Arial'; c.fillText(palette.name, 24, 101 + row * 300);
      for (const [column, [mode, label]] of [['nearest', 'Current / perceptual nearest'], ['mood', 'Palette mood'], ['correspondence', 'Palette correspondence'], ['ramp', 'Tonal ramp']].entries()) {
        preset.foreground.colorMapping.mode = mode; renderer.resetHistory(); renderer.render(frame, preset);
        const x = 24 + column * 426, y = 139 + row * 300;
        c.fillStyle = '#b7cda4'; c.font = '14px Arial'; c.fillText(label, x, y - 12);
        c.imageSmoothingEnabled = false; c.drawImage(canvas, x, y, 400, 225);
      }
    }
    frame.image.close(); renderer.dispose(); source.stop(); return sheet.toDataURL('image/png');
  });
  await mkdir(dirname(output), { recursive: true }); await writeFile(output, Buffer.from(sheet.split(',')[1], 'base64'));
  await page.goto(base); await page.getByRole('button', { name: 'Snapshot', exact: true }).waitFor({ state: 'visible' });
  await page.getByRole('button', { name: 'Pause preview' }).click();
  await page.getByRole('tab', { name: 'Experimental Settings', exact: true }).click();
  await page.getByLabel('Color mapping', { exact: true }).selectOption('ramp');
  await page.screenshot({ path: output.replace(/\.png$/i, '') + '-controls.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByLabel('Color mapping', { exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: output.replace(/\.png$/i, '') + '-mobile.png' });
  console.log(`Palette comparison saved to ${output}`);
} finally { await browser?.close(); server.kill(); }
