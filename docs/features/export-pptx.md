# Export as PowerPoint slide

- Status: implemented
- Plan: [../plans/export-pptx.md](../plans/export-pptx.md)
- Bounded context: Distribution (uses Flow Modeling, Layout, Playback `render-diagram` palette); wired into Playback (`flow-menu`, `viewer`) and the MCP server
- Slice(s): `export-pptx` (new, `src/distribution/export-pptx/`)

## Problem
The MP4 export (`record-video`) puts a Flow into a deck, but as pixels: nobody can restyle a Node, add a callout or fix a typo, and the presenter cannot advance Step by Step. People want a native slide.

## Goals
- One `.pptx` file with one 16:9 slide: Groups, Nodes, Edges and Step labels as native, editable PowerPoint shapes.
- The animation is native PowerPoint animation on that slide. Each presenter click plays one Beat.
- Available from the viewer (Flow menu > Export flow... > **PowerPoint slide (.pptx)**) and over MCP (tool `export_pptx`).
- Zero dependencies, no build step, same builder in browser and Node.

## Non-goals
- No slide per Beat, no Morph transition.
- No caption band (label/route/detail text); the video export keeps that.
- Edges are not glued to Nodes: moving a Node in PowerPoint leaves its Edges where they are.
- No compression: the zip is written uncompressed (STORE). Files are a few tens of KB larger; accepted.
- No import of an edited `.pptx` back into a Flow.

## Behaviour
- Slide: 16:9, the diagram scaled to fit below a small title text box with the Flow title. Colours follow the viewer's current theme (light or dark) and palette; MCP defaults to light and accepts `theme: "dark"`.
- Nodes: `box` -> rounded rectangle, `database` -> cylinder, `queue` -> rectangle with slot dividers (grouped). Label and subtitle are the shape's text. Groups are rectangles behind their Nodes with the Group label.
- Edges: freeform curves that follow the routed path exactly (lines, quadratic and cubic curves), with an arrowhead, in the base (not yet played) style.
- Each click = one Beat. For every Step in the Beat, together:
  1. a Packet (small circle) appears at the Edge start and moves along the Edge (motion path, about 1.3 s, eased);
  2. a Trail copy of the Edge (highlight style) fades in and stays for the rest of the slide show;
  3. the Step label appears beside the Edge as the Packet starts moving, and stays;
  4. the Packet fades out on arrival.
- Before the first click the slide shows the static diagram only (no Trails, no Step labels).
- The viewer export also follows the line thickness, step style (by kind, solid, dashed, dotted), labels on/off and the viewer's own Step label placement. MCP uses the defaults (1.5 px, by kind, labels on, simple midpoint placement).
- Orientation, connection style, node spacing and optimize-layout follow the viewer settings; MCP uses the Flow's own layout settings.
- File name: Flow title, like the other exports (`order-submission.pptx`).
- MCP `export_pptx { file, theme? }` returns the file as an embedded resource (base64 `blob`, mimeType `application/vnd.openxmlformats-officedocument.presentationml.presentation`). Works over stdio and HTTP.

## Domain language
None. (Packet, Trail, Beat, Step label are existing terms.)

## File-format impact
None.

## Open questions
- Very large Flows get small on one 16:9 slide; no paging. Revisit if it hurts.
- Motion-path rendering in PowerPoint for the web, Keynote and LibreOffice is not guaranteed; desktop PowerPoint (Windows, Mac) is the target.
- Architecture: Distribution gets a `src/` folder; Playback and the MCP server call its public API (new allowed edges, see plan).
