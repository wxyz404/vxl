# VXL

A local pixel art studio for webcams and video files. VXL separates recognition from rendering: the person model supplies a mask, and a GPU pipeline shapes the image with palettes, clusters, selective outlines, dithering, and texture.

The current build is the **browser prototype**. A dedicated desktop app is an explicit next stage, with reusable capture, segmenter, renderer, and preset interfaces already separated from the UI.

## Run locally

Requires Node.js 22+ and pnpm 11. Use a current desktop Chrome or Edge with graphics acceleration enabled.

```sh
pnpm install
pnpm models:setup
pnpm dev
```

Open **http://127.0.0.1:5173**. Start with the generated studio scene, enable your webcam, or open/drop a video file. Camera access requires localhost or HTTPS. A phone or capture card can be selected if its desktop driver exposes it as a webcam; direct phone pairing is not implemented.

On Windows, you can also double-click **run.bat** after installing Node.js and pnpm. It prepares local assets and opens the studio. Keep its terminal open while using VXL.

`models:setup` downloads Google's approximately 250 KB landscape selfie model, pins version 1 by SHA-256, and copies the MediaPipe runtime into `public/vision/`. Corrupt models are replaced on setup; use `pnpm models:setup --force` to download again. These generated assets are intentionally ignored by Git. Run setup before building on another computer. Inference and effects run locally without frame uploads. Standard effects and person separation need no runtime CDN; optional experimental depth downloads its model from Hugging Face on first use. This is not an installable offline PWA: keep the local server running.

## Included

- Webcam, local video, and an original animated illustration for experimenting without camera permission.
- **Pixel Video** and **Sprite Scene** presets, with 160/240/320/480-pixel longest-edge resolutions and aspect-ratio preservation.
- Fixed editable palettes, perceptual color mapping, mask-weighted downsampling, bilateral simplification, palette hysteresis, cluster cleanup, and palette-constrained selective antialiasing.
- Dark, colored, or selective outlines; outline thickness; internal edges; light direction; deterministic Bayer dithering; stipple and hatch textures.
- Motion-aligned contour history, one-sided silhouette bands, and separate contour smoothing/outline stability controls; old presets remain compatible.
- Separate person/background treatments, using a local MediaPipe model in a worker. All people share one foreground category.
- **Experimental Settings → Face readability** (off by default): Readable portrait and Sprite portrait preserve facial detail within a conservative face region, using the active palette. Includes strength, feature emphasis, optional mild exaggeration, a preview-only guide, and separate inference timing. Install its optional local model with `pnpm models:setup -- --face`. It tracks one face; small, obscured, or rapidly moving faces can fall back to ordinary styling.
- **Experimental Settings → Palette interpretation**: Palette mood, Palette correspondence, and an editable five-stop Tonal ramp reinterpret source colors before palette matching. Choose Perceptual nearest for direct color matching. Each region has its own method and strength; references stay fixed during video until refreshed or the scene/source changes.
- **Experimental Settings → Depth-aware styling** (off by default): relative scene depth guides atmospheric color, contrast, saturation, texture, clusters, and outlines. Includes depth/plane previews. Camera/video use a lazily loaded depth model; the illustration uses authored demo depth. See the [research, controls, comparison, and limitations](docs/DEPTH.md).
- Original/filtered comparison, pause, performance details, and 15/30 FPS caps.
- PNG snapshots, silent browser-supported video recording, PNG/JSON palette imports, JSON palette/preset exports, and locally remembered settings.
- Camera-error recovery, model-failure whole-frame fallback, source-generation guards, matching frame/mask ownership, context-loss recovery, and camera/bitmap/worker cleanup.

The illustrated demo uses an **analytic mask**, clearly labeled in the interface. It is not evidence of neural recognition quality. Switch to real video to evaluate the model. The renderer approximates pixel art techniques; it does not claim hand-drawn or artist-equivalent results.

## Controls and files

- **Space:** pause/resume; **S:** snapshot; **R:** start/stop recording. Shortcuts are ignored while editing controls.
- Click a palette swatch to edit its color. **Import palette** accepts PNG swatch strips/grids or a JSON array of 2–32 six-digit hex colors (also an object with a `colors` array). PNG imports keep distinct colors in first-seen order, left to right then top to bottom, and skip fully transparent pixels. Use a flat palette image with 2–32 colors; images with more colors are rejected. PNG limits: 4 MB and 4,194,304 pixels; JSON limit: 64 KB. The palette applies to the selected region and stays on your device.
- Save/open a complete version 1 JSON preset, including both region styles. Invalid or oversized files are rejected before applying.
- Recording is silent, limited to 5 minutes or 200 MB, and uses a supported WebM/MP4 encoder. Clips use an integer enlargement of the logical grid up to 640 pixels on the longest edge to keep encoding practical on laptops. Source and resolution changes are locked during recording. Save clips before closing the page.

Example palette:

```json
["#183b2b", "#42744a", "#8eb55c", "#dce6a4"]
```

## Build and test

```sh
pnpm build
pnpm preview
pnpm test
```

For browser integration tests, install Chromium into the project-local cache, then run the suite:

```powershell
$env:PLAYWRIGHT_BROWSERS_PATH = "$PWD/.cache/playwright"
pnpm exec playwright install chromium
pnpm test:e2e
```

The browser suite exercises real WebGL shaders, exports, control state, mobile layout, permission errors, and real worker/model inference with a synthetic frame. It uses software graphics for repeatability. See [validation](docs/VALIDATION.md) for the difference between automated checks and physical acceptance.

## How it is organized

| Module | Responsibility |
| --- | --- |
| `src/capture` | Frame sources and device lifecycle |
| `src/core` | Scheduling, frame ownership, presets, and recording |
| `src/vision` | Segmenter interface, MediaPipe adapter, and worker |
| `src/render` | Independent WebGL2 multipass renderer |
| `src/ui` | React studio and controls |

The renderer works on a single aligned low-resolution grid. The pipeline is: matching RGB/mask → spatial preparation and backward motion → region-weighted downsampling and stability → Oklab palette mapping → cluster cleanup → dithering/textures → independently stabilized contour composition → integer nearest-neighbor enlargement. Shape cleanup precedes patterning so it does not erase intentional dithering. See [outline behavior, comparisons, and research references](docs/OUTLINES.md).

Only one capture/inference job runs at a time. Incoming opportunities are skipped rather than queued, so slow inference does not create an ever-growing delay. The output keeps each mask paired with the actual image used to compute it. Pattern coordinates stay attached to the screen grid; motion-following textures require a later tracking implementation.

## Desktop and recognition roadmap

The next product stage is a **dedicated desktop application**, reusing the core pipeline. Its work includes installation, desktop persistence, device management, native encoding/capture where useful, and physical hardware acceptance. Browser prototypes establish feasibility before adding these integrations.

Furniture and individual objects, direct phone pairing, motion-following textures, OBS output, and a virtual camera are not part of this prototype. See [architecture and delivery stages](docs/ARCHITECTURE.md).

## References and attribution

The implementation is original. No code from the following image-effect projects has been copied. They informed the research and comparisons:

- [PixelOE](https://github.com/KohakuBlueleaf/PixelOE): contrast-aware feature preservation before pixelization.
- [Colliding Scopes Video-to-Pixel-Art](https://github.com/collidingScopes/video-to-pixel-art): a useful browser baseline for palettes, edges, and dithering.
- [Ditherer](https://github.com/gyng/ditherer): browser dithering and effect-chain reference.
- [Lospec outlines](https://lospec.com/articles/pixel-art-outlines/): artistic line and silhouette guidance.
- [Pixelmash](https://nevercenter.com/pixelmash/) and [PixelOver](https://pixelover.io/): adjustable pixel art workflows.

MediaPipe runtime and the Google selfie model provide recognition. See [third-party notices](THIRD_PARTY_NOTICES.md).

VXL's own code is available under the [MIT license](LICENSE).
