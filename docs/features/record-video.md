# Record video for PowerPoint

- Status: implemented
- Plan: [../plans/record-video.md](../plans/record-video.md)
- Bounded context: Playback (browser only)
- Slice(s): `record-video`; wired into `flow-menu` (Export flow...)

## Problem
People want to show a Flow inside a PowerPoint deck. PowerPoint cannot run the viewer, but it plays video files.

## Goals
- Flow menu > Export flow... > **Record video for PowerPoint** saves the animation as a video file.
- MP4 (H.264) when the browser can record it (Chrome, Edge, Safari); WebM as a fallback.
- No new dependency and no server.

## Non-goals
- No live embed in PowerPoint (a web add-in or a chromeless embed URL): possible later as its own slice.
- No audio, GIF or per-user size settings yet (1280 px wide, 30 fps).

## Behaviour
- Records one pass in real time, from the first Step to the last, plus a short hold on the last frame. The page must stay in front; Esc cancels.
- Each frame is the diagram (current theme, orientation, connections, zoom and pan) with a caption band below showing the current Step's label, route and detail.
- Loop is switched off during the recording; afterwards the viewer returns to its earlier Step and settings.
- The file is named after the Flow title (`order-submission.mp4`). In PowerPoint: Insert > Video > This Device.
- Browsers without MediaRecorder get a disabled menu entry. If only WebM is available the message warns that PowerPoint may not play it.

## Domain language
None.

## File-format impact
None.

## Open questions
- MediaRecorder output has no seek index in WebM; MP4 is fine. Offline frame-exact rendering (non real time) would need a bundled encoder and is out of scope.
