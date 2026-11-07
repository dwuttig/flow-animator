---
name: grill-with-docs
description: Interview the user about a feature idea or design, in rounds, until they and the agent share one understanding, recording resolved terms in docs/ubiquitous-language.md and decisions in the feature spec. Use only when the user invokes it or has an unclear idea before a spec. Adapted from the aihero.dev skill of the same name.
---

# Grill with docs

Align on an idea before writing a spec or code. The user owns the scope; this is a conversation, not a form.

## How
1. Read first: `docs/architecture.md`, `docs/ubiquitous-language.md`, relevant `docs/features/*.md`, and the code. Never ask a question the repo can answer.
2. Ask in rounds: a short batch of questions whose prerequisites are already answered, then wait for answers, then the next round. Stop when no open questions remain. If the session grows very long, the scope is too big: split it.
3. Probe how things fail: format impact (`flow-animator/1` additive or breaking?), which bounded context is upstream, agents-never-specify-coordinates, zero dependencies and no build step, browser and Node both working, Docker and standalone bundle impact, concurrent edits (revisions).
4. Challenge terms that conflict with the glossary. When a term is resolved, add it to `docs/ubiquitous-language.md` immediately: vocabulary only, no implementation detail.
5. Record only decisions that are hard to reverse, would surprise a newcomer, and involve a real trade-off. Put them in the feature spec (`docs/features/<name>.md`, "Open questions" and "Behaviour"). The rest stays in the conversation.
6. Some questions (layout, feel) can't be settled by talking: suggest a throwaway prototype, then continue.
7. Hand off in the same conversation to the `add-feature-slice` skill to turn the settled understanding into spec and plan.

Do not start this unprompted, and do not write code during it.
