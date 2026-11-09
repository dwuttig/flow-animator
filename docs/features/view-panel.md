# View panel

- Status: implemented
- Context: Playback
- Slice: view-options, render-diagram, viewer (`src/playback/`)

## What
One panel **beside** the diagram holds all view controls, in three sections:

- Playback: Restart, Prev, Play/Pause, Next, scrubber with step count, Speed, Loop, Trail.
- Display: Orientation, Connections, Step style, Labels, Optimize layout, Node spacing, Thickness.
- Zoom and view: +, −, Reset (zoom and position), Maximize, Fullscreen. Ctrl + mouse wheel zooms and Ctrl + left-drag pans the diagram; the plain wheel scrolls the page.

Optimize layout reorders nodes inside their columns (rows when vertical) to reduce edge crossings and edges through nodes, and widens the search for step label positions. Nodes with explicit `row` stay put. Node spacing scales the gaps between nodes (0.5x to 3x). Both are viewer settings, handled by `src/layout/layout.js` (`optimize`, `spacing` options) and the `view-options` slice.

Hide/Show collapses it to its title bar; the choice is stored in `localStorage` (`flow-animator.viewpanel`). It stacks below the diagram when space is short; see [../style-guide.md](../style-guide.md).

## Why
Controls were spread over three places away from the diagram. A side panel keeps them together without covering the diagram.

## Notes
- Element ids are unchanged, so keyboard shortcuts and the public API keep working.
- Maximize and Fullscreen keep the panel next to the diagram.
