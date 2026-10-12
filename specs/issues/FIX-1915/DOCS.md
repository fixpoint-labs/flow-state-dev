# FIX-1915 · Documentation draft

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs** · [Evolution](EVOLUTION.md)

The epic's shared story is in [its draft](../../epics/FIX-1907/DOCS.md). This issue publishes
"The run's plan" (drafted there, reconciled here), the Claude Code specifics, and Kitchen Sink's
Claude Code section. PR-A publishes the first four; PR-B the last two.

## CREATE · `apps/docs/docs/tools/coding-agents.md` · section "The run's plan", after "The handle"

Replaces the epic's draft of the same section.

> ## The run's plan
>
> A coding agent often keeps its own to-do list while it works. A harness that reports one
> records it in a resource collection, `observed-plan`, separate from the run's items. The
> shape is the same whichever harness wrote it, and it lives in `@flow-state-dev/core`:
>
> ```ts
> import { OBSERVED_PLAN, observedPlanCollection, observedPlanItemStateSchema } from "@flow-state-dev/core";
> ```
>
> Each entry is one to-do item, keyed under the request and the run that wrote it, with its
> wording (`title`), the status the harness last confirmed (`status`), the one before
> (`previousStatus`), and how the last attempt to change it settled (`lastOutcome`). Every field
> can be `null`. A status is the harness's own word for it, so read it as text rather than
> matching a fixed list.
>
> Entries stream to an open page as they change, so a plan you show beside a session stays in
> step while the run works.
>
> A run's plan is a record of what the agent planned, not a work queue. Nothing in it starts
> work, and writing to it hands the agent nothing.
>
> Not every harness reports a plan. Read the session's resource manifest first. If it doesn't
> list `observed-plan`, the harness records none, and a reader should say so rather than show
> an empty list. If it does and a run wrote no rows, that run planned nothing it reported.
>
> To record a plan from a harness of your own, declare `observedPlanCollection` on the block
> and upsert rows under `<requestId>/<run>/<item id>`.

## UPDATE · `apps/docs/docs/tools/claude-code-sdk.md` · "Recording what the run did", replacing the paragraph that starts "The plan record reads the same way"

> The plan record reads the same way, from `observed-plan`. Its shape is the one every
> harness shares, described in [the run's plan](./coding-agents.md#the-runs-plan); importing
> `observedPlanCollection` from this package or from `@flow-state-dev/core` gives the same
> object. A to-do item's status is the harness's own word for it, and stays empty until the
> harness reports one. Plan entries reach an open page as they change, rather than when the
> request ends.

## UPDATE · `packages/core/README.md` · the harness contract list, after the `harnessEnv` bullet

> - The run's plan record, from the package root: `OBSERVED_PLAN`, `observedPlanCollection`,
>   `observedPlanItemStateSchema`, and the type `ObservedOutcome`. One shape for a coding
>   agent's own to-do list, which a harness that reports one declares and writes. A record of
>   what the agent planned, never a work queue. Guide: [the run's plan](https://flow-state.dev/docs/tools/coding-agents#the-runs-plan).

## UPDATE · `packages/claude-code/README.md` · "Recording what a run did", after the table

> The `observed-plan` shape is defined in `@flow-state-dev/core` and re-exported here, so
> either import gives the same object. Its entries stream to an open page as they change.

## UPDATE · `apps/kitchen-sink/README.md` · new section "Claude Code mode", after "The page (`app/`)"

> ## Claude Code mode
>
> Pick **Claude Code** to work a Claude Code session the way you would on its own. Each turn
> continues the same Claude Code conversation, its steps show while it works, and its to-do
> list sits beside it.
>
> It runs on your machine, through the Claude Code Agent SDK, signed in the way Claude Code is
> on its own. Sign in with the `claude` command first. A host that isn't signed in, a host
> without the SDK, a server running as root, or a machine where Claude Code's sandbox isn't
> available shows the mode as unavailable, with the reason.
>
> **Where it works.** Each session gets its own empty directory under one root, and every turn
> of that session works there. The root is `KITCHEN_SINK_HARNESS_WORKSPACE`, the setting that
> turns the harness modes on. Two sessions never share a directory. Claude Code runs without
> asking for approval, inside its sandbox: it can write only in the session's directory.
> Delete old session directories yourself when you no longer need them.
>
> **Continuing.** A session is one Claude Code conversation. Stop a turn and the next one picks
> up the same conversation. If Claude Code can't continue it, the session says so on every
> turn and keeps trying. A turn you stopped shows as stopped, not refused. It never quietly
> starts a new conversation; start a new session for that. If Claude Code answers in a different conversation of its own accord, the session says
> it started a new one and follows it.
>
> **The plan panel** shows what Claude Code recorded of its to-do list for the session's latest
> turn, read-only. Claude Code doesn't report its plan through the SDK yet, so the panel
> says "no plan recorded for this turn". Nothing in the panel starts work.
>
> Add `STORE_TYPE=filesystem` to keep sessions, and the conversations they're bound to, across
> a restart.

## UPDATE · `apps/kitchen-sink/README.md` · "Environment variables" table, the `KITCHEN_SINK_HARNESS_WORKSPACE` row FIX-1914 adds

> | `KITCHEN_SINK_HARNESS_WORKSPACE` | The directory the coding harness modes work in; each session gets its own directory under it. Unset, they're off. Ignored on Vercel, where they're always off. |

The opening paragraph's "in a directory you choose" (epic draft, published by FIX-1914) stays
true: the person chooses the root. No other page changes. The sentence "Claude Code doesn't
report its plan through the SDK yet" is removed when FIX-1185 makes the plan fill.
