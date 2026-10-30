import { paletteSchema, parsePalette } from './presets';

const MAX_PNG_BYTES = 4 * 1024 * 1024;
const MAX_PNG_PIXELS = 4 * 1024 * 1024;
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

/** Read swatches left to right, then top to bottom, preserving their first appearance. */
export function paletteFromPixels(pixels: Uint8ClampedArray): string[] {
  const colors = new Set<string>();
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3] === 0) continue;
    colors.add(`#${[pixels[i], pixels[i + 1], pixels[i + 2]].map(value => value.toString(16).padStart(2, '0')).join('')}`);
    if (colors.size > 32) throw new Error('This PNG contains more than 32 colors. Choose a palette image with 2–32 distinct colors.');
  }
  if (colors.size < 2) throw new Error('This PNG needs at least 2 distinct colors, excluding fully transparent pixels.');
  return paletteSchema.parse([...colors]);
}

export async function importPaletteFile(file: File): Promise<string[]> {
  if (file.type !== 'image/png' && !/\.png$/i.test(file.name)) {
    if (file.size > 64 * 1024) throw new Error('Choose a JSON file smaller than 64 KB.');
    return parsePalette(await file.text());
  }
  if (file.size > MAX_PNG_BYTES) throw new Error('Choose a PNG palette no larger than 4 MB.');
  const header = new Uint8Array(await file.slice(0, 24).arrayBuffer());
  if (header.length < 24 || !PNG_SIGNATURE.every((value, i) => header[i] === value)
    || String.fromCharCode(...header.slice(12, 16)) !== 'IHDR') {
    throw new Error('This file is not a valid PNG palette.');
  }
  const view = new DataView(header.buffer);
  const width = view.getUint32(16), height = view.getUint32(20);
  if (!width || !height || width * height > MAX_PNG_PIXELS) throw new Error('Choose a PNG palette with 1–4,194,304 pixels.');
  let bitmap: ImageBitmap;
  try { bitmap = await createImageBitmap(file); }
  catch { throw new Error('This PNG could not be read. Choose a valid PNG palette image.'); }
  try {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width; canvas.height = bitmap.height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('The browser could not read this PNG palette.');
    context.drawImage(bitmap, 0, 0);
    return paletteFromPixels(context.getImageData(0, 0, canvas.width, canvas.height).data);
  } finally { bitmap.close(); }
}
