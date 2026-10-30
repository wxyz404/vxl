import { test, expect, type Page } from '@playwright/test';

// The supplied 24 × 1 Verdant Valley PNG, kept inline so this regression is portable.
const verdantValley = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAABgAAAABCAYAAADErm6rAAAAbElEQVR4AQFhAJ7/AWodOf80F+cAHzkQAB5IHACkm9sA2+gJALbc5wAjGxcAHhgRADgwKgBtZFsA6cMlAOq6lQCz4P0AyOHHAAgNMAD1Iz8ASiIyAOZW3gC10aIAaSnrAOLC0gCw5gcA/+MYADo3I6ZAT135AAAAAElFTkSuQmCC', 'base64');
const expectedColors = ['#6a1d39', '#9e3420', '#bd6d30', '#dbb54c', '#7f5027', '#5a3830', '#101417', '#332f2e', '#51473f', '#897769', '#f6dbc4', '#df9ee9', '#c9587e', '#7c387b', '#441942', '#4c2672', '#4149b1', '#8b6be3', '#71c1c1', '#269263', '#8fbb4e', '#717d20', '#216327', '#20463f'];
const swatches = (page: Page) => page.locator('.swatch input');
const readSwatches = (page: Page) => swatches(page).evaluateAll(inputs => inputs.map(input => (input as HTMLInputElement).value));

async function makePng(page: Page, width: number, pixels: number[]) {
  const base64 = await page.evaluate(({ width, pixels }) => {
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = pixels.length / 4 / width;
    canvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(pixels), canvas.width, canvas.height), 0, 0);
    return canvas.toDataURL('image/png').split(',')[1];
  }, { width, pixels });
  return Buffer.from(base64, 'base64');
}

test('imports the supplied PNG, renders its colors, exports JSON, and remembers it', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Snapshot', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Pause preview' }).click();
  const input = page.getByLabel('Import palette file', { exact: true });
  await expect(input).toHaveAttribute('accept', /image\/png/);
  await input.setInputFiles({ name: 'verdant-valley-1x.PNG', mimeType: '', buffer: verdantValley });
  await expect(page.getByText('Palette imported.', { exact: true })).toBeVisible();
  await expect.poll(() => readSwatches(page)).toEqual(expectedColors);
  await expect(page.getByLabel('Color palette', { exact: true })).toHaveValue('custom');
  await expect.poll(() => page.getByTestId('output-canvas').evaluate((canvas, palette) => {
    const c = canvas as HTMLCanvasElement, gl = c.getContext('webgl2')!;
    const pixels = new Uint8Array(c.width * c.height * 4);
    gl.readPixels(0, 0, c.width, c.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    const allowed = new Set(palette);
    for (let i = 0; i < pixels.length; i += 4) {
      const color = `#${[pixels[i], pixels[i + 1], pixels[i + 2]].map(v => v.toString(16).padStart(2, '0')).join('')}`;
      if (!allowed.has(color)) return false;
    }
    return true;
  }, expectedColors)).toBe(true);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export palette', exact: true }).click();
  const stream = await (await download).createReadStream();
  const chunks = []; for await (const chunk of stream!) chunks.push(chunk);
  expect(JSON.parse(Buffer.concat(chunks).toString())).toEqual(expectedColors);
  await page.reload();
  await expect.poll(() => readSwatches(page)).toEqual(expectedColors);
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('imports a PNG grid into the selected region, ignoring transparency and repeated swatches', async ({ page }) => {
  await page.goto('/');
  const original = await readSwatches(page);
  await page.getByRole('tab', { name: 'Background', exact: true }).click();
  const png = await makePng(page, 3, [
    17, 34, 51, 255, 17, 34, 51, 255, 0, 0, 0, 0,
    171, 205, 239, 255, 171, 205, 239, 255, 0, 0, 0, 0,
  ]);
  await page.getByLabel('Import palette file', { exact: true }).setInputFiles({ name: 'grid.png', mimeType: 'image/png', buffer: png });
  await expect.poll(() => readSwatches(page)).toEqual(['#112233', '#abcdef']);
  await page.getByRole('tab', { name: 'Whole frame', exact: true }).click();
  expect(await readSwatches(page)).toEqual(original);
});

test('rejects invalid PNGs without changing the palette and allows a subsequent import', async ({ page }) => {
  await page.goto('/');
  const original = await readSwatches(page);
  const input = page.getByLabel('Import palette file', { exact: true });
  const tooLarge = Buffer.from(verdantValley); tooLarge.writeUInt32BE(4_194_305, 16);
  const cases: [Buffer, string][] = [
    [Buffer.from('broken png'), 'not a valid PNG'],
    [verdantValley.subarray(0, 24), 'could not be read'],
    [tooLarge, 'pixels'],
    [Buffer.alloc(4 * 1024 * 1024 + 1), '4 MB'],
    [await makePng(page, 1, [0, 0, 0, 255]), 'at least 2 distinct colors'],
    [await makePng(page, 33, Array.from({ length: 33 }, (_, i) => [i, 0, 0, 255]).flat()), 'more than 32 colors'],
  ];
  for (const [buffer, error] of cases) {
    await input.setInputFiles({ name: 'palette.png', mimeType: 'image/png', buffer });
    await expect(page.getByRole('alert')).toContainText(error);
    expect(await readSwatches(page)).toEqual(original);
  }
  await input.setInputFiles({ name: 'palette.png', mimeType: 'image/png', buffer: verdantValley });
  await expect.poll(() => readSwatches(page)).toEqual(expectedColors);
  await expect(page.getByRole('alert')).toHaveCount(0);
});
