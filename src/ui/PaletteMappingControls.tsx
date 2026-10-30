import { ChevronDown } from 'lucide-react';
import type { ColorMappingSettings, RegionStyle } from '../core/presets';
import { paletteRamp } from '../render/palette-mapping';
import { Slider } from './ControlInputs';

const explanations = {
  nearest: 'Current method: choose the closest-looking palette color. No artistic color transfer.',
  mood: 'Shift the overall warmth, saturation, and tonal range toward your palette. A gentle starting point for a cohesive look.',
  correspondence: 'Match groups of source colors to palette colors from dark to light. A more expressive reinterpretation of the scene.',
  ramp: 'Paint brightness through five palette colors, from shadows to highlights. Original hues give way to your chosen color sequence.',
};
const stops = ['Shadows', 'Dark midtones', 'Midtones', 'Light midtones', 'Highlights'];

export function PaletteMappingControls({ style, onChange, onRefresh }: {
  style: RegionStyle; onChange(value: ColorMappingSettings): void; onRefresh(): void;
}) {
  const mapping = style.colorMapping, ramp = paletteRamp(style.palette, mapping.ramp);
  return <section className="control-section palette-mapping-controls">
    <div className="section-heading"><h3>Palette interpretation</h3><span>EXPERIMENT</span></div>
    <label className="control-label" htmlFor="palette-mapping">Color mapping</label>
    <div className="select-wrap"><select id="palette-mapping" aria-label="Color mapping" value={mapping.mode}
      onChange={e => onChange({ ...mapping, mode: e.target.value as ColorMappingSettings['mode'] })}>
      <option value="nearest">Perceptual nearest · default</option>
      <option value="mood">Palette mood</option>
      <option value="correspondence">Palette correspondence</option>
      <option value="ramp">Tonal ramp</option>
    </select><ChevronDown size={14} /></div>
    <p className="field-note">{explanations[mapping.mode]}</p>
    <fieldset disabled={mapping.mode === 'nearest'} className="mapping-fields">
      <Slider label="Color transfer strength" value={mapping.strength} onChange={strength => onChange({ ...mapping, strength })} />
    </fieldset>
    {mapping.mode === 'ramp' && <>
      <div className="mapping-ramp">{stops.map((stop, i) => <label key={stop} className="control-label">
        <span>{stop}</span><span className="ramp-picker"><i style={{ background: ramp[i] }} aria-hidden="true" />
          <select aria-label={`Ramp ${stop.toLowerCase()}`} value={ramp[i]} onChange={e => onChange({ ...mapping, ramp: ramp.map((c, j) => j === i ? e.target.value : c) })}>
            {style.palette.map((color, j) => <option key={j} value={color}>{color}</option>)}
          </select></span>
      </label>)}</div>
      <button className="secondary-button" onClick={() => onChange({ ...mapping, ramp: [] })}>Use automatic ramp</button>
      <p className="field-note">Automatic stops follow palette lightness. Choose your own sequence for cool shadows, warm highlights, or a different mood.</p>
    </>}
    {mapping.mode !== 'nearest' && <>
      <button className="secondary-button" onClick={onRefresh}>Refresh source colors</button>
      <p className="field-note">Source colors and tonal range are held steady during video. Refresh after a lighting change; switching sources or a scene cut refreshes automatically. This refreshes both regions.</p>
    </>}
    <p className="field-note">Applies to the region selected above. Output stays within its palette. At 0% strength, color picking uses the current method.</p>
  </section>;
}
