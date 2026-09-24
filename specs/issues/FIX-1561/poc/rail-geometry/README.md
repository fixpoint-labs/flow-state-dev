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
The slots are the developer tool's own: its `Button`, its `lucide-react` icons and its class
strings, copied from `flows/flow-rail.tsx`, with the Tailwind they need compiled by the tool's
own toolchain. So the icon sizes measured here are the ones the owner saw.

`measure.mjs` bundles it, opens it in headless Chromium, expands every row, and measures where
each label's first character lands, where the notes start, whether each host action shares a
line with a row, how large each icon is actually drawn, where each tree line sits, and whether
long labels fit a narrow rail. Then it runs the assertions `PLAN.md → VG` proposes.

`sketch/FlowNavigator.sketch.ts` is a copy of the real component with the proposed layout
applied, tree lines included. It exists to show the check going green and to screenshot the two
reveal options. It is not the implementation.

## How to run it

From the repository root, after `pnpm install` and
`pnpm exec turbo run build --filter=@flow-state-dev/react...`:

```bash
P=specs/issues/FIX-1561/poc/rail-geometry/measure.mjs
node $P                                                  # today's component and today's icons
node $P --variant always --icons equal                   # sketch, actions always shown, icons fixed
node $P --variant hover --icons equal --hover support.ada
node $P --long --width 256                               # G7, today
node $P --variant always --icons equal --long --width 256          # G7, sketch
node $P --variant always --icons equal --long --width 256 --break  # G7's negative control
```

Add `--shot <file.png>` to save a screenshot. Exit code 1 means the goal check failed.

## What it showed

| | today | sketch, icons fixed |
|---|---|---|
| G1 · host actions on a line of their own | **12 of 17** | 0 of 17 |
| G2 · label x spread within one level | level 2: **16px** (the channel at 20, instances at 36) | 0 everywhere |
| G3 · step between levels | **12px, then −4px** (sessions at 32 sit left of instances at 36) | 16px, 16px |
| G4 · empty note on its level's column | passes (32 = the session column) | passes (56) |
| G5 · spread of the icons' drawn size | **4.0px** (copy 13.3, refresh 12.0, plus 9.3; every box 16px, every hit area 20px) | 0.0px (all 11.0; hit areas 20px) |
| G6 · open parents with a tree line on their twisty's centre | **0 of 9** | 9 of 9 (x 13 and 29, on the 16px grid) |
| G7 · at 256px, long labels ellipsized, nothing overflowing | passes (2 of 2) | passes (2 of 2); **fails with `--break`**: 0 of 2, 2 rows and the rail overflow |
| lines the tree takes | 22 (6 of them actions only) | 16 |

The check fails on today's layout for the reasons the owner saw, and passes on the sketch with
no change to how or when sessions are read.

Two passes today need reading. G4 passes only because the note and the session labels are
misplaced by the same amount. G7 passes because today's actions sit on their own line, so
nothing competes with a long label yet; the negative control is what shows it can fail. Both
stay as guards on the fix.

G5 is measured on the drawing, not the box, because the boxes already match: the tool declares
`h-3 w-3`, but its button's `[&_svg:not([class*='size-'])]:size-4` rule makes every icon 16px.
With the layout fixed and the icons left alone, G5 still fails at 4.0px. `--icons equal` sizes
each icon so its drawing covers 11px, with one absolute stroke, set inline so the rule can't
override it.

In the hover screenshot, `support.wren` also shows its actions: it was the last row the script
clicked, so keyboard focus is still inside it. That is the focus rule working.

Screenshots: [`../../assets/today-rendered.png`](../../assets/today-rendered.png),
[`../../assets/after-always.png`](../../assets/after-always.png),
[`../../assets/after-hover.png`](../../assets/after-hover.png).
