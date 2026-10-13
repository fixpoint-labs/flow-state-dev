# FIX-1907 · Plan

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · **Plan** · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

An epic plan sequences the work and says what each piece entails. It does not say how to build
any piece; that's each issue's own plan. IDs cross-reference [DECISIONS.md](DECISIONS.md) (D-n)
and [BUSINESS-RULES.md](BUSINESS-RULES.md) (ER-n).

## The path

![The path as of 12 October 2026. Inputs: FIX-1735 and FIX-1701, both done. This epic spec in review at the now line. FIX-1914 the picker: spec, then implementation; the Flow State question is settled (keep, from Jake's merge of #3167). FIX-1915 Claude Code mode: spec beside FIX-1914's, implementation after FIX-1914 merges. FIX-1916 Codex and FIX-1917 Cursor: specs beside, implementations side by side after FIX-1915 merges. FIX-1185 Claude plan tools: one bar that can run at any time. The closure FIX-1918: QA plan written early, run after all merge. The critical path runs from this spec through FIX-1914, FIX-1915, the Codex and Cursor implementations, then the closure run](figures/path.svg)

A chain with one fork. The picker and the session flow factory are serial, because the flow needs a mode
slot to live in. Codex and Cursor are the one parallel window, and FIX-1185 is a diagnosis that can
run beside anything. The dependency graph is in [the spec](SPEC.md#how-the-issues-flow-into-each-other);
this adds time.

## What each issue entails

| Issue | Route | Consumes | Delivers | Releases | Size |
|---|---|---|---|---|---|
| **FIX-1914** the picker | spec → impl PR | The Flow State answer, settled: keep ([D](DECISIONS.md#flow-state-mode), Jake's merge of #3167) · today's shell (`app/page.tsx`, `FlowNavigator`) | Four modes, a rail per mode, the unavailable state, Flow State mode | FIX-1915 | Medium |
| **FIX-1915** Claude Code mode | spec → impl PR | A mode slot · FIX-1735's live items · FIX-1701's `itemScope` · D2, D3 | The harness session flow factory and the `claude-code-session` kind, the workspace resolver, stop, the plan record in core, the plan panel | FIX-1916 · FIX-1917 | Large |
| **FIX-1916** Codex mode | spec → impl PR | The session flow factory · the plan record (ER-5, ER-6) | The `codex-session` kind and Codex options · Codex writes its to-do list | The closure | Small |
| **FIX-1917** Cursor mode | spec → impl PR | The session flow factory · the plan record | The `cursor-session` kind and Cursor options · Cursor's plan written, or "reports none" · the Cursor package's `env` option, which filters the runtime's environment, not a security boundary (ER-11) | The closure | Small |
| **FIX-1185** Claude plan tools | spec (no Kind label) → impl PR or written finding | The SDK driver in `@flow-state-dev/claude-code` | Plan tools that fire through the SDK, or the reason they don't | The closure | Small, uncertain |
| **FIX-1918** closure · required | spec (the QA plan) → runs until one is clean → PR | Every other child, merged, on one `main` commit | The committed browser check under `goals/`, a QA report, a bug child per failure | The epic's wrap | Medium, repeats per retest |

## Where it is

[The set table](SPEC.md#the-set--as-of-2026-10-12) is the review-time snapshot; follow its Linear
and PR links for current state. Both inputs from other work are shipped: FIX-1735 (#2654) and
FIX-1701 (#2569).

## What unblocks what, from here

1. **This spec merges** (the Flow State question is settled: keep, from Jake's merge of #3167) →
   FIX-1914's spec starts; FIX-1915, FIX-1916, FIX-1917 and FIX-1185 can be specced at once, and
   the closure's QA plan written.
2. **FIX-1914 merges** → FIX-1915 implements.
3. **FIX-1915 merges** → FIX-1916 and FIX-1917 implement side by side.
4. **All of them and FIX-1185 merge** → the closure's first run. Each finding is a child that blocks
   it; when the last merges, the whole plan runs again on a fresh `main` commit.
5. **A clean run** → the closure PR. Its merge → wrap: lessons pass, docs polish over Kitchen Sink's
   README and the three harness pages, and a completion report in Linear.

## Coordination seams to watch

| Seam | Between | Rule |
|---|---|---|
| The plan record's shape in core | FIX-1915 defines; FIX-1916, FIX-1917, FIX-1185 write or fill it | One shape. A field one harness needs is raised to the epic (ER-15), not added locally |
| The session flow factory's kind and options per harness | FIX-1915 and FIX-1916, FIX-1917 | A harness that needs more than options has found a gap in its package (ER-6, ER-11) |
| The rail and the mode slot | FIX-1914 and FIX-1915 | FIX-1914 owns the picker and the rail; FIX-1915 fills its mode's slot |
| Kitchen Sink's README | FIX-1914 and each mode | FIX-1914 writes the opening; each mode adds its own section and links the rest |
| `@flow-state-dev/claude-code`'s recorder | FIX-1915 (moves the shape) and FIX-1185 (makes it fill) | Whichever lands second rebases on the other; neither changes the other's half |

## Not children, deliberately

FIX-1735 and FIX-1701 (shipped inputs) · FIX-1179 (re-delivery on a queue) · FIX-1340 (the coding
skill's flow, prior art) · Shift Manager's epics FIX-1786 and FIX-1650. Linked, never re-parented.

## Wrap

When ER-16 holds: run the lessons pass, dispatch docs polish over Kitchen Sink's README and the
three harness pages, and report the outcome from Linear and implementation evidence. A design
change found at wrap goes in a follow-up PR, not a final status commit.
