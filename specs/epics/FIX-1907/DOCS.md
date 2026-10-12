# FIX-1907 · Documentation draft

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs** · [Evolution](EVOLUTION.md)

The shared story is written once here; each child publishes its own specifics with its
implementation. The Flow State paragraph follows the owner's [answer](DECISIONS.md#open): today's app,
unchanged.

## UPDATE · `apps/kitchen-sink/README.md` · opening, replacing the first paragraph

> Kitchen Sink is where you use each coding harness flow-state-dev supports, directly, and see
> whether its integration holds. Pick a harness on the front page: **Flow State**, **Claude
> Code**, **Codex** or **Cursor**. The rail then lists that harness's sessions, and a session
> works the way the harness does on its own. Each turn continues the same conversation, what the
> run does shows up while it works, and the run's own to-do list sits beside it.
>
> Kitchen Sink sets up the session and keeps it in step with the harness. It doesn't plan work for
> a harness or move work between harnesses; that is
> [Shift Manager](../../packages/shift-manager/README.md).
>
> **Flow State** is the framework's own flows: the assistant, and the support desk with a
> coordinator and four specialists (see [The support team](#the-support-team-workforce)).
>
> The three coding harnesses run on your machine, on a repository you choose, signed in the way
> each one is on its own. A harness this machine can't run shows as unavailable, with the reason.
> A deployed copy of Kitchen Sink offers Flow State only.

For example, in Codex mode, start a session and ask it to add a test for a function. Each step
shows as Codex takes it, and the plan panel says Codex reports no plan, which is true of the Codex
version Kitchen Sink runs. Ask a follow-up in the same session and Codex continues the same
thread, so it already knows which function you meant. (The plan sentence waits on FIX-1916's open
decision on the Codex plan panel, and changes with it.)

## CREATE · `apps/docs/docs/tools/coding-agents.md` · section "The run's plan", after "The handle"

> A run's to-do list is recorded separately from its items, in one shape every harness writes: an
> entry per plan item with its title and status, as the harness reports them. It is a record of
> what the agent planned, not a work queue. Nothing in it starts work.
>
> Not every harness reports a plan. A harness that doesn't writes nothing, and a reader should say
> so rather than show an empty list.

## Ownership

| Material | Publisher | Specific draft |
|---|---|---|
| The README opening above, naming only the modes that run when it merges | FIX-1914; FIX-1915, FIX-1916 and FIX-1917 each add their mode to it | This document |
| The README's per-mode sections: setup, sign-in, where the run works | FIX-1915, FIX-1916, FIX-1917, each for its harness | Its `DOCS.md` |
| "The run's plan" on the coding agents page | FIX-1915, which moves the record into core | This document |
| The plan row in "What it emits" on `codex.md` and `cursor.md`, and "Recording what the run did" on `claude-code-sdk.md` | FIX-1916, FIX-1917, FIX-1915 | Their `DOCS.md` |
| The SDK path's plan tools filling: the fix's own edits to `claude-code-sdk.md`, the Claude Code README and its release note | FIX-1185, which fixes it and publishes them with the fix | Its `DOCS.md` |
| The `apps/kitchen-sink` row in the repo's `CLAUDE.md` package map | FIX-1914 | Internal; no draft |

Publish each specific with its implementation. The opening never names a mode that doesn't run
yet, and nothing here is published because this spec merged. Later publishers link the opening rather than repeating it.
