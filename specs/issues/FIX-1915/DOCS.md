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
> an empty list.
>
> Beside the entries, each run has a list marker in `observed-plan-list`, keyed by the run. It
> says whether the run's plan is `complete`, still `writing`, or `incomplete`, how many places
> it holds, and why it's incomplete. Read it before the entries:
>
> - `complete` with no places means the agent reported an empty list.
> - `incomplete`, or `writing` once the run has ended, means a write failed partway. Show what's
>   there as possibly incomplete, with the reason, not as the plan.
> - With a count, show only the places below it.
> - No marker and no entries means the run reported no plan.
>
> To record a plan from a harness of your own, declare `observedPlanCollection` and
> `observedPlanListCollection` on the block. If your agent reports its whole list each time,
> with no ids, hand it to `replacePlanList(plan, marker, runNamespace, items)`: it keys entries
> by place, keeps an entry's earlier status when its wording is unchanged, removes entries past
> the end, and writes the marker. Call it from one writer per run. If your agent reports items
> by id, upsert entries under `<requestId>/<run>/<item id>` and mark the run `incomplete` when
> a write fails.

## UPDATE · `apps/docs/docs/tools/claude-code-sdk.md` · "Recording what the run did", replacing the paragraph that starts "The plan record reads the same way"

> The plan record reads the same way, from `observed-plan`. Its shape is the one every
> harness shares, described in [the run's plan](./coding-agents.md#the-runs-plan); importing
> `observedPlanCollection` from this package or from `@flow-state-dev/core` gives the same
> object. A to-do item's status is the harness's own word for it, and stays empty until the
> harness reports one. Plan entries reach an open page as they change, rather than when the
> request ends.

## UPDATE · `packages/core/README.md` · the harness contract list, after the `harnessEnv` bullet

> - The run's plan record, from the package root: `OBSERVED_PLAN`, `observedPlanCollection`,
>   `observedPlanItemStateSchema`, the type `ObservedOutcome`, the per-run list marker
>   (`OBSERVED_PLAN_LIST`, `observedPlanListCollection`) and `replacePlanList`, which writes a
>   whole-list plan as entries. One shape for a coding
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
> **Where it works.** Claude Code works on this repository. Each session gets its own git
> worktree, cut from your checkout's `HEAD` on a branch named
> `kitchen-sink/claude-code-session/<session>`, and every turn of that session works there.
> Worktrees live outside the repository, under `~/.local/state/flow-state-dev/kitchen-sink-harness/`
> (or `$XDG_STATE_HOME` if you set it), in a folder named for the repository. Your own
> checkout is never touched, and two sessions never share a worktree.
>
> Claude Code runs without asking for approval, inside its sandbox: it can write only in the
> session's worktree. That includes `.git`, so it can't commit. Its changes wait, uncommitted,
> in the worktree for you to review and commit. Nothing is merged or pushed. Worktrees and
> branches stay until you remove them (`git worktree remove`, then delete the branch).
>
> In local development the mode uses the checkout the server runs from. To point it at another
> checkout, or to turn it on for a production server, set `KITCHEN_SINK_HARNESS_WORKSPACE` to
> that checkout's top level.
>
> **Continuing.** A session is one Claude Code conversation. Stop a turn and the next one picks
> up the same conversation. If Claude Code can't continue it, the session says so on every
> turn and keeps trying. A turn you stopped shows as stopped, not refused. It never quietly
> starts a new conversation; start a new session for that. If Claude Code answers in a different conversation of its own accord, the session says
> it started a new one and follows it.
>
> **The plan panel** shows what Claude Code recorded of its to-do list for the session's latest
> turn, read-only. If part of it couldn't be recorded, the panel says the plan may be incomplete,
> and why. Claude Code doesn't report its plan through the SDK yet, so the panel
> says "no plan recorded for this turn". Nothing in the panel starts work.
>
> Add `STORE_TYPE=filesystem` to keep sessions, and the conversations they're bound to, across
> a restart.

## UPDATE · `apps/kitchen-sink/README.md` · "Environment variables" table, the `KITCHEN_SINK_HARNESS_WORKSPACE` row FIX-1914 adds

> | `KITCHEN_SINK_HARNESS_WORKSPACE` | The top level of the git checkout the coding harness modes work on. Each session gets its own worktree and branch of it, kept outside the checkout under `~/.local/state/flow-state-dev/kitchen-sink-harness/`. Unset, they use the checkout the server runs from in local development, and are off otherwise. Ignored on Vercel, where they're always off. |

The opening paragraph's "in a directory you choose" (epic draft) no longer reads right: the
harness issue that publishes that sentence changes it to "on a repository you choose", as
FIX-1914's draft says, and the epic's draft now reads that way. No other page changes. The sentence "Claude Code doesn't
report its plan through the SDK yet" is removed when FIX-1185 makes the plan fill.
