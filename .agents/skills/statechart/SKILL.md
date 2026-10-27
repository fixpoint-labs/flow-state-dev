---
name: statechart
description: Draw an orchestration state machine as a Mermaid statechart from a TLA+ model. Each bug is a numbered path to a state that breaks a rule, then replayed on the real code. Scoped to Task status, holds, notice records, and the issue-multi-pr assemble phase. Use for /statechart or when a concurrency bug needs a path, not a paragraph.
disable-model-invocation: true
argument-hint: "<task-status | holds | notice | assemble | (empty = pick the one the bug lives in)>"
---

# Statechart

A chart of how one orchestration machine moves between states, in the words of
the person who has to decide whether the behavior is right. Each rule is an
invariant. Each bug is a numbered path to a state that breaks a rule. Then the
path is replayed on the real code, through real entry points.

This is a **dev-time** tool. It does not add a runtime statechart API, and it
does not rewrite the TypeScript. Sequencers, blocks, and flows are a composition
DSL, not this skill's subject.

> **Attribution.** The method (reader-word labels, from-spec / from-chart, each
> bug as a numbered path, replay on real entry points, work in a scratch dir)
> is adapted from the MIT-licensed **pstack** `statechart` skill by Lauren Tan
> — <https://github.com/cursor/plugins/tree/main/pstack/skills/statechart>.
> Adapted here for FSD: scoped to the four machines below; scripts stay
> upstream and run outside the repo.
>
> The upstream copyright and permission notice is retained in
> [`LICENSE.upstream`](./LICENSE.upstream). Keep the two together if either
> ever moves.

## Not this skill

| Job | Use instead |
|---|---|
| A spec figure that is not a state machine | [`spec-figures.md`](../../../docs/contributing/spec-figures.md) — Mermaid is already the default |
| "How does X work" | `graft`, `zoom-out` |
| A one-off concurrency bug with a known repro | `diagnose` — come back here if the machine itself is the thing to pin |
| Formal-verification skill authoring | Not in this repo yet; do not invent one from this skill |

## Only these machines

Anything else is out of scope. If the bug is not in one of these, stop.

| Machine | File | Why it is here |
|---|---|---|
| Task status | `packages/orchestration/src/tasks/schema/task-status.ts` — 7 statuses, `ALLOWED_TRANSITIONS`, `isTransitionAllowed` | Rules like "terminal stays terminal" and "a late worker cannot overwrite a settlement" |
| Holds | `packages/orchestration/src/inbox/holds.ts` | Concurrent waits and lapses |
| Notice records | `packages/orchestration/src/tasks/notice/task-notice.ts` | Delivery claims; the file cites a stack of FIX ids (2082, 2113, 2123, 2149, …) |
| Assemble phase | `.agents/workflows/issue-multi-pr.js` → `assembleState` | The comment on that function says ad-hoc predicates caused two opposite bugs in as many rounds |

Epic lifecycle phases (`NEEDS_SPEC`, `AWAITING_OBJECTIVE`, `EPIC_WRAP`, …) are
**not** in scope. They are a coordinator script, not a concurrency machine.

## Tooling — scratch dir, scripts stay upstream

Do **not** vendor pstack's scripts or install TLC into this repo.

1. Work in a scratch folder **outside** the repo. The command writes next to its input.
2. Fetch the upstream scripts into that folder:
   ```bash
   git clone --depth 1 --filter=blob:none --sparse https://github.com/cursor/plugins.git /tmp/pstack-statechart
   cd /tmp/pstack-statechart && git sparse-checkout set pstack/skills/statechart
   ```
3. Run `node pstack/skills/statechart/scripts/statechart.mjs --help` from there.
   The first run installs TLC and Java with mise (~305 MB, needs the network).
   The help's TLC section tells how to use a TLC and Java you already have.
4. Point the model at a **copy** of the relevant FSD file, never at the live
   checkout. Tie every variable and action to `file:line` in a comment on the
   condition, as in `\* task-status.ts:124`.

## Pick the direction

- **`from-spec`** when the TypeScript is concrete enough to model (the usual
  case here — all four machines exist).
- **`from-chart`** when people should agree on the chart before anyone changes
  the machine. Draw the chart, add one `%% never` line per rule, then generate
  the TLA+ skeleton.

If a TLA+ spec already exists for the machine, start from a copy of it. To
audit the code against that spec, make the copy model what the code does, and
pass the spec unchanged as `--against`.

## Spec to chart

1. Choose few states. Label each with what a reader can observe ("lease held,
   write pending", "goal failed, no gap filed") — not variable names. Split a
   state only when the split separates two bugs, or when a step leaves the
   label the same.
2. Write each rule the reader agrees to as one invariant, with the reader's
   sentence as its comment. If the model has no variable for what a rule is
   about, add the variable. Do not drop the rule. Never weaken a rule to make
   the chart pass.
3. Run `from-spec`, fill in the mapping file (`state`, `step`, optional
   `readerActions`, `cause`, `group`). Add `--cover` when the overview is too
   large. Pass a proposed fix as `--fixed`.
4. Render each chart with `--png` and look at every PNG. If a label reads like
   code, fix the mapping and rerun.
5. **Replay each bug on the real code.** Drive only entry points a worker, a
   client, or another part of the system reaches. Assert only what they can
   observe. A test that asserts a flag it sets, or that searches the source
   text, proves nothing. If a bug does not reproduce, assume the **model** is
   wrong until you show otherwise. Fix the model, not the rule.

## Hand off

Give the PNG and the Mermaid source to the person who must decide. One line
per bug: the rule it breaks, its steps as the chart numbers them, whether it
reproduced, whether the proposed fix fixes it. Take every count from
`summary.json`. Attach `stories.md` and the command that regenerates everything.
Say what the model leaves out.

Do not open a PR that refactors the runtime from this skill. A finding becomes
a Linear issue (via `issue-manager`) or a note on an existing one.

## Guardrails

- **Orchestration only.** A sequencer `.doWhile` is not a statechart.
- **Scratch dir only.** No TLC, no Java, no generated TLA+ in the repo.
- **Replay or recant.** A path that was not driven on real entry points is a
  sketch, not a bug report.
