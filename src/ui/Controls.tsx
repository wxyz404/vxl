import { ChevronDown, Download, Upload, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { PALETTES, type Preset, type Region, type RegionStyle, type DepthSettings } from '../core/presets';
import type { DepthStatus } from '../core/types';

export function Toggle({ checked, onChange, label, disabled = false }: { checked: boolean; onChange: (value: boolean) => void; label: string; disabled?: boolean }) {
  return <button type="button" role="switch" aria-label={label} aria-checked={checked} disabled={disabled} className={`toggle ${checked ? 'on' : ''}`} onClick={() => onChange(!checked)}><span /></button>;
}
export function Slider({ label, value, onChange, min = 0, max = 1, step = 0.01, display }: { label: string; value: number; onChange: (value: number) => void; min?: number; max?: number; step?: number; display?: string }) {
  return <label className="slider"><span className="control-label">{label}<output>{display ?? `${Math.round(value * 100)}%`}</output></span><input aria-label={label} type="range" min={min} max={max} step={step} value={value} onChange={event => onChange(Number(event.target.value))} style={{ '--fill': `${(value - min) / (max - min) * 100}%` } as React.CSSProperties} /></label>;
}

interface Props {
  preset: Preset; region: Region; onRegion(region: Region): void; onChange(preset: Preset): void;
  onPaletteImport(): void; onPaletteExport(): void; onReset(): void;
  depthStatus?: DepthStatus; depthMessage?: string; onDepthRetry?(): void;
}
export function Controls({ preset, region, onRegion, onChange, onPaletteImport, onPaletteExport, onReset, depthStatus = 'off', depthMessage, onDepthRetry }: Props) {
  const [tab, setTab] = useState('art');
  const style = preset[region];
  function update<K extends keyof RegionStyle>(key: K, value: RegionStyle[K]) { onChange({ ...preset, [region]: { ...style, [key]: value } }); }
  const knownPalette = Object.entries(PALETTES).find(([, p]) => JSON.stringify(p.colors) === JSON.stringify(style.palette))?.[0] ?? 'custom';
  return <aside className="inspector">
    <div className="panel-heading"><div><span className="eyebrow">THE LOOK</span><h2>Fine-tune</h2></div><button className="icon-button" title="Reset this preset" aria-label="Reset this preset" onClick={onReset}><RotateCcw size={15} /></button></div>
    <div className="settings-tabs" role="tablist" aria-label="Settings" onKeyDown={event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault(); const next = event.key === 'Home' ? 'art' : event.key === 'End' ? 'experimental' : tab === 'art' ? 'experimental' : 'art';
      setTab(next); document.getElementById(`settings-tab-${next}`)?.focus();
    }}>
      {(['art', 'experimental'] as const).map(value => <button key={value} id={`settings-tab-${value}`} role="tab" aria-selected={tab === value} aria-controls={`settings-panel-${value}`} tabIndex={tab === value ? 0 : -1} onClick={() => setTab(value)}>{value === 'art' ? 'Art Settings' : 'Experimental Settings'}</button>)}
    </div>
    <div id="settings-panel-experimental" role="tabpanel" aria-labelledby="settings-tab-experimental" className="settings-panel" hidden={tab !== 'experimental'}>
      <section className="control-section depth-controls">
        <div className="section-heading"><h3>Depth-aware art</h3><span>EXPERIMENT</span></div>
        <div className="inline-control"><span>Enable depth styling</span><Toggle label="Depth-aware styling" checked={preset.depth.enabled} onChange={enabled => onChange({ ...preset, depth: { ...preset.depth, enabled } })} /></div>
        <p className="field-note">Let distant surfaces recede through color, quieter texture, and broader clusters. Relative depth is estimated across the whole scene.</p>
        <p className="depth-status" role="status">{!preset.depth.enabled ? 'Off · no depth model running' : {
          off: 'Starting depth…', loading: 'Downloading depth model…', estimating: 'Estimating scene depth…', ready: 'Estimated depth active',
          holding: 'Refreshing depth · keeping the last estimate', demo: 'Authored demo depth · not AI detection', stale: 'Waiting for a fresh depth estimate…', error: 'Depth model stopped · fading to normal styling',
        }[depthStatus]}</p>
        {preset.depth.enabled && depthStatus === 'error' && <><p className="field-note">{depthMessage}</p><button className="secondary-button" onClick={onDepthRetry}>Retry depth model</button></>}
        <fieldset disabled={!preset.depth.enabled} className="depth-fields">
          <label className="inline-control">Atmosphere color<input type="color" aria-label="Atmosphere color" value={preset.depth.atmosphere} onChange={e => onChange({ ...preset, depth: { ...preset.depth, atmosphere: e.target.value } })} /></label>
          <p className="field-note">Try blue-gray daylight, warm sunset, or a dark mist. Colors stay within your palette.</p>
          {([['haze', 'Atmosphere blend'], ['desaturation', 'Distant desaturation'], ['contrast', 'Distant contrast reduction'], ['detail', 'Distant simplification'], ['focus', 'Protected near range']] as const).map(([key, label]) => <Slider key={key} label={label} max={key === 'focus' ? 0.8 : 1} value={preset.depth[key]} onChange={value => onChange({ ...preset, depth: { ...preset.depth, [key]: value } })} />)}
          <label className="control-label" htmlFor="depth-preview">Preview</label>
          <div className="select-wrap"><select id="depth-preview" aria-label="Depth preview" value={preset.depth.preview} onChange={e => onChange({ ...preset, depth: { ...preset.depth, preview: e.target.value as DepthSettings['preview'] } })}><option value="art">Styled art</option><option value="depth">Relative depth map</option><option value="planes">Foreground / middle / background</option></select><ChevronDown size={14} /></div>
          <p className="field-note">Depth map: dark = near, light = far. Planes: teal = foreground, gold = middle ground, blue = background. Previews also appear in exports.</p>
        </fieldset>
        <p className="field-note">Camera and video input download a depth model on first use (about 30 MB). Frames are processed on your device. Live styling retains the last good estimate and blends updates. If estimates stop, the effect fades out. Glass, mirrors, and fine edges can still be misread. Depth is relative, never meters.</p>
      </section>
    </div>
    <div id="settings-panel-art" role="tabpanel" aria-labelledby="settings-tab-art" className="settings-panel" hidden={tab !== 'art'}>
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
      <Slider label="Contour smoothing" value={preset.contourSmoothing} onChange={v => onChange({ ...preset, contourSmoothing: v })} />
      <Slider label="Outline stability" value={preset.outlineStability} onChange={v => onChange({ ...preset, outlineStability: v })} />
      <p className="field-note">Smooths contours and interior edges; steadies lines as they move. Silhouette thickness stays on one side.</p>
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
    </div>
  </aside>;
}
