import type { FaceSettings } from '../core/presets';
import type { FaceStatus } from '../core/types';
import { Slider, Toggle } from './ControlInputs';

export function FaceControls({value,onChange,status,message,onRetry,showRegion,onShowRegion}:{
  value:FaceSettings;onChange(value:FaceSettings):void;status:FaceStatus;message?:string;onRetry():void;
  showRegion:boolean;onShowRegion(value:boolean):void;
}) {
  const labels:Record<FaceStatus,string>={off:'Off · no face model running',loading:'Loading local face model…',estimating:'Looking for a face…',tracking:'Tracking one face',
    'no-face':'No face detected · ordinary styling',small:'Face too small · move closer or raise the resolution',stale:'Waiting for a fresh face estimate',demo:'Authored demo face · not AI detection',error:message||'Face tracking unavailable'};
  return <section className="control-section face-controls">
    <div className="section-heading"><h3>Face readability</h3><span>EXPERIMENT · GLOBAL</span></div>
    <div className="inline-control"><span>Enable face readability</span><Toggle label="Face readability" checked={value.enabled} onChange={enabled=>onChange({...value,enabled})}/></div>
    <p className="field-note">Quiet facial shading and protect eyes, brows, and mouth on the shared pixel grid. Applies to one face, independently of person separation.</p>
    <fieldset className="face-fields" disabled={!value.enabled}>
      <label className="control-label" htmlFor="face-treatment">Treatment</label>
      <select id="face-treatment" aria-label="Face treatment" value={value.treatment} onChange={e=>onChange({...value,treatment:e.target.value as FaceSettings['treatment']})}>
        <option value="portrait">Readable portrait</option><option value="sprite">Sprite portrait</option>
      </select>
      <Slider label="Face strength" value={value.strength} onChange={strength=>onChange({...value,strength})}/>
      <Slider label="Feature emphasis" value={value.featureEmphasis} onChange={featureEmphasis=>onChange({...value,featureEmphasis})}/>
      <Slider label="Feature exaggeration" value={value.exaggeration} onChange={exaggeration=>onChange({...value,exaggeration})}/>
      <p className="field-note">Zero exaggeration preserves proportions. Higher values mildly enlarge eyes and mouth when size and pose allow it.</p>
      <div className="inline-control"><span>Show face region</span><Toggle label="Show face region" checked={showRegion} onChange={onShowRegion}/></div>
      <p className="field-note">The green guide is preview-only; it is never saved in images or clips.</p>
    </fieldset>
    <p className="face-status" role="status">{!value.enabled||value.strength===0?labels.off:labels[status]}</p>
    {value.enabled&&status==='error'&&<button onClick={onRetry}>Retry face tracking</button>}
    <p className="field-note">Uses your active palette. Frames stay on your device. Run <code>pnpm models:setup -- --face</code> once to install the local model (3.6 MB). The face region is approximate: bangs, glasses, and objects crossing the face can receive styling.</p>
  </section>;
}
