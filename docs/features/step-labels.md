# Step labels

- Status: implemented
- Context: Playback
- Slice: viewer (`index.html`)

## What
Every Step's label is drawn beside its connection line in the diagram, always visible. The Step(s) of the current Beat have a highlighted label (bold, larger, accent outline). The **Labels** checkbox in the View panel hides or shows them; the choice is stored in `localStorage` (`flow-animator.view`).

## Why
Readers had to look at the caption below the diagram to know what each arrow means. Labels on the arrows make the diagram readable on its own, also in a paused or exported view.

## Notes
- Placement is greedy per Step: try the middle of the line, then other positions along it, each beside the line (either side) and then on it; the first spot free of nodes and earlier labels wins. If none is free the label sits slightly above the middle. Labels stay inside the canvas.
- Labels over 26 characters are shortened with an ellipsis (full text on hover and in the Step list).
- Several Steps on one connection get separate labels.
- Labels are part of the SVG, so the recorded video (see `record-video.md`) and standalone export show them too.
- No change to the Flow format.
