import { PixelRenderer } from '../../src/render/renderer';
import { copyPreset, PRESETS, type ColorMappingSettings } from '../../src/core/presets';

export async function paletteMappingFixture() {
  const w = 96, h = 64, source = new OffscreenCanvas(w, h), context = source.getContext('2d')!;
  const gradient = context.createLinearGradient(0, 0, w, 0); gradient.addColorStop(0, '#181818'); gradient.addColorStop(1, '#eeeeee');
  context.fillStyle = gradient; context.fillRect(0, 0, w, h);
  ['#5e794d', '#4e7392', '#a76d5b'].forEach((color, i) => { context.fillStyle = color; context.fillRect(i * 32, 32, 32, 32); });
  const canvas = document.createElement('canvas'), renderer = new PixelRenderer(canvas), preset = copyPreset(PRESETS[0]);
  const palette = ['#291b37', '#59314c', '#94545c', '#cd8164', '#f8d7a3'];
  Object.assign(preset.foreground, { palette, outline: 'off', dither: 0, texture: 'off', simplify: 0, clusters: 0, internalEdges: 0, contrast: 1, saturation: 1 });
  preset.stability = 0; preset.outlineStability = 0;
  const frame = { image: await createImageBitmap(source), timestamp: 100, generation: 1 };
  const small = new OffscreenCanvas(w, h), readContext = small.getContext('2d')!;
  function render(mode: ColorMappingSettings['mode'], strength = 1) {
    preset.foreground.colorMapping = { ...preset.foreground.colorMapping, mode, strength };
    renderer.resetHistory(); renderer.render(frame, preset);
    readContext.drawImage(canvas, 0, 0, w, h);
    return Array.from(readContext.getImageData(0, 0, w, h).data);
  }
  const baseline = render('nearest'), outputs: Record<string, number[]> = {}, zero: Record<string, boolean> = {};
  const paletteOnly = (data: number[], colors = palette) => {
    const allowed = new Set(colors.map(c => [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16)).join(',')));
    return data.every((_, i) => i % 4 !== 0 || allowed.has(data.slice(i, i + 3).join(',')));
  };
  for (const mode of ['mood', 'correspondence', 'ramp'] as const) {
    outputs[mode] = render(mode); zero[mode] = JSON.stringify(render(mode, 0)) === JSON.stringify(baseline);
  }
  // An authored single-color ramp must recolor all source hues identically.
  preset.foreground.colorMapping.ramp = Array(5).fill(palette[3]);
  const authored = render('ramp'); preset.foreground.colorMapping.ramp = [];
  // A static patch must not pump when the surrounding frame changes.
  context.fillStyle = '#777777'; context.fillRect(32, 0, 32, 32);
  frame.image.close(); frame.image = await createImageBitmap(source); frame.generation++;
  const first = render('mood');
  context.fillStyle = '#111111'; context.fillRect(0, 32, w, 32);
  frame.image.close(); frame.image = await createImageBitmap(source); frame.timestamp += 33;
  const held = render('mood'); renderer.refreshColorReference(); const refreshed = render('mood');
  frame.generation++; const newSource = render('mood');
  // Texture, outlines and authored depth must still finish on the exact palette.
  Object.assign(preset.foreground, { outline: 'colored', antialias: true, dither: 0.5, texture: 'hatch', textureStrength: 0.5, clusters: 0.4 });
  preset.depth.enabled = true;
  const depth = { values: Float32Array.from({ length: w * h }, (_, i) => (i % w) / (w - 1)), width: w, height: h, timestamp: frame.timestamp, generation: frame.generation };
  const decorated: boolean[] = [];
  function decoratedRead() {
    renderer.resetHistory(); renderer.render({ ...frame, depth }, preset);
    readContext.drawImage(canvas, 0, 0, w, h); return Array.from(readContext.getImageData(0, 0, w, h).data);
  }
  preset.foreground.colorMapping.mode = 'nearest'; const decoratedBaseline = decoratedRead(), decoratedZero: boolean[] = [];
  for (const mode of ['mood', 'correspondence', 'ramp'] as const) {
    preset.foreground.colorMapping.mode = mode; preset.foreground.colorMapping.strength = 1;
    decorated.push(paletteOnly(decoratedRead()));
    preset.foreground.colorMapping.strength = 0;
    decoratedZero.push(JSON.stringify(decoratedRead()) === JSON.stringify(decoratedBaseline));
  }
  const glError = canvas.getContext('webgl2')!.getError(); frame.image.close(); renderer.dispose();
  const pixel = (data: number[]) => data.slice((16 * w + 48) * 4, (16 * w + 48) * 4 + 3);
  return { baseline, outputs, zero, paletteOnly: Object.values(outputs).every(data => paletteOnly(data)), decorated, decoratedZero, glError,
    authoredOnly: authored.every((_, i) => i % 4 !== 0 || authored.slice(i, i + 3).join(',') === '205,129,100'),
    held: pixel(first).join() === pixel(held).join(), refreshChanged: pixel(held).join() !== pixel(refreshed).join(),
    newSource: JSON.stringify(newSource) === JSON.stringify(refreshed), w, h };
}

export async function paletteRegionFixture() {
  const w = 64, h = 32, source = new OffscreenCanvas(w, h), c = source.getContext('2d')!;
  const gradient = c.createLinearGradient(0, 0, 0, h); gradient.addColorStop(0, '#222222'); gradient.addColorStop(1, '#dddddd');
  c.fillStyle = gradient; c.fillRect(0, 0, w, h);
  const preset = copyPreset(PRESETS[0]); preset.segmentation = true; preset.stability = 0; preset.outlineStability = 0;
  for (const style of [preset.foreground, preset.background]) Object.assign(style, { outline: 'off', antialias: false, dither: 0, texture: 'off', clusters: 0, contrast: 1, saturation: 1 });
  preset.foreground.palette = ['#301b3b', '#a5545a', '#ffe0a6']; preset.background.palette = ['#183b2b', '#42744a', '#dce6a4'];
  const image = await createImageBitmap(source), mask = Float32Array.from({ length: w * h }, (_, i) => i % w < w / 2 ? 1 : 0);
  const canvas = document.createElement('canvas'), renderer = new PixelRenderer(canvas), small = new OffscreenCanvas(w, h), ctx = small.getContext('2d')!;
  const read = () => { renderer.resetHistory(); renderer.render({ image, mask, maskWidth: w, maskHeight: h, timestamp: 100, generation: 1 }, preset); ctx.drawImage(canvas, 0, 0, w, h); return Array.from(ctx.getImageData(0, 0, w, h).data); };
  const baseline = read(), results = [];
  for (const mode of ['mood', 'correspondence', 'ramp'] as const) {
    preset.foreground.colorMapping.mode = mode; const output = read();
    results.push({ mode, backgroundUnchanged: output.every((v, i) => Math.floor(i / 4) % w < w / 2 || v === baseline[i]),
      paletteOnly: output.every((_, i) => {
        if (i % 4) return true;
        const colors = Math.floor(i / 4) % w < w / 2 ? preset.foreground.palette : preset.background.palette;
        return colors.some(color => [1, 3, 5].map(j => parseInt(color.slice(j, j + 2), 16)).join(',') === output.slice(i, i + 3).join(','));
      }) });
  }
  const glError = canvas.getContext('webgl2')!.getError(); image.close(); renderer.dispose(); return { results, glError };
}
