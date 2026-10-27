import { PixelRenderer } from '../../src/render/renderer';
import { copyPreset, PRESETS } from '../../src/core/presets';

/** Three identical textured surfaces at different authored distances. */
export async function depthFixture() {
  const w = 96, h = 64, source = new OffscreenCanvas(w, h), context = source.getContext('2d')!;
  context.fillStyle = '#365c56'; context.fillRect(0, 0, w, h);
  for (let x = 0; x < w; x += 2) { context.fillStyle = '#386860'; context.fillRect(x, 0, 1, h); }
  const canvas = document.createElement('canvas'), renderer = new PixelRenderer(canvas);
  const image = await createImageBitmap(source), preset = copyPreset(PRESETS[0]);
  Object.assign(preset.foreground, { outline: 'off', dither: 0, texture: 'off', simplify: 0, clusters: 0, internalEdges: 0, contrast: 1, saturation: 1 });
  const values = Float32Array.from({ length: w * h }, (_, i) => Math.floor((i % w) / 32) * 0.5);
  const frame = { image, timestamp: 100, generation: 1, depth: { values, width: w, height: h, timestamp: 100, generation: 1, strength: 1 } };
  const read = () => {
    const small = new OffscreenCanvas(w, h), c = small.getContext('2d')!;
    c.drawImage(canvas, 0, 0, w, h); return Array.from(c.getImageData(0, 0, w, h).data);
  };
  const render = () => { renderer.resetHistory(); renderer.render(frame, preset); return read(); };
  const baseline = render();
  preset.depth.enabled = true; preset.depth.haze = 0.8; preset.depth.desaturation = 0.5; preset.depth.contrast = 0.4; preset.depth.detail = 0.8;
  const styled = render();
  frame.depth.strength = 0; const fadedOut = render(); frame.depth.strength = 1;
  const palette = preset.foreground.palette.map(hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)).join(','));
  const paletteOnly = styled.every((_, i) => i % 4 !== 0 || palette.includes(styled.slice(i, i + 3).join(',')));
  preset.depth.preview = 'planes'; const planes = render();
  preset.depth.preview = 'depth';
  for (let y = 0; y < h; y++) values.fill(y < h / 2 ? 0 : 1, y * w, (y + 1) * w);
  const map = render();
  preset.depth.preview = 'art'; frame.depth.generation = 2; const wrongSource = render();
  frame.depth.generation = 1; frame.depth.timestamp = -1001; const stale = render();
  frame.depth.timestamp = 100; preset.depth.enabled = false; const disabled = render();
  const glError = canvas.getContext('webgl2')!.getError(); image.close(); renderer.dispose();
  return { baseline, styled, fadedOut, paletteOnly, planes, map, stale, wrongSource, disabled, glError, w, h };
}
