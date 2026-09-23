# FIX-1497 · Documentation draft

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs**

## No reader-facing impact, and here is the specific reason

This issue **changes no behaviour**. It adds one goal check and the lab it drives, entirely under
`goals/`, a private workspace package that ships to nobody. Every door the scenario uses is
already documented: filing onto a channel's board, a seat draining its share, parking a row for
review and resuming it, and inspecting a session's Tasks tab. A reader who follows today's pages
gets exactly today's behaviour before and after this lands.

Concretely, nothing changes on the surfaces that would otherwise owe prose:

- **No public API changes**, so no `packages/*/README.md` is touched and no changeset is written
  (BP-022 — `goals/` is private).
- **`TaskStatus` is unchanged** (BR-20), so nothing in the task-board pages moves.
- **The DevTool's task-board prose is [FIX-1481](https://linear.app/fixpoint-labs/issue/FIX-1481)'s
  and already drafted** — [#2032](https://github.com/fixpoint-labs/flow-state-dev/pull/2032)
  carries the *Task boards* section that explains the Reason column. This proof reads that
  rendering; it does not describe it, and a second description of one field is how two pages start
  disagreeing.

"Docs later" is not what this says. There is no reader-facing delta to defer.

## Two artifacts this issue does own, which are not documentation

Named here so a reviewer does not read their absence above as an omission:

| Artifact | What it carries |
|---|---|
| `goals/multi-seat-collab/it-hands-a-row-between-two-seats-in-view/goal.md` | The contract and the verdict log — outcome, held-out input, the signal, the anti-game paragraph, every control with the leg it must fail, and one dated row per run. This is the proof's own record, and the epic's [ER-Collab](../../epics/FIX-1457/BUSINESS-RULES.md#er-collab) cell will cite it |
| `goals/multi-seat-collab/lab/README.md` | What the lab owns rather than the framework, and what it works around — in the shape `goals/devforce-lab/lab/README.md` and `goals/manager-queue-lab/lab/README.md` already use |

Both are internal engineering artifacts under a private package. They follow the `goals/` corpus
conventions, not the published-docs voice.

## Where the epic's docs obligation actually lands

[ER-21](../../epics/FIX-1457/BUSINESS-RULES.md) wants the docs to teach Workforce as something you
**run, watch and prove**, and the person as **someone the work asks a question of** rather than a
second kind of worker. That is a corpus-level change across the Workforce and DevTool sections,
and the epic assigns it to *"whichever children ship the proofs, plus the wrap-time docs polish."*

**It is not drafted here, deliberately.** ER-Collab is one of three proofs; a page written from
this issue's evidence alone would teach the collab half as the whole story, which is exactly
[ER-9](../../epics/FIX-1457/BUSINESS-RULES.md)'s failure mode. The honest input this issue gives
the wrap pass is its verdict log: a run that happened, with what was observed. Publication ownership
for ER-21 stays with the epic.
