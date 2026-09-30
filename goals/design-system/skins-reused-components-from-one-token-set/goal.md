# design-system › it skins reused components from one token set

**Issue:** FIX-1655 (the App Lab design system; epic FIX-1649)

**Outcome:** An app installs FSD's registry components unedited, loads one stylesheet, and every one of them takes that stylesheet's look, light and dark. With no stylesheet loaded, the same components show FSD's neutral defaults. "A person must act" gets the highlighter and nothing else does. A component that paints a fixed colour again is caught.

**Input:** a fresh host app, built on each run, that installs the sweep from this checkout's registry the way an app does: the registry is built with its own URLs pointing at a local HTTP server, and the shadcn CLI installs the sweep's items from it. The token defaults arrive as a dependency of the items that read them. The host page (`host/main.tsx`) renders every swept part in every state that carries a colour. That covers the 12 components this issue fixed, the stream cards the design shows (message, reasoning, code block, tool, approval, task plan), and the navigator, roster, board panels and seat detail from `@flow-state-dev/react`. Each part is tagged with what its colour means (`data-means`).

**Signal:** computed styles read in headless Chromium, four passes: no theme light and dark, App Lab light and dark (`@flow-state-dev/design-system/app-lab.css` imported after the host's own stylesheet).

(a) **a:neutral**: with no theme, every painted colour (text, background, borders, outline, svg stroke and fill) is a registry token default or the chrome's own fallback.
(b) **b:themed**: under App Lab light and dark, no painted colour is a registry default or a fixed Tailwind palette colour, every one is an App Lab value, every font is one of App Lab's families, and every corner is square (rounded-full pills excepted).
(c) **c:attention**: under the theme, the attention colour is on every part that waits on a person and on no other part.

**Anti-game:**
- The host's copies are checked against the registry sources **before** anything reads them. A pass on edited copies would prove the copies, not the skin.
- The host's stylesheets may hold no class selector except `.dark`. No rule is aimed at a component.
- Colours are graded by computed value, never by class name. Class names and source text are CI's job (`packages/ui/test/palette-census.test.ts`).

**Controls:**
- `GOAL_CONTROL=hardcoded-accent` puts `text-yellow-600` back on the awaiting icon in the host's copy of the tool card. b:themed must FAIL naming `tool:awaiting`.
- `GOAL_BASELINE=<ref>` swaps the host's copies of the 12 fixed files for that ref's versions. This is one-time evidence, not a recurring run: `origin/main` before this issue must FAIL b:themed.

**Three calls the check makes, and why:**
- **One CLI call for the sweep.** It runs `npx shadcn@latest add <every item URL>`, the same CLI `fsdev ui add` runs, in one call. `fsdev ui add a b c` runs it once per item, and a later item that shares an upstream shadcn primitive with an earlier one stops at an overwrite prompt.
- **Byte identity, with one allowance.** The CLI drops the comments above the first statement of a file that has no `"use client"` directive (the `.ts` helpers). Everything else must match byte for byte.
- **Palette colours App Lab itself uses.** App Lab's dark card `#1d1c16` is Tailwind's `olive-900` to within rounding, and a computed style cannot tell the two apart. A palette colour that is also an App Lab value is therefore not counted against b:themed. The source census is what keeps palette classes out of the components. Fixed colours are matched to within 1 per channel; App Lab values are matched to within 3.

The upstream shadcn primitives the CLI fetched (`button`, `select`, …) are replaced by the ones the registry's Storybook builds against. Upstream's now import an npm package (`cn`) this workspace does not have, and the primitives are not what this goal checks.

**Model:** n/a (model-free).

**Run:** `pnpm tsx goals/design-system/skins-reused-components-from-one-token-set/run.mts` (`GOAL_KEEP=1` keeps the host and the four screenshots).

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-09-30 | fix-1655-design-system (pre-PR) | n/a | PASS | 44 parts, 1,199 elements, 1,840 colours read per pass; 26 installed copies match the registry. a, b and c all pass. |
| 2026-09-30 | fix-1655-design-system, `GOAL_CONTROL=hardcoded-accent` | n/a | FAIL (expected) | b:themed failed on `tool:awaiting` only (`#d08700`, Tailwind yellow-600), light and dark. a:neutral and c:attention failed on the same part. |
| 2026-09-30 | fix-1655-design-system, `GOAL_BASELINE=origin/main` | n/a | FAIL (expected) | b:themed failed on 549 samples across 11 of the 12 fixed files (tool, approval, task-plan, audit-annotation, stuck-request-banner, file-tree, form, suspension-card-shell, debate, evented-actors, routed-specialists). The 12th, `question.tsx`, had fixed colours only on its focus outline and its validation error, and the page shows neither. |
| 2026-09-30 | fix-1655-design-system (first full run) | n/a | FAIL | Found two gaps, both fixed in this change. (1) Helpers shipped as `registry:lib` landed in the app's `lib/` while their components import them from beside themselves; the build now writes each file's `target`. (2) Bare `rounded` in five components is a fixed 4px in Tailwind v4, so a theme could not square it; those are now `rounded-sm`, the same 4px by default. Streamdown's inline code in `message.tsx` gets `[&_code]:rounded-sm` for the same reason. |
