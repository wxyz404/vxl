export function Toggle({ checked, onChange, label, disabled = false }: { checked: boolean; onChange: (value: boolean) => void; label: string; disabled?: boolean }) {
  return <button type="button" role="switch" aria-label={label} aria-checked={checked} disabled={disabled} className={`toggle ${checked ? 'on' : ''}`} onClick={() => onChange(!checked)}><span /></button>;
}
export function Slider({ label, value, onChange, min = 0, max = 1, step = 0.01, display }: { label: string; value: number; onChange: (value: number) => void; min?: number; max?: number; step?: number; display?: string }) {
  return <label className="slider"><span className="control-label">{label}<output>{display ?? `${Math.round(value * 100)}%`}</output></span><input aria-label={label} type="range" min={min} max={max} step={step} value={value} onChange={event => onChange(Number(event.target.value))} style={{ '--fill': `${(value - min) / (max - min) * 100}%` } as React.CSSProperties} /></label>;
}
