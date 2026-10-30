import { test, expect } from '@playwright/test';
import { PRESETS } from '../../src/core/presets';

test('experimental palette modes change pixels, preserve palette colors, and keep a stable reference', async ({ page }) => {
  test.skip(process.env.VXL_TEST_PREVIEW === '1', 'Analytic fixtures import source modules.');
  await page.route('**/__mapping-fixture', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Palette mapping fixture</title>' }));
  await page.goto('/__mapping-fixture');
  const result = await page.evaluate(async () => {
    const path = '/tests/helpers/palette-mapping.ts'; return (await import(/* @vite-ignore */ path)).paletteMappingFixture();
  });
  expect(result.glError).toBe(0); expect(result.paletteOnly).toBe(true); expect(result.decorated).toEqual([true, true, true]);
  expect(result.decoratedZero).toEqual([true, true, true]);
  expect(result.zero).toEqual({ mood: true, correspondence: true, ramp: true }); expect(result.authoredOnly).toBe(true);
  for (const output of Object.values(result.outputs)) expect(output).not.toEqual(result.baseline);
  expect(result.outputs.mood).not.toEqual(result.outputs.correspondence);
  expect(result.held).toBe(true); expect(result.refreshChanged).toBe(true); expect(result.newSource).toBe(true);
});

test('each mode respects person/background palettes and isolates the unchanged region', async ({ page }) => {
  test.skip(process.env.VXL_TEST_PREVIEW === '1', 'Analytic fixtures import source modules.');
  await page.route('**/__mapping-regions', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Palette regions</title>' }));
  await page.goto('/__mapping-regions');
  const result = await page.evaluate(async () => {
    const path = '/tests/helpers/palette-mapping.ts'; return (await import(/* @vite-ignore */ path)).paletteRegionFixture();
  });
  expect(result.glError).toBe(0);
  for (const mode of result.results) { expect(mode.backgroundUnchanged).toBe(true); expect(mode.paletteOnly).toBe(true); }
});

test('palette controls preserve preset defaults, redraw paused art, refresh, persist, and reset', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/'); await expect(page.getByRole('button', { name: 'Snapshot', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Pause preview' }).click();
  await page.getByRole('tab', { name: 'Experimental Settings', exact: true }).click();
  const mode = page.getByLabel('Color mapping', { exact: true }); await expect(mode).toHaveValue(PRESETS[0].foreground.colorMapping.mode);
  await mode.selectOption('nearest');
  await expect(page.getByLabel('Color transfer strength', { exact: true })).toBeDisabled();
  const canvas = page.getByTestId('output-canvas'), baseline = await canvas.evaluate(c => (c as HTMLCanvasElement).toDataURL());
  for (const value of ['mood', 'correspondence', 'ramp']) {
    await mode.selectOption(value);
    await expect.poll(() => canvas.evaluate(c => (c as HTMLCanvasElement).toDataURL())).not.toBe(baseline);
    if (value !== 'ramp') await page.getByRole('button', { name: 'Refresh source colors', exact: true }).click();
  }
  await expect(page.getByLabel('Ramp shadows', { exact: true })).toBeVisible();
  const authoredShadow=PRESETS[0].foreground.palette[2];
  await page.getByLabel('Ramp shadows', { exact: true }).selectOption(authoredShadow);
  await page.getByRole('tab', { name: 'Background', exact: true }).click(); await expect(mode).toHaveValue('nearest');
  await page.getByRole('tab', { name: 'Whole frame', exact: true }).click(); await expect(mode).toHaveValue('ramp');
  await page.reload(); await expect(page.getByRole('button', { name: 'Snapshot', exact: true })).toBeEnabled();
  await page.getByRole('tab', { name: 'Experimental Settings', exact: true }).click();
  await expect(mode).toHaveValue('ramp'); await expect(page.getByLabel('Ramp shadows', { exact: true })).toHaveValue(authoredShadow);
  await page.getByRole('button', { name: 'Reset this preset', exact: true }).click(); await expect(mode).toHaveValue(PRESETS[0].foreground.colorMapping.mode);
  await expect(page.getByRole('alert')).toHaveCount(0); expect(errors).toEqual([]);
});
