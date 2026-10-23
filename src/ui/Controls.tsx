import { ChevronDown, Download, Upload, RotateCcw } from 'lucide-react';
import { PALETTES, type Preset, type Region, type RegionStyle } from '../core/presets';

export function Toggle({ checked, onChange, label, disabled = false }: { checked: boolean; onChange: (value: boolean) => void; label: string; disabled?: boolean }) {
  return <button type="button" role="switch" aria-label={label} aria-checked={checked} disabled={disabled} className={`toggle ${checked ? 'on' : ''}`} onClick={() => onChange(!checked)}><span /></button>;
}
export function Slider({ label, value, onChange, min = 0, max = 1, step = 0.01, display }: { label: string; value: number; onChange: (value: number) => void; min?: number; max?: number; step?: number; display?: string }) {
  return <label className="slider"><span className="control-label">{label}<output>{display ?? `${Math.round(value * 100)}%`}</output></span><input aria-label={label} type="range" min={min} max={max} step={step} value={value} onChange={event => onChange(Number(event.target.value))} style={{ '--fill': `${(value - min) / (max - min) * 100}%` } as React.CSSProperties} /></label>;
}

interface Props {
  preset: Preset; region: Region; onRegion(region: Region): void; onChange(preset: Preset): void;
  onPaletteImport(): void; onPaletteExport(): void; onReset(): void;
}
export function Controls({ preset, region, onRegion, onChange, onPaletteImport, onPaletteExport, onReset }: Props) {
  const style = preset[region];
  function update<K extends keyof RegionStyle>(key: K, value: RegionStyle[K]) { onChange({ ...preset, [region]: { ...style, [key]: value } }); }
  const knownPalette = Object.entries(PALETTES).find(([, p]) => JSON.stringify(p.colors) === JSON.stringify(style.palette))?.[0] ?? 'custom';
  return <aside className="inspector">
    <div className="panel-heading"><div><span className="eyebrow">THE LOOK</span><h2>Fine-tune</h2></div><button className="icon-button" title="Reset this preset" aria-label="Reset this preset" onClick={onReset}><RotateCcw size={15} /></button></div>
    <div className="region-tabs" role="tablist" aria-label="Region to edit">
      <button role="tab" aria-selected={region === 'foreground'} className={region === 'foreground' ? 'selected' : ''} onClick={() => onRegion('foreground')}>{preset.segmentation ? 'Person' : 'Whole frame'}</button>
      <button role="tab" aria-selected={region === 'background'} className={region === 'background' ? 'selected' : ''} onClick={() => onRegion('background')}>Background</button>
    </div>
    {region === 'background' && !preset.segmentation && <p className="field-note">Enable person separation to apply these background settings.</p>}
    <section className="control-section">
      <div className="section-heading"><h3>Palette</h3><span>{style.palette.length} colors</span></div>
      <div className="select-wrap"><select aria-label="Color palette" value={knownPalette} onChange={e => { const palette = PALETTES[e.target.value as keyof typeof PALETTES]; if (palette) update('palette', [...palette.colors]); }}>
        {Object.entries(PALETTES).map(([key, p]) => <option key={key} value={key}>{p.name}</option>)}<option value="custom" disabled>Custom palette</option>
      </select><ChevronDown size={14} /></div>
      <div className="swatches">{style.palette.map((color, i) => <label key={i} className="swatch" style={{ background: color }} title={`Color ${i + 1}: ${color}`}><input type="color" aria-label={`Palette color ${i + 1}`} value={color} onChange={e => update('palette', style.palette.map((c, j) => j === i ? e.target.value : c))} /></label>)}</div>
      <div className="palette-actions"><button onClick={onPaletteImport}><Upload size={12} /> Import palette</button><button aria-label="Export palette" title="Export palette" onClick={onPaletteExport}><Download size={13} /></button></div>
    </section>
    <section className="control-section"><h3>Shape & detail</h3>
      <Slider label="Simplification" value={style.simplify} onChange={v => update('simplify', v)} />
      <Slider label="Cluster cleanup" value={style.clusters} onChange={v => update('clusters', v)} />
      <Slider label="Contrast" min={0.5} max={1.8} value={style.contrast} display={`${style.contrast.toFixed(2)}×`} onChange={v => update('contrast', v)} />
      <Slider label="Saturation" min={0} max={1.5} value={style.saturation} onChange={v => update('saturation', v)} />
    </section>
    <section className="control-section"><div className="section-heading"><h3>Outlines</h3><span>PIXEL EDGES</span></div>
      <div className="select-wrap"><select aria-label="Outline style" value={style.outline} onChange={e => update('outline', e.target.value as RegionStyle['outline'])}><option value="off">No outlines</option><option value="dark">Dark outline</option><option value="colored">Palette-colored</option><option value="selective">Selective outline</option></select><ChevronDown size={14} /></div>
      <div className="inline-control"><span>Thickness</span><div className="segmented mini">{[1, 2].map(n => <button key={n} className={style.outlineWidth === n ? 'selected' : ''} onClick={() => update('outlineWidth', n)} aria-label={`${n} pixel outline`}>{n} px</button>)}</div></div>
      <Slider label="Internal edges" value={style.internalEdges} onChange={v => update('internalEdges', v)} />
      <div className="inline-control"><span>Selective antialiasing</span><Toggle label="Selective antialiasing" checked={style.antialias} onChange={v => update('antialias', v)} /></div>
      {style.outline === 'selective' && <Slider label="Light direction" value={preset.lightAngle} min={0} max={360} step={1} display={`${preset.lightAngle}°`} onChange={v => onChange({ ...preset, lightAngle: v })} />}
    </section>
    <section className="control-section"><h3>Dither & texture</h3>
      <div className="inline-control"><span>Ordered dithering</span><Toggle label="Ordered dithering" checked={style.dither > 0} onChange={v => update('dither', v ? 0.25 : 0)} /></div>
      {style.dither > 0 && <Slider label="Dither strength" value={style.dither} onChange={v => update('dither', v)} />}
      <div className="select-wrap"><select aria-label="Texture pattern" value={style.texture} onChange={e => update('texture', e.target.value as RegionStyle['texture'])}><option value="off">No texture</option><option value="stipple">Stipple</option><option value="hatch">Diagonal hatch</option></select><ChevronDown size={14} /></div>
      {style.texture !== 'off' && <Slider label="Texture strength" value={style.textureStrength} onChange={v => update('textureStrength', v)} />}
    </section>
    <section className="control-section"><h3>Motion</h3><Slider label="Temporal stability" value={preset.stability} onChange={v => onChange({ ...preset, stability: v })} /><p className="field-note">Steadier colors and edges. Lower this for fast movement.</p></section>
  </aside>;
}
