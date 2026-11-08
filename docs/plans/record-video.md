# Plan: Record video for PowerPoint

- Status: done
- Spec: `docs/features/record-video.md`
- Bounded context / slice(s): Playback / `record-video`

## Approach
Draw the diagram SVG (cloned with the page's CSS inlined) into a canvas about 30 times a second, feed `canvas.captureStream` to `MediaRecorder`, and download the result. The slice drives the viewer through a small host object, so it holds no viewer logic. Alternatives: a bundled GIF/MP4 encoder (adds dependency), screen capture (needs permission prompts).

## Steps
1. [x] `src/playback/record-video/` with pure helpers (`pickMimeType`, `fileName`, `frameSize`, `wrapText`) and tests.
2. [x] `record` using SVG-to-image, canvas and MediaRecorder.
3. [x] Wire: script tag, `export-flow` SCRIPTS, Dockerfile COPY, menu entry, host adapter in `index.html`.
4. [x] Docs and changelog.

## Files touched
`src/playback/record-video/*`, `src/playback/flow-menu/flow-menu.js`, `src/playback/export-flow/export-flow.js`, `index.html`, `Dockerfile`, docs, `CHANGELOG.md`.

## Risks
- Real-time recording: a hidden or throttled tab drops frames.
- Browsers without MP4 recording produce WebM.

## Verification
`node --test`; in Edge, record the built-in example: 1280x402 MP4, about 15 s, captions present.

## Changelog entry
Added: Flow menu > Export flow... > Record video for PowerPoint.
