import { useCallback, useEffect, useRef, useState } from 'react';
import { Aperture, Camera, Check, ChevronDown, CircleHelp, Columns2, Download, FileVideo, FolderOpen, Gauge, Image as ImageIcon, Layers2, LockKeyhole, Pause, Play, Plus, ScanLine, SlidersHorizontal, Square, Upload, WandSparkles, X } from 'lucide-react';
import { CameraSource, DemoSource, FileSource } from '../capture/sources';
import { copyPreset, loadSavedPreset, parsePalette, parsePreset, PRESETS, type Preset, type Region } from '../core/presets';
import { CanvasRecorder, downloadBlob, exportJson, timestampName } from '../core/recording';
import { Studio } from '../core/studio';
import type { DepthStatus, FrameSource, StudioStats } from '../core/types';
import { Controls, Toggle } from './Controls';

const emptyStats: StudioStats = { fps: 0, renderMs: 0, inferenceMs: 0, dropped: 0, logicalWidth: 320, logicalHeight: 180 };

export function App() {
  const [preset, setPreset] = useState(loadSavedPreset);
  const [region, setRegion] = useState<Region>('foreground');
  const [stats, setStats] = useState(emptyStats);
  const [sourceKind, setSourceKind] = useState<FrameSource['kind']>('demo');
  const [sourceLabel, setSourceLabel] = useState('Studio scene');
  const [vision, setVision] = useState<'off' | 'loading' | 'ready' | 'demo' | 'error'>('off');
  const [depthStatus, setDepthStatus] = useState<DepthStatus>('off');
  const [depthMessage, setDepthMessage] = useState('');
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState('');
  const [paused, setPaused] = useState(false);
  const [compare, setCompare] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [opening, setOpening] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [diagnostics, setDiagnostics] = useState(false);
  const [about, setAbout] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [limit, setLimit] = useState(30);
  const [ready, setReady] = useState(false);
  const [boot, setBoot] = useState(0);
  const output = useRef<HTMLCanvasElement>(null), original = useRef<HTMLCanvasElement>(null);
  const studio = useRef<Studio | null>(null), recorder = useRef(new CanvasRecorder());
  const fileInput = useRef<HTMLInputElement>(null), paletteInput = useRef<HTMLInputElement>(null), presetInput = useRef<HTMLInputElement>(null);
  const initialPreset = useRef(preset);
  const recordCanvasSize = useRef('');

  const refreshDevices = useCallback(async () => {
    try {
      if (navigator.mediaDevices?.enumerateDevices) {
        const list = await navigator.mediaDevices.enumerateDevices();
        const seen = new Set<string>();
        setDevices(list.filter(d => d.kind === 'videoinput' && d.deviceId && !seen.has(d.deviceId) && Boolean(seen.add(d.deviceId))));
      }
    } catch { /* Device names may be unavailable before permission. */ }
  }, []);

  useEffect(() => {
    let active = true;
    try {
      const engine = new Studio(output.current!, original.current!, initialPreset.current, {
        onStats: value => { if (active) { setStats(value); setReady(engine.hasFrame); } },
        onError: message => { if (active) setError(message); },
        onVision: value => {
          if (active) {
            setVision(value);
            if (value === 'ready') setError(current => current.includes('Whole-frame styling is still available.') ? '' : current);
          }
        },
        onSource: source => { if (active) { setSourceKind(source.kind); setSourceLabel(source.label); setPaused(false); void refreshDevices(); } },
        onEnded: () => { if (active) setPaused(true); },
        onDepth: (status, message) => { if (active) { setDepthStatus(status); setDepthMessage(message ?? ''); } },
      });
      studio.current = engine;
      void engine.setSource(new DemoSource()).catch(() => {});
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'The renderer could not start.'); }
    void refreshDevices();
    navigator.mediaDevices?.addEventListener('devicechange', refreshDevices);
    const currentRecorder = recorder.current;
    return () => { active = false; currentRecorder.dispose(); studio.current?.dispose(); studio.current = null; navigator.mediaDevices?.removeEventListener('devicechange', refreshDevices); };
  }, [boot, refreshDevices]);

  useEffect(() => {
    initialPreset.current = preset;
    studio.current?.setPreset(preset);
    try { localStorage.setItem('vxl.preset.v1', JSON.stringify(preset)); } catch { /* Storage can be disabled; JSON export is still available. */ }
  }, [preset]);
  useEffect(() => { if (studio.current) studio.current.fpsLimit = limit; }, [limit, boot]);
  useEffect(() => { if (!notice) return; const id = setTimeout(() => setNotice(''), 4500); return () => clearTimeout(id); }, [notice]);
  useEffect(() => {
    if (!recording) return;
    const id = setInterval(() => setRecordSeconds(value => value + 1), 1000);
    return () => clearInterval(id);
  }, [recording]);

  async function selectSource(source: FrameSource) {
    if (recording) { source.stop(); setError('Stop recording before changing the source.'); return; }
    if (!studio.current) { source.stop(); return; }
    setOpening(true); setError(''); setReady(false);
    try { await studio.current.setSource(source); }
    catch { /* Studio reports the readable error. */ }
    finally { setOpening(false); }
  }
  function openVideo(file?: File) {
    if (!file) return;
    if (!file.type.startsWith('video/') && !/\.(mp4|webm|mov|m4v|ogv)$/i.test(file.name)) { setError('Choose a video file such as MP4, WebM, or MOV.'); return; }
    void selectSource(new FileSource(file));
  }
  function togglePaused() { const value = !paused; studio.current?.setPaused(value); setPaused(value); }
  function snapshot() {
    if (!output.current || !studio.current?.hasFrame) return;
    output.current.toBlob(blob => { if (blob) { downloadBlob(blob, `vxl-${timestampName()}.png`); setNotice('Snapshot saved.'); } else setError('The browser could not create this snapshot.'); }, 'image/png');
  }
  function toggleRecording() {
    if (recorder.current.active) { recorder.current.stop(); return; }
    if (recording) return;
    if (!output.current || !studio.current?.hasFrame) return;
    try {
      const size = recorder.current.start(output.current, { width: stats.logicalWidth, height: stats.logicalHeight }, (blob, extension) => {
        downloadBlob(blob, `vxl-${timestampName()}.${extension}`); setRecording(false); setNotice('Recording saved.');
      }, message => { setError(message); if (!recorder.current.active) setRecording(false); });
      recordCanvasSize.current = `${size.width}×${size.height}`;
      setRecordSeconds(0); setRecording(true);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Recording could not start.'); }
  }
  const actions = useRef({ togglePaused, snapshot, toggleRecording });
  actions.current = { togglePaused, snapshot, toggleRecording };
  useEffect(() => {
    function key(event: KeyboardEvent) {
      if ((event.target as HTMLElement).closest('input, select, textarea, button, [role="dialog"]') || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.code === 'Space') { event.preventDefault(); actions.current.togglePaused(); }
      if (event.key.toLowerCase() === 's') actions.current.snapshot();
      if (event.key.toLowerCase() === 'r') actions.current.toggleRecording();
    }
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, []);
  function choosePreset(value: Preset) {
    if (recording && value.resolution !== preset.resolution) { setError('Stop recording before changing the pixel resolution.'); return; }
    setPreset({ ...copyPreset(value), segmentation: preset.segmentation });
  }
  async function importJson(file: File | undefined, kind: 'palette' | 'preset') {
    if (!file) return;
    if (file.size > 64 * 1024) { setError('Choose a JSON file smaller than 64 KB.'); return; }
    try {
      const text = await file.text();
      if (kind === 'palette') setPreset(p => ({ ...p, [region]: { ...p[region], palette: parsePalette(text) } }));
      else {
        const imported = parsePreset(text);
        if (recording && imported.resolution !== preset.resolution) throw new Error('Stop recording before importing a different resolution.');
        setPreset(imported);
      }
      setNotice(`${kind === 'palette' ? 'Palette' : 'Preset'} imported.`);
    } catch (reason) { setError(reason instanceof SyntaxError ? 'This file is not valid JSON.' : reason instanceof Error && reason.name !== 'ZodError' ? reason.message : 'This file is not a supported VXL palette or version 1 preset.'); }
  }
  const effects = [preset[region].simplify > 0, preset[region].clusters > 0, preset[region].outline !== 'off', preset[region].internalEdges > 0, preset[region].antialias, preset[region].dither > 0, preset[region].texture !== 'off'].filter(Boolean).length;
  const visionLabel = { off: 'Whole-frame styling', loading: 'Loading person model…', ready: 'Person model ready', demo: 'Illustrated demo mask', error: 'Whole-frame fallback' }[vision];

  return <div className="app-shell" onDragOver={event => { event.preventDefault(); if (!recording) setDragging(true); }} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false); }} onDrop={event => { event.preventDefault(); setDragging(false); openVideo(event.dataTransfer.files[0]); }}>
    <header className="app-header">
      <a className="brand" href="./" aria-label="VXL home"><span className="brand-mark"><i /><i /><i /><i /><i /></span><strong>vxl<span>.</span></strong><span className="brand-divider" /><span className="brand-caption">PIXEL STUDIO</span></a>
      <div className="header-center"><span className="session-dot" /> Local session <span className="version-badge">PROTOTYPE 01</span></div>
      <div className="header-actions"><span className="privacy-label"><LockKeyhole size={12} /> Stays on your device</span><button className="icon-button" onClick={() => setAbout(true)} aria-label="About VXL"><CircleHelp size={18} /></button><a className="github-link" href="https://github.com/wxyz404/vxl" target="_blank" rel="noreferrer">Source ↗</a></div>
    </header>
    <div className="studio-heading"><div><span className="eyebrow">REAL LIFE, REIMAGINED</span><h1>A different kind of resolution<span>.</span></h1></div><div className="workspace-label"><span className="tiny-grid" /><span>YOUR PIXEL WORKSPACE</span></div></div>
    <main className="workspace">
      <aside className="library">
        <section className="library-section"><div className="section-heading"><h2>Source</h2><span>01</span></div>
          <button className={`source-card ${sourceKind === 'demo' ? 'active' : ''}`} onClick={() => void selectSource(new DemoSource())} disabled={opening || recording}><span className="source-icon"><Aperture size={19} /></span><span><strong>Studio scene</strong><small>A little room to experiment</small></span>{sourceKind === 'demo' && <Check size={14} />}</button>
          <button className={`source-card ${sourceKind === 'camera' ? 'active' : ''}`} onClick={() => void selectSource(new CameraSource(deviceId || undefined, devices.find(d => d.deviceId === deviceId)?.label))} disabled={opening || recording}><span className="source-icon"><Camera size={19} /></span><span><strong>Webcam</strong><small>See yourself in pixels</small></span>{sourceKind === 'camera' && <Check size={14} />}</button>
          {devices.length > 0 && <div className="camera-picker select-wrap"><select aria-label="Camera device" value={deviceId} disabled={recording || opening} onChange={e => { setDeviceId(e.target.value); if (sourceKind === 'camera') void selectSource(new CameraSource(e.target.value, devices.find(d => d.deviceId === e.target.value)?.label)); }}><option value="">Default camera</option>{devices.map((d, i) => <option key={d.deviceId} value={d.deviceId}>{d.label || `Camera ${i + 1}`}</option>)}</select><ChevronDown size={12} /></div>}
          <button className={`source-card ${sourceKind === 'file' ? 'active' : ''}`} onClick={() => fileInput.current?.click()} disabled={opening || recording}><span className="source-icon"><FileVideo size={19} /></span><span><strong>Video file</strong><small>Drop a clip or browse</small></span><Plus size={14} /></button>
          {sourceKind === 'file' && <p className="file-label" title={sourceLabel}>{sourceLabel}</p>}
        </section>
        <section className="library-section preset-library"><div className="section-heading"><h2>Start with a look</h2><span>02</span></div>
          {PRESETS.map((value, i) => <button key={value.name} className={`preset-card ${preset.name === value.name ? 'active' : ''}`} onClick={() => choosePreset(value)} disabled={recording && value.resolution !== preset.resolution}>
            <div className={`preset-art art-${i}`}><div className="art-window" /><div className="art-hill" /><div className="art-person" /><span>{i === 0 ? '32' : '16'}<small>COLORS</small></span></div>
            <div className="preset-caption"><div><strong>{value.name}</strong><small>{i === 0 ? 'Familiar, with a softer edge' : 'Bolder shapes. Fewer pixels.'}</small></div>{preset.name === value.name && <span className="preset-check"><Check size={12} /></span>}</div>
          </button>)}
          <div className="preset-tools"><button onClick={() => presetInput.current?.click()}><FolderOpen size={13} /> Open preset</button><button aria-label="Save preset" title="Save preset as JSON" onClick={() => exportJson(preset, 'vxl-preset.json')}><Download size={14} /></button></div>
        </section>
        <div className="library-foot"><span className="small-pixel-flower">✣</span><p>Small pixels.<br /><strong>Endless possibilities.</strong></p><span>LOCAL BY DESIGN</span></div>
      </aside>

      <section className="viewer-column">
        <div className="viewer-toolbar"><div className="viewer-title"><span className={`status-dot ${paused ? 'muted' : ''}`} /><strong>{opening ? 'Opening source…' : sourceLabel}</strong><span className="source-badge">{sourceKind === 'demo' ? 'DEMO' : sourceKind === 'camera' ? 'CAMERA' : 'VIDEO'}</span></div><div className="viewer-tools"><button className={`tool-button ${compare ? 'selected' : ''}`} onClick={() => setCompare(!compare)} aria-pressed={compare} title="Compare original and filtered"><Columns2 size={15} /><span>Compare</span></button><button className={`icon-button ${diagnostics ? 'selected' : ''}`} onClick={() => setDiagnostics(!diagnostics)} aria-label="Performance details" aria-expanded={diagnostics}><Gauge size={16} /></button></div></div>
        {error && <div className="alert" role="alert"><span>{error}</span><button className="icon-button" onClick={() => setError('')} aria-label="Dismiss error"><X size={15} /></button></div>}
        <div className={`stage ${compare ? 'comparing' : ''}`}>
          <div className="canvas-pair">
            <div className="canvas-pane original-pane" hidden={!compare}><span className="canvas-label">ORIGINAL</span><canvas ref={original} aria-label="Original video preview" /></div>
            <div className="canvas-pane"><span className="canvas-label">{compare ? 'VXL' : paused ? 'PAUSED' : 'FILTERED OUTPUT'}</span><canvas ref={output} data-testid="output-canvas" aria-label="Pixel art video preview" /><div className="canvas-corner tl" /><div className="canvas-corner br" /></div>
          </div>
          {!ready && <div className="stage-loading"><ScanLine size={24} /><span>{opening ? 'Opening your source…' : error ? 'Preview unavailable' : 'Preparing the canvas…'}</span>{error && <button onClick={() => { setError(''); setBoot(v => v + 1); }}>Reload renderer</button>}</div>}
          <div className="stage-info"><span>{stats.logicalWidth} × {stats.logicalHeight}<i>LOGICAL PIXELS</i></span><span><span className="mini-dot" /> {paused ? 'PAUSED' : ready ? `${Math.round(stats.fps)} FPS` : 'STARTING'}</span></div>
        </div>
        <div className="transport"><div className="transport-left"><button className="play-button" onClick={togglePaused} disabled={!ready} aria-label={paused ? 'Play preview' : 'Pause preview'}>{paused ? <Play size={16} fill="currentColor" /> : <Pause size={16} fill="currentColor" />}</button><span className="transport-status">{paused ? 'Paused' : 'Preview running'}<small>{sourceKind === 'demo' ? 'Generated illustration · no camera access' : 'Video only · audio is not captured'}</small></span></div><div className="export-actions"><button className="secondary-button" onClick={snapshot} disabled={!ready}><ImageIcon size={15} /> Snapshot</button><button className={`record-button ${recording ? 'is-recording' : ''}`} onClick={toggleRecording} disabled={!ready && !recording}>{recording ? <Square size={11} fill="currentColor" /> : <span className="record-dot" />}{recording ? `Stop ${Math.floor(recordSeconds / 60)}:${String(recordSeconds % 60).padStart(2, '0')}` : 'Record clip'}</button></div></div>
        {diagnostics && <div className="diagnostics"><div><span>Inference</span><strong>{stats.inferenceMs.toFixed(1)} ms</strong></div><div><span>Render submission</span><strong>{stats.renderMs.toFixed(1)} ms</strong></div><div><span>Skipped slots</span><strong>{stats.dropped}</strong></div><div><span>Frame cap</span><select aria-label="Frame rate limit" value={limit} onChange={e => setLimit(Number(e.target.value))}><option value={30}>30 FPS</option><option value={15}>15 FPS</option></select></div><p>FPS counts newly styled frames. Render timing measures CPU submission, not GPU execution. {recording && `Recording ${recordCanvasSize.current}.`}</p></div>}
        <div className="canvas-settings"><div className="settings-title"><SlidersHorizontal size={15} /><h2>Canvas settings</h2></div><div className="canvas-setting-row"><div><strong>Pixel resolution</strong><p>A shared grid keeps every region in sync.</p></div><div className="segmented resolution-select" role="group" aria-label="Pixel resolution">{[160, 240, 320, 480].map(n => <button key={n} aria-pressed={preset.resolution === n} className={preset.resolution === n ? 'selected' : ''} disabled={recording} onClick={() => setPreset({ ...preset, resolution: n as Preset['resolution'] })}>{n}<small>px</small></button>)}</div></div>
          <div className="canvas-setting-row"><div><strong><Layers2 size={14} /> Person separation</strong><p>{vision === 'off' ? 'Give people and background their own look.' : visionLabel}</p></div><div className="vision-controls">{vision === 'error' && <button className="text-button" onClick={() => studio.current?.retryVision()}>Retry</button>}<Toggle label="Person separation" checked={preset.segmentation} onChange={v => setPreset({ ...preset, segmentation: v })} /></div></div>
          {vision === 'demo' && <div className="demo-note"><WandSparkles size={13} /> This illustration uses a built-in mask. Switch to a webcam or clip to try the person model.</div>}
        </div>
        <div className="viewer-bottom"><span><LockKeyhole size={12} /> Your frames stay here. Always.</span><span><kbd>SPACE</kbd> pause <kbd>S</kbd> snapshot <kbd>R</kbd> record</span></div>
      </section>
      <Controls preset={preset} region={region} onRegion={setRegion} onChange={setPreset} depthStatus={depthStatus} depthMessage={depthMessage} onDepthRetry={() => studio.current?.retryDepth()} onReset={() => choosePreset(PRESETS.find(p => p.name === preset.name) ?? PRESETS[0])} onPaletteImport={() => paletteInput.current?.click()} onPaletteExport={() => exportJson(preset[region].palette, 'vxl-palette.json')} />
    </main>
    <footer className="app-footer"><span><span className="footer-mark">▦</span> MADE OF LITTLE THINGS</span><span>{preset.name} <i>/</i> {preset[region].palette.length} colors <i>/</i> {effects} effects</span><span>v0.1.0 <span className="footer-dot" /> LOCAL PROCESSING</span></footer>
    {notice && <div className="toast" role="status"><Check size={16} />{notice}</div>}
    {dragging && <div className="drop-overlay"><Upload size={40} /><h2>Drop a video. Make it pixels.</h2><p>MP4, WebM, MOV · processed on your device</p></div>}
    {about && <div className="modal-backdrop" onClick={() => setAbout(false)}><section className="about-modal" role="dialog" aria-modal="true" aria-labelledby="about-title" onClick={e => e.stopPropagation()}><button className="icon-button modal-close" aria-label="Close about" onClick={() => setAbout(false)}><X size={18} /></button><span className="eyebrow">VXL / PROTOTYPE 01</span><h2 id="about-title">Real life. Little pixels.</h2><p>Use a webcam or a video file, choose a look, and make it yours. Every image effect and person mask is processed locally.</p><h3>A few things to know</h3><p>Person separation groups people together. Furniture recognition and individual object tracking are planned for later builds.</p><p>The studio scene is an original generated illustration with a known mask. It is a playground for effects, not a test of person recognition.</p><p>Recordings are silent clips, limited to 5 minutes or 200 MB. The browser selects the supported format. Palette and preset files use JSON.</p><p>Phone webcams and capture cards can work when your operating system exposes them as camera devices. Direct phone pairing and a dedicated desktop application are future milestones.</p><button className="primary-button" onClick={() => setAbout(false)}>Back to the studio</button></section></div>}
    <input ref={fileInput} type="file" accept="video/*" hidden aria-label="Open video file" onChange={e => { openVideo(e.target.files?.[0]); e.target.value = ''; }} />
    <input ref={paletteInput} type="file" accept=".json,application/json" hidden aria-label="Import palette file" onChange={e => { void importJson(e.target.files?.[0], 'palette'); e.target.value = ''; }} />
    <input ref={presetInput} type="file" accept=".json,application/json" hidden aria-label="Import preset file" onChange={e => { void importJson(e.target.files?.[0], 'preset'); e.target.value = ''; }} />
  </div>;
}
