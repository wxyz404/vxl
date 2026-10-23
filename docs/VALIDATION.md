# Validation

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
