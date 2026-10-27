import { z } from 'zod';

export const PALETTES = {
  studio: { name: 'Studio 32', colors: ['#11131c','#242336','#363344','#514251','#70505b','#94606a','#bd7a78','#e5a18c','#ffd3ac','#fff1d1','#e0d8b0','#b8ba8b','#83996c','#557c62','#365c56','#244047','#1b2c3c','#29445b','#386280','#518ca2','#83b6b5','#b9d7cb','#f4f3df','#c3c1c8','#8d8f9f','#636679','#454b63','#544a71','#7e6391','#a782ab','#d2a4c0','#f4cad0'] },
  grove: { name: 'Grove 16', colors: ['#172b29','#24413a','#365d43','#598452','#88ac69','#bed18b','#e8e8ac','#f8f1d4','#d9b894','#b78873','#8b625b','#624953','#483d50','#656477','#92949b','#c4c7bd'] },
  ember: { name: 'Ember 16', colors: ['#211c2b','#392838','#573746','#7e454e','#a85d58','#d67f64','#edae82','#f8d7a3','#fff0cd','#b5c7a3','#7e9c8c','#4d787e','#365566','#2c3e55','#6b6682','#aaa0ad'] },
  mono: { name: 'Pocket 4', colors: ['#183b2b','#42744a','#8eb55c','#dce6a4'] },
} as const;

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use six-digit hex colors, such as #c1ef70.');
export const paletteSchema = z.array(hex).min(2).max(32);
export const styleSchema = z.object({
  palette: paletteSchema,
  simplify: z.number().min(0).max(1),
  clusters: z.number().min(0).max(1),
  outline: z.enum(['off', 'dark', 'colored', 'selective']),
  outlineWidth: z.number().int().min(1).max(2),
  internalEdges: z.number().min(0).max(1),
  antialias: z.boolean(),
  dither: z.number().min(0).max(1),
  texture: z.enum(['off', 'stipple', 'hatch']),
  textureStrength: z.number().min(0).max(1),
  contrast: z.number().min(0.5).max(1.8),
  saturation: z.number().min(0).max(1.5),
});
export const depthSchema = z.object({
  enabled: z.boolean().default(false),
  atmosphere: hex.default('#b9cbd5'),
  haze: z.number().min(0).max(1).default(0.12),
  desaturation: z.number().min(0).max(1).default(0.14),
  contrast: z.number().min(0).max(1).default(0.10),
  detail: z.number().min(0).max(1).default(0.45),
  focus: z.number().min(0).max(0.8).default(0.2),
  preview: z.enum(['art', 'depth', 'planes']).default('art'),
});
export const DEFAULT_DEPTH = depthSchema.parse({});
export type DepthSettings = z.infer<typeof depthSchema>;

export const presetSchema = z.object({
  version: z.literal(1),
  name: z.string().trim().min(1).max(60),
  resolution: z.union([z.literal(160), z.literal(240), z.literal(320), z.literal(480)]),
  segmentation: z.boolean(),
  stability: z.number().min(0).max(1),
  outlineStability: z.number().min(0).max(1).default(0.65),
  contourSmoothing: z.number().min(0).max(1).default(0.55),
  lightAngle: z.number().min(0).max(360),
  foreground: styleSchema,
  background: styleSchema,
  depth: depthSchema.default({}),
});

export type RegionStyle = z.infer<typeof styleSchema>;
export type Preset = z.infer<typeof presetSchema>;
export type Region = 'foreground' | 'background';
export type Outline = RegionStyle['outline'];

function style(colors: readonly string[], overrides: Partial<RegionStyle> = {}): RegionStyle {
  return { palette: [...colors], simplify: 0.35, clusters: 0.35, outline: 'selective', outlineWidth: 1,
    internalEdges: 0.18, antialias: false, dither: 0.12, texture: 'off', textureStrength: 0.15,
    contrast: 1.05, saturation: 1, ...overrides };
}

export const PRESETS: Preset[] = [
  { version: 1, name: 'Pixel Video', resolution: 320, segmentation: false, stability: 0.55, outlineStability: 0.65, contourSmoothing: 0.55, lightAngle: 315,
    foreground: style(PALETTES.studio.colors), background: style(PALETTES.studio.colors, { simplify: 0.5, clusters: 0.5, internalEdges: 0.08, dither: 0.08 }), depth: { ...DEFAULT_DEPTH } },
  { version: 1, name: 'Sprite Scene', resolution: 160, segmentation: false, stability: 0.65, outlineStability: 0.75, contourSmoothing: 0.65, lightAngle: 315,
    foreground: style(PALETTES.grove.colors, { simplify: 0.6, clusters: 0.65, dither: 0.22, contrast: 1.12 }),
    background: style(PALETTES.grove.colors, { simplify: 0.75, clusters: 0.8, dither: 0.16, internalEdges: 0.04, outline: 'colored' }), depth: { ...DEFAULT_DEPTH } },
];

export function copyPreset(preset: Preset): Preset { return structuredClone(preset); }
export function parsePreset(text: string): Preset { return presetSchema.parse(JSON.parse(text)); }
export function parsePalette(text: string): string[] {
  const value: unknown = JSON.parse(text);
  return paletteSchema.parse(Array.isArray(value) ? value : (value as { colors?: unknown })?.colors);
}
export function logicalSize(width: number, height: number, longest: number): [number, number] {
  const ratio = Math.min(longest / Math.max(width, height), 1);
  return [Math.max(1, Math.round(width * ratio)), Math.max(1, Math.round(height * ratio))];
}
export function hexRgb(color: string): [number, number, number] {
  return [parseInt(color.slice(1, 3), 16) / 255, parseInt(color.slice(3, 5), 16) / 255, parseInt(color.slice(5, 7), 16) / 255];
}

export function loadSavedPreset(): Preset {
  try { const saved = localStorage.getItem('vxl.preset.v1'); if (saved) return parsePreset(saved); } catch { /* A private browser or invalid previous preset should not block startup. */ }
  return copyPreset(PRESETS[0]);
}
