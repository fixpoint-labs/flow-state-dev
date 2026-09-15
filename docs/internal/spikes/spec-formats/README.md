# Spike · four shapes for the spec, plan, PR body, and explainer

**The problem.** Reading a spec or a PR description costs a book. FIX-1366's spec is 5,545 words of prose; its PR body is about 1,100 more; the explainer beside them is the only part anyone reads in one sitting. The content is right. The shape charges the reader for the author's effort.

**This spike** rewrites FIX-1366 ([PR #1765](https://github.com/fixpoint-labs/flow-state-dev/pull/1765)) four times, each as a **set**: PR body · spec · plan · explainer. Same facts, same three decisions, same open call. Each set makes one bet about what carries the meaning, and the spec/plan split is applied in all four.

| Folder | The bet | Spec carries | Plan carries | Explainer |
|---|---|---|---|---|
| [`a-form/`](a-form/) | A spec is a **form**. Fixed fields, each a line or a table | Problem table · one before/after diagram · surfaces table · R table · D table · evolution table | Steps table with a verify column · reference tables · a *Don't* table | Folded: the one diagram is in the spec |
| [`b-diagram-first/`](b-diagram-first/) | The explainer's format **is** the spec's. A diagram per section, ≤ 40 words under each | 6 diagrams: today · after · what's touched · decision tree · boundary · evolution | Step DAG · writer's brief · inventory tree · fence · Atlas decision flowchart | Merged: the spec is the explainer |
| [`c-traceability/`](c-traceability/) | The reader wants **R → D → S → V to line up**. IDs everywhere | Context · goal · R table with *met by* · D cards (instead of / because / locks in / serves) · news · out-of-scope with owners | Surfaces S1–S5 · checks V1–V7 · sequence matrix · guardrails | **Kept, unchanged, as the control** |
| [`d-journey/`](d-journey/) | Change is understood as **what a person sees before and after**, and the repo as a diff | Three-readers table · front door as a `diff` · reference as a `diff` · *Why not…* Q&A · what stays · sign-off lines | Per-surface before / after / check cards · order · greps · the fence as page prose | Folded |

Read each folder in the order a reader meets them: `PR.md` → `SPEC.md` → `PLAN.md`.

## Measured

Prose words, fenced blocks excluded. So B's diagrams and D's diff blocks are **not** counted, and both read longer than the number.

| | Spec | Plan | Spec + plan | PR body | Explainer | Diagrams (set) |
|---|---|---|---|---|---|---|
| **Today** (PR #1765) | 5,545 (Parts I + II) | — | 5,545 | ≈1,100 | 153 | 4 |
| **A · form** | 815 | 803 | 1,618 · **29%** | 391 | 0 | 2 |
| **B · diagram-first** | 364 | 366 | 730 · **13%** | 205 | 0 | 13 |
| **C · traceability** | 801 | 772 | 1,573 · **28%** | 333 | 194 | 3 |
| **D · journey** | 653 | 626 | 1,279 · **23%** | 278 | 0 | 0 |

## What each one is good at, and what it drops

| | Best at | Drops or strains |
|---|---|---|
| **A** | Scannable in one screen per section. Nothing to interpret. Easiest to template | Decisions in a table lose the *because*. The live fork still needs prose, and a table beside it makes the fork look like a fourth row |
| **B** | The shortest read by far. The plan-as-DAG and the Atlas *fix or leave* flowchart are the two best single artifacts in the spike | Three of its diagrams are lists in boxes (§3, §7, §8). A reviewer can't diff a diagram in a review thread. Reasoning survives only as edge labels |
| **C** | The implementer's and the bot's favourite: every requirement names its decision, surface, and check. The D cards are the best decision format here | IDs are the "bare number" failure the guidance warns about. A cold human reads R6 · S1 S2 S3 S4 · V1 as a puzzle. The explainer beside it now repeats the spec's own decision tree |
| **D** | The most human. The three-readers table and the *Why not…* Q&A carry the design thinking in plain language with no vocabulary to learn. The `diff` blocks show a docs change exactly | No IDs, so a bot can't cite a row. A `diff` of a *code* change would drift into the pseudo-code the template warns against. Plan cards are wordier than a table |

## What all four give up, on purpose

- **The evidence behind an instruction.** The original says *don't "fix" the `agentRegistry` pages* and then proves it across four file citations and a compile check. All four prototypes keep the instruction and one clause of why. If a reviewer re-raises it, the proof is in the old thread, not the doc. Tenet 6 says a doc that drops its reasoning is worse, not shorter. These drop the *derivation*, not the reason. Whether that line holds is the thing to watch on a real review round.
- **The spec's own defence of its grep scoping, its Atlas budget, its rename rationale.** Each is now one line. Two review rounds of accretion are gone with them.
- **One Linear mirror becomes two.** BP-037 mirrors the spec to a Linear document. A split means the plan is mirrored too, or lives only on the PR.

## Recommendation

**Take D's spec, C's decision cards, and B's plan. Drop the explainer.**

- **Spec = D + C's cards.** The three-readers table is the fastest way I found to say what changes for whom. The `diff` block is right for docs work and for API-surface changes, and should be *forbidden* for internals (that's the pseudo-code trap). Swap D's *Sign off* lines for C's cards, because *because* and *locks in* are the two lines that keep tenet 6 honest, and D's one-liners lose the first.
- **Plan = B.** A step DAG with a verify table beside it is more legible than any of the step tables, and the *fix or leave* flowchart is the shape every bounded-sweep instruction should take. Keep B's reference tables as tables, not trees: the inventory tree in B's plan is a list in boxes.
- **PR body = D's table + A's sign-off table.** Under 300 words, one diagram at most, decisions as a 3-row table with *instead of* and *locks in*. This breaks `pr-reviewer-guidance.md`'s *never a table* rule for ratified decisions on purpose. Keep the rule for a **live fork**: the six-part prose shape stays.
- **Explainer: retire it at issue altitude.** In A, B, and D nobody misses it. In C, where it was kept, panels 1–2 restate the spec's first two sections and panel 3 restates the decision cards. Keep it at **epic** altitude, where *the set* and *the path* have no other home.

**What would change my mind.** A real review round. If bots on a table-shaped decision list produce more off-altitude findings than they do today, the *because* column isn't enough and the cards need a sentence more. If the user reads mostly on a phone, B's diagrams lose and A's tables win.

**Cost of being wrong: low.** These are templates. A bad pick costs one issue's spec written twice.

## If a shape is picked, what changes

1. `docs/contributing/spec-template.md` → two files: a spec template and a plan template. Budgets: spec ≤ 700 prose words, plan ≤ 700, PR body ≤ 300.
2. `issue-spec` Step 6 writes both files: `spec/<ID>.md` and `spec/<ID>.plan.md`, same never-merged branch.
3. `pr-reviewer-guidance.md` → the layout shrinks to: reader table · how · sign-off table · live fork (prose) · look here · links · collapsed contract.
4. `spec-explainer` → epic-only. `issue-spec` stops dispatching it.
5. `writing-for-humans.md` gains the diagram and table rules the winner relies on: *no list in boxes*, *diff blocks for surfaces, never for internals*, *decisions as cards or a table, forks as prose*.
6. `issue-implement` reads the plan, not Part II.
