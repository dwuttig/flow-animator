# Ubiquitous language

One vocabulary for code, docs, specs, agents and conversation. If a word here and a name in the code disagree, fix the code or this file in the same change. Terms are grouped by the bounded context that owns them (see [architecture.md](architecture.md)).

## Flow Modeling (core)
| Term | Meaning |
|---|---|
| **Flow** | One scenario: a set of Nodes, optional Groups and an ordered list of Steps. Stored as one `*.flow.json` file. Aggregate root. |
| **Node** | A component in the architecture (service, database, user...). Identified by `id`. |
| **Group** | A colour category that Nodes may belong to. |
| **Step** | One interaction: something travels from one Node to another. Order is meaningful. |
| **Beat** | A set of Steps that play together. Derived, never authored. |
| **Format version** | The `format` value (`flow-animator/1`). The published language other contexts depend on. |
| **Violation** | A validation error or warning with a `path` and `message`. |

## Layout (supporting)
| Term | Meaning |
|---|---|
| **Geometry** | Positions, sizes, edge routes and bounds computed for a Flow. Never authored; agents never specify coordinates. |
| **Edge** | A routed connection between two Nodes in the Geometry. |

## Playback (viewer)
| Term | Meaning |
|---|---|
| **Playback** | The running animation of a Flow: play, pause, step, scrub, speed. |
| **Packet** | The marker travelling along an Edge during a Step. |
| **Trail** | The already-completed Steps, kept visible. |
| **Editor mode** | Viewer mode with a panel to change the Flow through Edits. |
| **Sentence mode** | Editor style that shows a Step as a sentence whose underlined values are edited in place (like an Outlook rule description); the alternative is Fields. |
| **View settings** | Viewer-only rendering choices (orientation, connection style, step style, thickness, Maximize). Not stored in the Flow, except the default `layout.direction` and `layout.connection`. |
| **Draft** | The Flow being edited in the browser, not yet downloaded. Every change is a validated Edit; undo/redo walks the Draft history. |

## Flow Library (supporting)
| Term | Meaning |
|---|---|
| **Flow store** | Persistence behind the Flow Library and the operations on it (list, read, write, delete): a SQLite database (default) or a directory of flow files. |
| **Import** | Copying flow files from a directory into the SQLite Flow store; existing names are kept. |
| **Edit** | A single change to a Flow (add Node, move Step...). Applied, validated, then persisted, or rejected with Violations. |
| **Tool** | An MCP-exposed Edit or query. |
| **Flow name** | The unique, suffix-free name that identifies a stored Flow, e.g. `orders` (case-insensitive; a trailing `.flow.json` is accepted and stripped). |
| **Revision** | Content hash of a stored Flow, used to detect that it changed since it was loaded. |
| **Conflict** | A save or delete that carried an older Revision than the stored one; rejected, nothing written. |
| **Flow API** | The HTTP interface of the Flow Library (`/api/flows`). |

## Distribution (generic)
| Term | Meaning |
|---|---|
| **Standalone bundle** | One HTML file containing viewer, core and one Flow. |
| **Image** | The Docker artefact serving the viewer and/or MCP server. |

Avoid synonyms: say Node (not "component box" or "service"), Step (not "arrow" or "message"), Flow (not "diagram" or "scenario") in code and docs.
