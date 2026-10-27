# Architecture and delivery stages

Experimental scene depth is independent of person masks: `SceneDepthEstimator` owns an optional, lazily created Depth Anything worker; `FramePacket.depth` carries normalized relative distance with generation/time metadata. `DepthHistory` retains asynchronous estimates with a bounded latency-aware reuse budget, blends updates over 300 ms, and fades genuinely stale/failed estimates over one second. The studio renders continuously, preserves renderer history on normal depth updates, and animates matching paused frames until transitions finish. Clear cuts, seeks, and source changes discard mismatched fields. The renderer checks the reuse budget and uses a separate depth texture and strength for palette-constrained atmospheric effects and distant detail reduction. Preset defaults keep this path disabled. See [DEPTH.md](DEPTH.md) for research, data conventions, lifecycle guards, and limitations.

## Current prototype

The browser is the initial experimental host, not a permanent product constraint. `FrameSource`, `Segmenter`, and `FramePacket` keep input, recognition, rendering, and UI separate. `Preset` is validated version 1 JSON; browser storage is only a convenience layer.

Every frame has a monotonic timestamp and source generation. Transferred bitmaps are returned by the worker alongside masks. Stale generations are discarded and their bitmaps closed. Source changes stop old tracks, dispose old frames, and reset history. A busy pipeline drops capture opportunities instead of maintaining an input queue. The CPU worker is the initial portable inference backend; the renderer uses WebGL2.

The rendering pipeline intentionally avoids generative frame synthesis. Regions influence sampling, palette choice, and treatment. Small-scale shape and palette decisions remain deterministic. A quarter-resolution backward-motion pass aligns temporal evidence; match confidence and current mask certainty gate reuse. Silhouettes use a single owned distance band, while interior edges use directional thinning and hysteresis. Palette hysteresis reduces color oscillation. See [stable pixel contours](OUTLINES.md) for controls, research, and renderer-only evidence. These heuristics still need real-video evaluation, particularly around low-contrast fast movement and occlusion.

## Desktop application — next stage

Use an Electron shell as the initial desktop route, reusing the browser UI, worker, and GPU effects. This is a future build, not an included launcher or installer.

- Load packaged application/model assets through a secure application origin. Keep Node disabled in the renderer, enable context isolation, and expose only minimal typed desktop operations.
- Put device selection and camera permissions behind a host adapter, retaining the existing browser adapter for continued experiments.
- Move persistent preset/model storage and export dialogs behind a storage/export interface. Preserve version 1 preset compatibility.
- Add native capture, encoding, or inference only after benchmarks show a concrete improvement. A native runtime is not required simply to package the first desktop version.
- Validate packaged camera access, microphone exclusion, capture-card selection, suspend/resume, installation, and upgrades on physical Windows hardware before claiming desktop support.

## Broader recognition

Add an instance-capable segmenter adapter returning category and instance metadata. Start with a small set of documented classes: person, chair, couch, bed, and dining table. YOLO26n-seg via ONNX Runtime Web is the planned candidate; test exported operator support and actual laptop performance before making it a supported mode. Preserve the renderer's class-independent style interface. A detector's bounding boxes are not a substitute for masks.

Per-instance style persistence requires tracking and an explicit identity lifecycle. SAM 2 is a research reference for prompted video segmentation; it does not replace automatic class labeling. Do not label a mask model as general furniture recognition.

## Other inputs and outputs

Desktop-visible phone webcams, USB cameras, and virtual camera inputs use the existing browser device source when supported by the OS. A direct phone connection needs local pairing, transport, disconnect handling, and authentication. A subsequent screen-capture source can implement `FrameSource` without changing the art pipeline.

OBS integration should begin with a clean output surface, followed by an evaluated desktop transport. A virtual camera is a separate OS integration. Neither is implemented in this browser prototype.
