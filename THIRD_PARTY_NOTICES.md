# Third-party notices

VXL uses installed dependencies under their respective licenses. Preserve their package license files when redistributing a build.

| Component | License / source |
| --- | --- |
| MediaPipe Tasks Vision runtime | Apache-2.0; https://github.com/google-ai-edge/mediapipe |
| Landscape selfie segmentation model | Google MediaPipe pretrained model; https://developers.google.com/edge/mediapipe/solutions/vision/image_segmenter and the linked model card |
| React and React DOM | MIT; https://github.com/facebook/react |
| Lucide icons | ISC; https://github.com/lucide-icons/lucide |
| Zod | MIT; https://github.com/colinhacks/zod |
| Vite, Vitest, and TypeScript | Their installed package licenses (MIT / Apache-2.0) |
| Playwright | Apache-2.0; https://github.com/microsoft/playwright |

`pnpm models:setup` copies the runtime and downloads the official Google landscape selfie model into ignored `public/vision/` assets. The download source, byte size, installation time, and SHA-256 are recorded in `public/vision/model-info.json`. Review the model card and redistribution terms when packaging models for a public desktop distribution.

The built-in demo illustration, palettes, shader code, and UI were created for this project. The research references listed in README are references, not bundled dependencies. PixelOE, Ditherer, Colliding Scopes, Pixelmash, PixelOver, Ultralytics, SAM 2, and OBS are not included as runtime dependencies.
