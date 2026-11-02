# FIX-2432 · Decisions

[Spec](SPEC.md) · **Decisions**

One decision is the sign-off surface. The rest are engineering calls, recorded so nobody reopens them.

<a name="d1"></a>
## D1 · The session flow composes FIX-2389's approval pieces, behind the same `approveTools` option · for sign-off

| | |
|---|---|
| **Instead of** | Kitchen Sink building its own approval path in its mode files · or a live wait on `canUseTool` while the harness process stays up |
| **Because** | The epic's ER-4: one implementation per need. FIX-2389 already decides how a coding run waits for an approval (stop the run, wait as a durable suspension, resume the session) and owns the feed, the held decision and the grant rule. A session turn is the same run without a task. A live wait loses the question on a restart (FIX-2389 D1) |
| **Locks in** | **Requires** FIX-2389's slice to export its approval pieces from harness-manager for a flow other than the manager to compose. That export is FIX-2389's to ship; it has been asked through the epic. If it lands private to `manager.ts`, this child raises it with FIX-2389 rather than lifting it here |

**What would change my mind:** FIX-2389's build finding that its stop-and-resume can't leave the
manager without the task row. Then the session flow would need its own stop, and this goes back
to review.

## Decided, not asked

- **Same option name.** `approveTools: true`, as on the manager. Off by default (ER-2); off, the feed is absent.
- **Two PRs**, package slice then Kitchen Sink's adoption (epic D3), from review round 1.
- **What Kitchen Sink pre-allows.** Read-only tools (`Read`, `Glob`, `Grep`). Everything else asks.
  The mode file names them; it's the host's call, and easy to widen.
- **A grant lasts the turn.** The session flow has no attempt, so *Allow for this run* lasts the
  turn's request, FIX-2389's narrow rule, the same tool with the same command or file.
- **Waiting reads off the request.** The page's notice reads a suspended request as *Waiting on
  you*. No field on the turn record.
- **Codex and Cursor modes stay as they are.**

## Settled

None built. FIX-2389's leg **r** (a stopped Claude Code session resumes and asks for the call
again) settles the premise for both.

## Notes from review

Round 1, cursor[bot] review 5725507583. Folded: two PRs per D3; the export is FIX-2389's to ship;
one wiring rule; the UI paragraph shortened. Not folded: pushing read-only `allowedTools` defaults
into the package. What a run may do unasked is the host's call, as on the manager.

## How it got here

- **Draft** — framed as FIX-2389's approval on Kitchen Sink's direct sessions, composing its
  pieces in `harnessSessionFlow`.
- **Round 1** — two PRs; the export requirement moved to FIX-2389.
