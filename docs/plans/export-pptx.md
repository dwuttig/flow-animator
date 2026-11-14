# Plan: Export as PowerPoint slide

- Status: done
- Spec: [../features/export-pptx.md](../features/export-pptx.md)
- Bounded context / slice(s): Distribution / `export-pptx`; wiring in Playback (`flow-menu`, `viewer`, `index.html`) and `mcp-server.js`

## Approach
A pure UMD slice `src/distribution/export-pptx/export-pptx.js` writes the PresentationML parts as strings and packs them with its own STORE-only zip writer (CRC-32 table, local headers, central directory). Input is the already computed model, Geometry and Beats, so the viewer exports exactly what it shows; `fromFlow` adds parse + normalize + layout for the MCP server. Colours come from `RenderDiagram.PAL` (Distribution may use any public API).

Animation: one slide, one click-group per Beat. Per Step: packet `p:animMotion` (path relative to slide size, start = Edge start), Trail shape entrance (fade), Step label entrance (after previous), packet exit (after previous). Trail-as-overlay-shape was chosen over animating the base Edge's colour/weight because entrance effects are the most reliably supported.

Alternatives rejected: slide per Beat + Morph (user chose one slide), elbow connectors (route would differ from the viewer), compression via zlib/CompressionStream (async, two code paths).

Public API:
```
ExportPptx.build({ model, geo, beats, theme: 'light'|'dark', title }) -> Uint8Array   (pure)
ExportPptx.fromFlow(doc, { theme, layout }) -> Uint8Array                          (parse/normalize/layout/beats + build)
ExportPptx.zip([{ name, data: string|Uint8Array }]) -> Uint8Array                    (STORE)
ExportPptx.crc32(Uint8Array) -> number
ExportPptx.MIME
```

## Steps
1. [x] Architecture: add `'distribution': ['src/flow-modeling/', 'src/layout/', 'src/playback/render-diagram/', 'src/distribution/']` to `test/architecture.test.js`; document the edges Distribution -> Modeling/Layout/render-diagram and "Playback and the MCP server call `export-pptx`" in `docs/architecture.md`.
2. [x] `zip` + `crc32` test-first (known CRC vectors; parse the produced archive back: signatures, entry names, sizes, CRCs).
3. [x] `build` test-first: required parts present (`[Content_Types].xml`, `_rels/.rels`, `ppt/presentation.xml`, slide, layout, master, theme, rels); every XML part well-formed; one shape per Node/Group/Edge/Trail/Step label/Packet; one click `p:par` per Beat; Steps of a `together` Beat in the same click; XML escaping of labels (`&<>"'`, non-ASCII as UTF-8); coordinates scaled into the 16:9 slide.
4. [x] `fromFlow` test with `examples/order-flow.flow.json`.
5. [x] Viewer: script tag in `index.html` (after render-diagram), menu entry in `flow-menu` export list, `exportPptx` action in `viewer.js` using the shown model/Geometry/Beats and current theme, `ExportFlow.fileName` gets `pptx`.
6. [x] MCP: tool `export_pptx { file, theme? }` in `mcp-server.js`, returns `{ type: 'resource', resource: { uri, mimeType, blob } }`; test in `test/mcp.test.js`.
7. [x] Distribution: Dockerfile `COPY` for viewer and `mcp` stages (mcp also needs `src/playback/render-diagram/`); standalone bundle picks it up via the page manifest.
8. [x] Docs: README (export + MCP tool), CHANGELOG, spec/plan status.

## Files touched
`src/distribution/export-pptx/*`, `test/architecture.test.js`, `docs/architecture.md`, `index.html`, `src/playback/flow-menu/flow-menu.js`, `src/playback/viewer/viewer.js`, `src/playback/export-flow/export-flow.js`, `mcp-server.js`, `test/mcp.test.js`, `Dockerfile`, `README.md`, `CHANGELOG.md`.

## Risks
- PowerPoint is strict: one malformed part triggers "PowerPoint found a problem with content / repair". Unit tests check well-formedness, not schema validity; a manual open in desktop PowerPoint is mandatory.
- Motion path units (fraction of slide width/height, relative to the shape's position) must be checked in real PowerPoint.
- `render-diagram` must stay loadable in Node (it already is, it has Node tests).

## Verification
`node --test`, `npm run lint`; export `examples/order-flow.flow.json` from the viewer and over MCP, open in desktop PowerPoint without repair prompt, play the slide show: one Beat per click, Packets follow the Edges, Trails and Step labels stay; edit a Node's text to confirm shapes are native. `docker-smoke-test` for the image changes.

## Changelog entry
Added: Flow menu > Export flow... > **PowerPoint slide (.pptx)** and MCP tool `export_pptx`: one native, editable slide whose click-driven animation plays the Flow Beat by Beat.
