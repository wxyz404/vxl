import type { FrameSource, StudioStats } from '../core/types';
import { processingPolicy } from '../core/file-processing';
import { Slider } from './ControlInputs';

export function FileProcessingControls({ value, onChange, source, stats, recording }: {
  value: number; onChange(value: number): void; source: FrameSource['kind']; stats: StudioStats; recording: boolean;
}) {
  const policy = processingPolicy(value), uploaded = source === 'file' || source === 'image';
  return <section className="control-section file-processing-controls">
    <div className="section-heading"><h3>Uploaded media processing</h3><span>EXPERIMENT</span></div>
    <fieldset className="depth-fields" disabled={!uploaded || recording}>
      <Slider label="Extra processing per frame" min={0} max={4} step={1} value={value}
        display={value === 0 ? 'Off' : `${value} / 4`} onChange={onChange} />
    </fieldset>
    <p className="field-note">{!uploaded ? 'Open a video or PNG/JPG image to try this. Webcam and demo processing stay unchanged.' : value === 0 ? 'Off uses the ordinary image pipeline and normal video playback.' : `${policy.passes} extra edge-preserving smoothing ${policy.passes === 1 ? 'pass' : 'passes'} before palette selection, plus up to ${policy.waitMs} ms per frame for matching face/depth results when enabled.`}</p>
    <p className="field-note">Higher settings can soften texture and erase small details. Compare settings to judge the look; more processing does not guarantee better art.</p>
    {source === 'file' && value > 0 && <p className="field-note">Video advances one sample at a time at the selected 15/30 FPS sampling rate. Preview playback may be slower than the original. This samples the video timeline; it does not recover every native frame. Record clip captures the slower preview as it plays.</p>}
    {uploaded && value > 0 && <p className="processing-status" role="status">
      {source === 'file' && stats.mediaTime !== undefined ? `Video position ${stats.mediaTime.toFixed(2)} / ${Number.isFinite(stats.mediaDuration) ? stats.mediaDuration!.toFixed(2) : '…'} s · ` : ''}
      {stats.processingMs === undefined ? 'Preparing a frame…' : `Last frame ${Math.round(stats.processingMs)} ms`}
      {stats.processingWaitExpired ? ' · wait budget reached; unavailable estimates omitted' : ''}
    </p>}
    {recording && <p className="field-note">Stop recording before changing processing effort.</p>}
  </section>;
}
