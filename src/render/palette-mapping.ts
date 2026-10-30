import { hexRgb, type RegionStyle } from '../core/presets';
import { rgbToOklab } from './color';

export type Color = [number, number, number];
export const ANCHORS = 5;
const clamp = (v: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
const distance = (a: Color, b: Color) => a.reduce((sum, v, i) => sum + (v - b[i]) ** 2, 0);

/** Representative swatches ordered by lightness, independent of import order. */
export function paletteRamp(palette: readonly string[], authored: readonly string[] = []): string[] {
  if (authored.length === ANCHORS && authored.every(color => palette.some(p => p.toLowerCase() === color.toLowerCase()))) {
    return authored.map(color => palette.find(p => p.toLowerCase() === color.toLowerCase())!);
  }
  const sorted = [...palette].sort((a, b) => rgbToOklab(hexRgb(a))[0] - rgbToOklab(hexRgb(b))[0] || a.localeCompare(b));
  return Array.from({ length: ANCHORS }, (_, i) => sorted[Math.round(i * (sorted.length - 1) / (ANCHORS - 1))]);
}

export function adjustedLab(rgb: Color, contrast: number, saturation: number): Color {
  const c = rgb.map(v => clamp((v - 0.5) * contrast + 0.5));
  const l = c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;
  return rgbToOklab(c.map(v => clamp(l + (v - l) * saturation)));
}

export function colorStatistics(colors: readonly Color[]): { mean: Color; spread: Color } {
  if (!colors.length) return { mean: [0.5, 0, 0], spread: [0, 0, 0] };
  const mean = [0, 0, 0] as Color, spread = [0, 0, 0] as Color;
  for (const c of colors) for (let j = 0; j < 3; j++) mean[j] += c[j] / colors.length;
  for (const c of colors) for (let j = 0; j < 3; j++) spread[j] += (c[j] - mean[j]) ** 2 / colors.length;
  return { mean, spread: spread.map(Math.sqrt) as Color };
}

/** Small deterministic k-means. Farthest-point seeds preserve minority color families. */
export function sourceAnchors(colors: readonly Color[], count = ANCHORS): Color[] {
  if (!colors.length || count < 1) return [];
  const sorted = [...colors].sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
  const centers: Color[] = [[...sorted[0]]];
  while (centers.length < count) {
    let farthest = sorted[0], best = 0;
    for (const c of sorted) {
      const d = Math.min(...centers.map(center => distance(c, center)));
      if (d > best) { best = d; farthest = c; }
    }
    if (best < 1e-8) break;
    centers.push([...farthest]);
  }
  for (let pass = 0; pass < 8; pass++) {
    const sums = centers.map(() => [0, 0, 0] as Color), counts = centers.map(() => 0);
    for (const c of sorted) {
      let closest = 0;
      for (let j = 1; j < centers.length; j++) if (distance(c, centers[j]) < distance(c, centers[closest])) closest = j;
      counts[closest]++;
      for (let j = 0; j < 3; j++) sums[closest][j] += c[j];
    }
    for (let i = 0; i < centers.length; i++) if (counts[i]) centers[i] = sums[i].map(v => v / counts[i]) as Color;
  }
  return centers.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
}

export function mappingParameters(samples: readonly Color[], style: RegionStyle) {
  const colors = samples.map(c => adjustedLab(c, style.contrast, style.saturation));
  const palette = style.palette.map(c => rgbToOklab(hexRgb(c)));
  const sorted = [...palette].sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
  const source = sourceAnchors(colors, Math.min(ANCHORS, palette.length));
  const target = source.map((_, i) => sorted[Math.round((source.length === 1 ? 0.5 : i / (source.length - 1)) * (sorted.length - 1))]);
  // Spread the useful tonal range across the ramp. Keep a minimum span so a flat
  // frame or small lighting noise cannot be stretched into black/white flashing.
  const tones = colors.map(c => c[0]).sort((a, b) => a - b);
  const low = tones[Math.floor((tones.length - 1) * 0.02)] ?? 0;
  const high = tones[Math.ceil((tones.length - 1) * 0.98)] ?? 1;
  const center = (low + high) / 2, span = Math.max(0.15, high - low);
  return { source, target, sourceStats: colorStatistics(colors), targetStats: colorStatistics(palette),
    range: [center - span / 2, center + span / 2],
    ramp: paletteRamp(style.palette, style.colorMapping.ramp).map(c => rgbToOklab(hexRgb(c))) };
}

/** Stratified thumbnail samples with confident region ownership; never mix person/background statistics. */
export function regionSamples(pixels: Uint8ClampedArray, width: number, height: number,
  mask?: Float32Array, maskWidth = 0, maskHeight = 0): [Color[], Color[]] {
  const result: [Color[], Color[]] = [[], []];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const offset = (y * width + x) * 4;
    if (pixels[offset + 3] < 128) continue;
    const m = mask && maskWidth && maskHeight ? mask[Math.min(maskHeight - 1, Math.floor((y + 0.5) / height * maskHeight)) * maskWidth + Math.min(maskWidth - 1, Math.floor((x + 0.5) / width * maskWidth))] : 1;
    if (!Number.isFinite(m) || (m > 0.25 && m < 0.75)) continue;
    result[m >= 0.75 ? 0 : 1].push([pixels[offset] / 255, pixels[offset + 1] / 255, pixels[offset + 2] / 255]);
  }
  return result;
}
