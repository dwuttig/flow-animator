# View panel

- Status: implemented
- Context: Playback
- Slice: viewer (`index.html`)

## What
One panel **beside** the diagram holds all view controls, in three sections:

- Playback: Restart, Prev, Play/Pause, Next, scrubber with step count, Speed, Loop, Trail.
- Display: Orientation, Connections, Step style, Labels, Thickness.
- Zoom and view: +, −, Reset (zoom and position), Maximize, Fullscreen.

Hide/Show collapses it to its title bar; the choice is stored in `localStorage` (`flow-animator.viewpanel`). It stacks below the diagram when space is short; see [../style-guide.md](../style-guide.md).

## Why
Controls were spread over three places away from the diagram. A side panel keeps them together without covering the diagram.

## Notes
- Element ids are unchanged, so keyboard shortcuts and the public API keep working.
- Maximize and Fullscreen keep the panel next to the diagram.
