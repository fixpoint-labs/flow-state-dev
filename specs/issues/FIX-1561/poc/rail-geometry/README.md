# POC · measure the rail on the rendered page

An experiment, not a supported API. Nothing here is imported by production code, and it is
outside default test, lint and knip discovery (`knip.json` ignores `specs/issues/*/poc/**`).

## The question

The owner found this problem by looking at a screenshot. Two checks in the repo already
guard the rail's indentation, and both pass on that layout. Can a check that measures the
**rendered** rail tell the broken layout from the fixed one?

## What it does

`harness.tsx` renders `FlowNavigator` with a fixture copied from the owner's screenshot:
`agent`, `desk-clerk` and `followup-runner` as collection kinds, `digest` as a singleton whose
one session is the `support.noticeboard` channel, and engine-minted session ids with no title.
The slots copy the developer tool's: a copy button on instance rows, and refresh plus new
session in `leafToolbar`, right-aligned.

`measure.mjs` bundles it, opens it in headless Chromium, expands every row, and measures where
each label's first character lands, where the notes start, and whether each host action shares
a line with a row. Then it runs the four assertions `PLAN.md → VG` proposes.

`sketch/FlowNavigator.sketch.ts` is a copy of the real component with the proposed layout
applied. It exists to show the check going green and to screenshot the two reveal options. It
is not the implementation.

## How to run it

From the repository root, after `pnpm install` and
`pnpm exec turbo run build --filter=@flow-state-dev/react...`:

```bash
node specs/issues/FIX-1561/poc/rail-geometry/measure.mjs                    # today's component
node specs/issues/FIX-1561/poc/rail-geometry/measure.mjs --variant always   # sketch, actions always shown
node specs/issues/FIX-1561/poc/rail-geometry/measure.mjs --variant hover --hover support.ada
```

Add `--shot <file.png>` to save a screenshot. Exit code 1 means the goal check failed.

## What it showed

| | today | sketch |
|---|---|---|
| G1 · host actions on a line of their own | **12 of 17** | 0 of 17 |
| G2 · label x spread within one level | level 2: **16px** (the channel at 20, instances at 36) | 0 everywhere |
| G3 · step between levels | **12px, then −4px** (sessions at 32 sit left of instances at 36) | 16px, 16px |
| G4 · empty note on its level's column | passes (32 = the session column) | passes (56) |
| lines the tree takes | 22 (6 of them actions only) | 16 |
| **exit** | **1 · FAIL** | 0 · PASS |

The check fails on today's layout for the reasons the owner saw, and passes on the sketch with
no change to how or when sessions are read. G4 passes today only because the note and the
session labels are misplaced by the same amount; it stays as a guard on the fix.

In the hover screenshot, `support.wren` also shows its actions: it was the last row the script
clicked, so keyboard focus is still inside it. That is the focus rule working.

Screenshots: [`../../assets/today-rendered.png`](../../assets/today-rendered.png),
[`../../assets/after-always.png`](../../assets/after-always.png),
[`../../assets/after-hover.png`](../../assets/after-hover.png).
