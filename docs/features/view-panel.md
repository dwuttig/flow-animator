# View panel

- Status: implemented
- Context: Playback
- Slice: viewer (`index.html`)

## What
One floating panel over the top right of the diagram replaces the controls row, the rendering-options row and the top-right bar.

- Playback: Restart, Prev, Play/Pause, Next, scrubber with step count, Speed, Loop, Trail.
- Display: Orientation, Connections, Step style, Thickness, Labels (show step labels on connections).
- Zoom: +, −, Reset (zoom and position), Maximize, Fullscreen.
- Hide/Show collapses the panel to its title bar. The choice is stored in `localStorage` (`flow-animator.viewpanel`).

## Why
Controls were spread over three places away from the diagram. One panel keeps them next to what they affect and leaves the diagram uncluttered when hidden.

## Notes
- Element ids are unchanged, so keyboard shortcuts and the public API keep working.
- The panel sits inside the stage wrapper, so it stays visible in Maximize and Fullscreen.
- On narrow windows it is limited to the stage width and its rows wrap.
