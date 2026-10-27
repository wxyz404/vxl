import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const output = resolve(root, process.argv[2] ?? '.cache/depth-comparison.png');
const base = 'http://127.0.0.1:5182';
process.env.PLAYWRIGHT_BROWSERS_PATH ??= resolve(root, '.cache/playwright');
const { chromium } = await import('@playwright/test');
const server = spawn(process.execPath, [resolve(root, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', '5182'], { cwd: root, stdio: 'ignore', windowsHide: true });
let browser;
try {
  let available = false;
  for (let i = 0; i < 50; i++) { try { await fetch(base); available = true; break; } catch { await new Promise(r => setTimeout(r, 200)); } }
  if (!available) throw new Error('Could not start depth comparison server on port 5182.');
  browser = await chromium.launch({ channel: 'chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage();
  await page.route('**/__comparison', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Depth comparison</title>' }));
  await page.goto(`${base}/__comparison`);
  const sheet = await page.evaluate(async () => {
    const sourcePath = '/src/capture/sources.ts', rendererPath = '/src/render/renderer.ts', presetPath = '/src/core/presets.ts';
    const { DemoSource } = await import(sourcePath), { PixelRenderer } = await import(rendererPath), { copyPreset, PRESETS } = await import(presetPath);
    const source = new DemoSource(); source.motion = false; const frame = await source.capture(100, 1);
    const output = document.createElement('canvas'), renderer = new PixelRenderer(output);
    const sheet = document.createElement('canvas'); sheet.width = 1344; sheet.height = 922;
    const c = sheet.getContext('2d'); c.fillStyle = '#151b13'; c.fillRect(0, 0, sheet.width, sheet.height);
    c.fillStyle = '#d8e9c8'; c.font = 'bold 25px Arial'; c.fillText('VXL / experimental depth-aware art', 24, 36);
    c.font = '14px Arial'; c.fillStyle = '#a0b38f'; c.fillText('Original generated illustration with authored depth. This compares art treatments, not model accuracy.', 24, 62);
    for (const [i, [title, overrides]] of [
      ['Depth off / existing treatment', { enabled: false }],
      ['Depth on / subtle daylight defaults', { enabled: true }],
      ['Depth on / warm atmospheric color', { enabled: true, atmosphere: '#dfb989', haze: 0.38 }],
      ['Relative depth / dark near, light far', { enabled: true, preview: 'depth' }],
    ].entries()) {
      const preset = copyPreset(PRESETS[0]); Object.assign(preset.depth, overrides);
      renderer.resetHistory(); renderer.render(frame, preset);
      const x = 24 + (i % 2) * 672, y = 106 + Math.floor(i / 2) * 408;
      c.fillStyle = '#d8e9c8'; c.font = 'bold 16px Arial'; c.fillText(title, x, y - 12);
      c.imageSmoothingEnabled = false; c.drawImage(output, x, y, 624, 351);
    }
    frame.image.close(); renderer.dispose(); source.stop();
    return sheet.toDataURL('image/png');
  });
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, Buffer.from(sheet.split(',')[1], 'base64'));
  console.log(`Depth comparison saved to ${output}`);
} finally { await browser?.close(); server.kill(); }
