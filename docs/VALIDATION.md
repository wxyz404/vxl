# Validation

## Live depth stability follow-up — October 27, 2026

- Replaced the unconditional one-second live-map expiry and old-snapshot motion gate with latency-aware retention, adjacent-frame cut detection, 300 ms map/effect transitions, and a one-second fade before bounded expiry. Isolated invalid predictions retain the last good map. Ordinary depth arrivals preserve renderer history. Cuts, source generations, seeks, and explicit disabling still invalidate/release state.
- TypeScript checking and the production build passed. **17 unit tests passed**, including slow inference beyond one second, ordinary movement around the former gate, invalid predictions, continuous map interpolation, fade/recovery, bounded reuse, paused-frame transitions, worker failure, and reset/source isolation.
- Full development Chromium suite: **21 passed; 2 opt-in model checks skipped**. The new live regression uses the actual studio/camera/render loop with a controlled depth worker that takes **1.8 seconds per estimate** and returns an invalid result every third inference. After the first styled frame, all sampled output frames remain in the depth visualization and all sampled statuses remain active across five worker replies; the old path cannot sustain an active map at this latency. Existing outline, camera, recording/replay, palette, and layout checks also pass.
- Compiled production depth suite: **3 passed; 2 development-only fixtures skipped**. The controlled slow-worker regression and demo controls pass. Actual depth/person workers run together on live synthetic camera input: **60 status samples over six seconds, zero fallbacks**, followed by pause, preview, disable, and source-release checks without page errors. This is a synthetic-camera stability check, not physical-camera accuracy or hardware FPS evidence.
- Physical footage with fast local motion may still show spatial lag because retained maps are blended rather than motion-reprojected. Long outages deliberately fade back to ordinary styling. The exact original capture timestamps and bounded reuse budgets remain attached to estimates; retained fields are not re-stamped as fresh.

## Experimental scene depth — October 27, 2026

- TypeScript checking and the Vite production build passed with the optional Transformers.js worker and bundled browser WASM runtime.
- Unit suite: **13 tests passed**. New checks cover inverse-depth normalization, invalid/flat fields, age/generation guards, legacy preset defaults, one in-flight request, scene-cut invalidation, worker failure/retry, obsolete worker messages, and bitmap cleanup when disabled during capture.
- Full Chromium browser suite: **20 passed; 2 opt-in model checks skipped**. Existing contour, palette, person-model, camera recovery, recording/replay, and mobile checks pass. Depth checks cover the Experimental Settings tab, disabled default, paused-frame updates, three diagnostic planes, no model download for the authored demo, near-color preservation, palette membership, map orientation, stale/wrong-source rejection, and turning the effect off.
- Opt-in development model smoke check passed: the actual pinned Depth Anything V2 Small q8 worker downloaded its model and generated a nonconstant 280×154 field from a local synthetic scene. First loading plus inference took about 10.2 seconds in this run; this is **not** steady-state latency or camera FPS.
- Compiled production preview passed the depth UI check and the actual depth/person-model integration check with Chromium's synthetic camera. Both workers ran, a paused camera frame received an active depth estimate, the depth preview changed, and disabling/releasing the source completed without page errors.
- The [authored-depth comparison](depth-comparison.png) was regenerated and visually inspected, including restrained daylight defaults, warm atmosphere, and the depth map. It illustrates rendering changes, not neural accuracy. See [DEPTH.md](DEPTH.md) for primary-source art research and reproduction commands.
- Physical webcam/video depth accuracy, live-motion alignment, real-hardware performance, difficult reflective/translucent surfaces, and broad artistic-quality evaluation remain unverified. Relative depth is not a physical distance measurement. Slow/stale estimates fall back to ordinary styling.

## Outlining update — October 26, 2026

- TypeScript checking and the Vite production build passed.
- Unit suite: 8 tests passed, including legacy-preset defaults and the cached Oklab transform.
- Browser suite: all 18 tests passed in full Chromium with software graphics and synthetic camera input. Ten exercise contour behavior directly; eight cover the studio, local model, capture recovery, export, clip replay, and layout.
- Compiled production preview: synthetic-webcam smoke test passed, including local model inference, revised contour shaders, and track release.
- The camera integration test deliberately rejects direct `createImageBitmap(video)` calls and verifies that synchronous decoded-frame snapshots still reach the model and release camera tracks.
- Recording tests now allow three seconds of encoder warm-up. They still download an actual encoded clip, reopen it as a file source, and require a processed preview without errors.
- The reproducible [outline comparison](OUTLINES.md) uses the original committed renderer and the same generated RGB/mask inputs. The rectangle's nominal one-pixel band changes from 272 ink pixels across both sides to 132 inside pixels. The stationary noisy-mask fixture's normalized ink changes fall from 5.29% to 2.07%; the moving fixture stays at 116 ink pixels per frame. These are controlled renderer diagnostics, not real-person recognition scores or camera performance measurements.

The new work does not establish physical webcam accuracy, ordinary-laptop FPS, or SAM 2 tracking support. The existing local person model is unchanged.

## Verified on October 22, 2026

- `pnpm build`: passed TypeScript checking and production bundling.
- `pnpm test`: 6 tests passed across preset/palette validation, logical sizing, and scene-change detection.
- `pnpm test:e2e`: all 8 integration tests passed in full Chromium using SwiftShader and synthetic media devices.
- Production smoke check (`VXL_TEST_PREVIEW=1`, synthetic webcam case): passed against the compiled build, including real worker/model inference and camera-track release.
- The pinned version 1 model was downloaded from its permanent official URL and its SHA-256 matched the setup script.

The browser checks include real video encoding and replay of the downloaded clip. Full Chromium is intentional: the reduced Windows headless shell rejected synthetic camera playback in this environment. These checks do not establish physical camera quality or hardware performance.

## Automated checks

`pnpm test` validates preset/schema boundaries, palette import, preset isolation, and landscape/portrait logical resolution.

`pnpm test:e2e` uses project-local Chromium with SwiftShader and checks the real GPU pipeline, palette-constrained output, PNG download, recording control locks and clip replay, JSON rejection, camera-permission recovery, mobile overflow, synthetic webcam track cleanup, missing-model recovery, and a real MediaPipe worker with a synthetic image and all non-local requests blocked.

The suite is an integration check, not a recognition benchmark. A valid finite confidence mask from a synthetic image proves that the runtime runs; it does not prove that the model accurately segments a person. Software graphics do not establish ordinary-laptop performance. Render diagnostics measure CPU submission time, not total GPU execution time or camera-to-screen latency.

## Physical acceptance still required

Use an identified integrated-graphics laptop and record CPU/GPU, RAM, OS, browser version, power mode, input resolution, and enabled effects. Targets are 30 new styled FPS, with a 15 FPS reduced mode. They are not measured guarantees.

1. Run each preset on a physical webcam for at least 10 minutes. Check bounded memory, stopped tracks after switching away, thermal behavior, and recording overhead.
2. Evaluate face and hand detail, low light, textured clothing, multiple people, entering/leaving, occlusion, panning, and low-contrast motion. Compare downsampling, palette-only, full treatment, and each effect disabled.
3. Check boundary halos, mask trails, palette flicker, repeated source changes, video seeking/end/replay, unplugging a camera, and graphics-context recovery.
4. Replay saved clips and inspect PNGs at actual integer scale. Confirm duration, orientation, no audio, and matching output colors.
5. Disconnect the network after local setup. Start a new session from the running local server and verify model loading, camera input, controls, and export.

Pixel art quality also requires human review. Include pixel artists where possible; image similarity alone is insufficient. Motion-following textures, furniture recognition, phone transport, and packaged desktop behavior have no acceptance claim in this release.
