# UI style guide

The viewer is one file (`index.html`). All UI follows these rules; new UI uses the tokens, not literal values.

## Tokens (`:root`)

| Token | Value | Use |
|---|---|---|
| `--sp-1` … `--sp-5` | 4, 8, 12, 16, 24 px | all gaps and padding |
| `--ctl-h` | 30 px | height of every button, select, text input and range |
| `--r-ctl` | 8 px | radius of controls |
| `--r-box` | 12 px | radius of panels, cards, dialogs |
| `--fs-sm`, `--fs` | 12, 13 px | secondary text, control and UI text |
| body | 15 px | descriptions and captions |

Colours come from the existing tokens (`--bg`, `--text`, `--text2`, `--line`, `--card`, `--hot`, `--sel`). Never hard-code a colour; light and dark themes both must work.

## Rules

1. **Controls**: all buttons, selects and text inputs are `--ctl-h` high with `--r-ctl` radius and the 13 px font. Small header buttons (26 px) are the only exception.
2. **Spacing**: use `--sp-*` only. Related items are 8 px apart, groups 12 px, sections 16 px.
3. **Panels**: a box has a 1 px `--line` border, `--r-box` radius, 12 px padding and `--card` background.
4. **Sections in a panel**: a small uppercase 11 px heading, separated from the previous section by a 1 px rule.
5. **Alignment**: label and control share a row on a fixed label column (88 px), controls fill the rest, values (`output`) are right-aligned. Button groups are equal-width grid cells. Checkboxes sit in one row with a 16 px gap.
6. **Placement**: the View panel sits beside the diagram (272 px). When space is short (below 1400 px while editing, below 760 px always) it stacks below the diagram and its sections run side by side.
7. **Fullscreen/Maximize**: the panel stays beside the diagram and scrolls on its own.
8. **Focus**: a 2 px `--hot` outline with 2 px offset on every focusable element.
9. **Motion**: respect `prefers-reduced-motion`.
10. **Labels**: sentence case, one or two words (`Step style`, `Zoom and view`).

## Adding UI

Use the tokens, reuse the existing classes (`.vpsec`, `.vpfield`, `.vpbtns`, `.ef`, `.erow`, `.menupop`) and check light/dark, narrow and Edit mode in a browser.
