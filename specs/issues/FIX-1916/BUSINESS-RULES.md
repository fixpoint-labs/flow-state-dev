# FIX-1916 · Business rules

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md) · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

FIX-1915's rules hold for every harness and are not repeated. A row here is Codex's own version
of one, or a case only Codex has. "CI" is a scripted Codex client through `resolveCodexClient`;
"goal" is real Codex in a browser; "POC" is [poc/codex-wire](poc/codex-wire/).

## Starting and continuing a thread

| # | When | Then | Proved by |
|---|---|---|---|
| BR-1 | The first turn of a new session runs | Codex names a new thread before any work, and the id is recorded then | POC A · CI · goal **c** |
| BR-2 | A later turn runs | Codex names the same id again at the start of the turn; it shows *continued* | POC B · CI · goal **c** |
| BR-3 | Codex refuses a known thread id: it no longer has the thread (its record was removed, or the host's Codex home changed) | The run fails with Codex's own resume error (`no rollout found for thread id …`), which the Codex package classifies as an unknown conversation (FIX-1915 S13), and names no thread. The turn shows Codex refused thread *X*. The recorded id stays, and the next turn asks for *X* again (FIX-1915 D2). Any other failure before Codex names a thread (the process didn't start, sign-in, the sandbox) is not a refusal: the turn shows its error, and the id stays | POC C · CI, both paths · goal **x** |
| BR-4 | A refused thread | Codex starts no new thread in its place, so it never shows as *started a new one*. A different id named, if it ever happens, follows FIX-1915's rule as is | POC C · CI, a scripted different id |
| BR-5 | Codex itself fails a turn after naming the thread (the model's turn failed) | The block returns a failed run, not a throw. The turn shows failed with Codex's message, not refused. The id stays | CI |
| BR-6 | The page is reloaded, or the server restarts on a durable store | The same session holds the same id, and the next turn continues it. Codex keeps the thread in the host's Codex home, not in the session's directory | Goal **r** |

## While it works

| # | When | Then | Proved by |
|---|---|---|---|
| BR-7 | A run is in progress | Each step shows when Codex reports it, from Codex's emitter only. Codex reports whole steps: a command when it starts and ends, a reply once complete | CI · goal **l** |
| BR-8 | The person stops a turn | The Codex process is stopped, the turn shows as stopped, never as refused, and the next turn continues the same thread | POC E · CI · goal **s** |
| BR-9 | A turn is stopped before Codex named a thread, on a session's first turn | Nothing was recorded, so the next turn starts the session's first thread. That is not a refusal and not a restart | CI |

## Where it works, and what it can reach

| # | When | Then | Proved by |
|---|---|---|---|
| BR-10 | Any turn runs | Codex works in the session's own git worktree from FIX-1915's factory, and its sandbox confines its writes to that worktree, never the repository's `.git` (FIX-1915 BR-13b). This is required: a host where Codex's sandbox can't hold it shows the mode unavailable with the reason. The run edits files and leaves them uncommitted | Codex's own sandbox · FIX-1915's workspace checks · CI, a write to `.git` refused |
| BR-12 | Codex runs a command | The command starts with only the allowlisted environment, never the server's whole environment. Filtering, not a security boundary (FIX-1915 BR-13b) | CI, a planted variable absent from the command's environment |

## The plan panel

| # | When | Then | Proved by |
|---|---|---|---|
| BR-13 | A Codex session is open | The panel says "Codex reports no plan", because Codex mode declares no plan record (FIX-1915 BR-16). Never "no plan recorded for this turn" | CI · goal **p** |
| BR-14 | A Codex run does emit a to-do list (a version or sign-in path the POC didn't reach) | It shows as a step in the stream, and nothing is recorded (epic ER-11). The goal verdict names it, which reopens [the open question](DECISIONS.md#open) | Goal, by observation |

## Can this host run it

| # | When | Then | Proved by |
|---|---|---|---|
| BR-15 | Harness modes are on for this host (FIX-1914), but the Codex SDK isn't installed | The Codex card shows that reason, and no Codex flow is registered | CI |
| BR-16 | An SDK version other than the one the package pins is installed | The card shows both versions. The server starts as normal; only Codex mode is off | CI, a planted version |
| BR-17 | Codex is not signed in: `codex login status` fails and no Codex API key is in the allowlisted environment | The card says Codex is not signed in, and no session opens | CI |
| BR-18 | Codex's sandbox can't run on this host | The card says so, and no session opens | CI |
| BR-19 | Harness modes are off for this host (FIX-1914) | No Codex flow is registered. `/codex` creates no session, and its flow's API is not found | FIX-1914's goal check, extended for Codex |
| BR-20 | A sign-in lapses after the server started | That turn fails with Codex's own error, shown as a sign-in error, never as Codex refusing the thread (BR-3). The id stays. From the next server start the card says Codex is not signed in (BR-17) | CI |

## Failure taxonomy

As in FIX-1915: nothing is fatal to the app. A refused, stopped or failed turn ends in Codex's
own words and keeps the id, so the next turn retries it. An unavailable Codex is a reason on a
card. Nothing retries on its own.

## Acceptance criteria this issue owns

[The goal](SPEC.md#the-goal-and-how-well-know-its-met), on real Codex in a browser, with the
controls failing as named. From the epic: ER-2, ER-3, ER-4 and ER-6 hold for Codex. ER-5 holds
as "reports no plan" if [the open question](DECISIONS.md#open) takes the recommendation.
