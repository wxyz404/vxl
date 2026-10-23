import { mkdir, cp, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';

const root = resolve(import.meta.dirname, '..');
const destination = resolve(root, 'public/vision');
await mkdir(destination, { recursive: true });
await cp(resolve(root, 'node_modules/@mediapipe/tasks-vision/wasm'), resolve(destination, 'wasm'), { recursive: true });
console.log('MediaPipe runtime copied into public/vision/wasm.');
if (process.argv.includes('--runtime-only')) process.exit(0);

const filename = 'selfie_segmenter_landscape.tflite';
const modelPath = resolve(destination, filename);
const expectedSha256 = '490e9ea734313e0de10fa0cd9e3c6133e36ea4db2b7a49bde9ef019f72796b8e';
const url = 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter_landscape/float16/1/selfie_segmenter_landscape.tflite';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
let installed = false;
try {
  installed = digest(await readFile(modelPath)) === expectedSha256;
} catch { /* First setup, or a partial previous download. */ }
if (installed && !process.argv.includes('--force')) {
  console.log('Person segmentation model is installed and its SHA-256 is verified.');
} else {
  console.log('Downloading the person segmentation model from Google...');
  const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`Model download failed (${response.status}). Run pnpm models:setup again.`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < 100_000 || bytes.subarray(4, 8).toString() !== 'TFL3' || digest(bytes) !== expectedSha256) throw new Error('Model integrity check failed. The existing model was not replaced.');
  const temporary = `${modelPath}.download`;
  try {
    await writeFile(temporary, bytes);
    await rename(temporary, modelPath);
  } finally { await rm(temporary, { force: true }); }
  await writeFile(resolve(destination, 'model-info.json'), JSON.stringify({
    source: url, installed: new Date().toISOString(), sha256: digest(bytes), bytes: bytes.length,
  }, null, 2));
  console.log(`Model installed (${(bytes.length / 1024 / 1024).toFixed(1)} MB). Inference now works without network access.`);
}
