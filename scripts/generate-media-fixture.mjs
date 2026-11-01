// Authored moving blocks, encoded once for deterministic decoder/timeline tests.
import { spawn } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
process.env.PLAYWRIGHT_BROWSERS_PATH ??= resolve('.cache/playwright');
const { chromium } = await import('@playwright/test');
const cache = process.env.PLAYWRIGHT_BROWSERS_PATH;
const folder = (await readdir(cache)).find(name => name.startsWith('ffmpeg-'));
if (!folder) throw new Error('Install Playwright browsers first.');
const executable = resolve(cache, folder, process.platform === 'win32' ? 'ffmpeg-win64.exe' : process.platform === 'darwin' ? 'ffmpeg-mac' : 'ffmpeg-linux');
const browser = await chromium.launch({ channel: 'chromium' });
try {
  const page = await browser.newPage();
  const frames = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width=96; canvas.height=64;
    const context=canvas.getContext('2d'), output=[];
    for(let i=0;i<12;i++) {
      context.fillStyle='#789982';context.fillRect(0,0,96,64);
      context.fillStyle='#bd795d';context.fillRect(i*4,12,24,40);
      output.push(canvas.toDataURL('image/jpeg',0.95).split(',')[1]);
    }
    return output;
  });
  const child=spawn(executable,['-hide_banner','-f','image2pipe','-vcodec','mjpeg','-framerate','30','-i','pipe:0','-c:v','libvpx-vp9','-pix_fmt','yuv420p','-y','tests/fixtures/processing.webm'],{stdio:['pipe','ignore','pipe'],windowsHide:true});
  let log='';child.stderr.on('data',data=>{log+=data;});
  const done=new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',code=>code===0?resolve():reject(new Error(log)));});
  for(const frame of frames) child.stdin.write(Buffer.from(frame,'base64'));
  child.stdin.end();await done;console.log('Generated tests/fixtures/processing.webm (12 authored frames at 30 FPS).');
} finally { await browser.close(); }
