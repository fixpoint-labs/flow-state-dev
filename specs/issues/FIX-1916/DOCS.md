# FIX-1916 · Documentation draft

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs** · [Evolution](EVOLUTION.md)

The epic's shared story is in [its draft](../../epics/FIX-1907/DOCS.md); FIX-1915 publishes "The
run's plan". This issue publishes Codex's own specifics, per the epic's ownership table: the
plan row on the Codex page and Kitchen Sink's Codex section. All of it ships with the
implementation PR, after the goal check. The drafts assume [the open question](DECISIONS.md#open)
takes the recommendation; if it doesn't, the plan sentences change and nothing else does.

The epic draft's Codex example no longer promises a to-do list; the epic's follow-up PR fixed it.

## UPDATE · `apps/docs/docs/tools/codex.md` · "What it emits", the paragraph after the table

Adds a paragraph after "Every item carries provenance, so the devtool shows the full trace of
what the run did."

> Codex doesn't report a to-do list in the version this package supports. Its headless runs,
> which are what this package drives, give the model no planning tool. The row above maps a
> to-do list if Codex ever sends one, but this package records no plan, so a reader of
> [the run's plan](./coding-agents.md#the-runs-plan) should show Codex as reporting none.

## UPDATE · `apps/docs/docs/tools/coding-agents.md` · "The run's plan", after the paragraph that starts "Not every harness reports a plan"

> Codex is one of them: its headless runs don't produce a to-do list in the version
> `@flow-state-dev/codex` supports, so a Codex block declares no plan record.

## UPDATE · `apps/kitchen-sink/README.md` · new section "Codex mode", after "Claude Code mode"

> ## Codex mode
>
> Pick **Codex** to work a Codex session the way you would on its own. Each turn continues the
> same Codex thread, and each step shows as Codex takes it.
>
> It runs on your machine through the Codex SDK, and needs the SDK version that
> `@flow-state-dev/codex` supports; any other version shows the mode as unavailable, with both
> versions named. Sign in with `codex login`, or put `CODEX_API_KEY` in the server's environment.
> A host where Codex isn't signed in, or where Codex's sandbox can't run, shows the mode as
> unavailable with the reason.
>
> **Where it works.** Codex works in the session's own worktree and branch, the same way Claude
> Code mode does (see [Claude Code mode](#claude-code-mode)). It runs without asking for approval,
> inside its own sandbox, which lets it write only in that worktree and not in its git data, so
> its work waits uncommitted for you. Its commands start with only the environment variables
> Kitchen Sink passes it, not the server's whole environment. That is not a security boundary:
> a command runs as the server's user and can still read the server's environment on Linux. A
> separate user or container is what contains that.
>
> **Continuing.** A session is one Codex thread. Stop a turn and the next one continues the
> same thread. Codex keeps its threads in its own home directory (`~/.codex` unless you set
> `CODEX_HOME`), not in the session's directory. If Codex no longer has a session's thread,
> because its record was cleared or the server now uses a different Codex home, the session
> says Codex refused it, on every turn. It never moves to a new thread on its own; start a new
> session for that.
>
> **Steps.** Codex reports each step whole: a command shows when it starts and again when it
> finishes, and a reply shows once Codex has written all of it.
>
> **The plan panel** says "Codex reports no plan". Codex doesn't produce a to-do list in its
> headless mode, in the version Kitchen Sink runs.

No other page changes. The plan sentences on all three pages are removed or rewritten by the
follow-up that writes Codex's list, if a supported Codex version starts producing one.
