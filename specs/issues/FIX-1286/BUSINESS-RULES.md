# FIX-1286 · Business rules

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md) · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

The cases, as rules. "Workspace" means the local provider's `scope: "run"` workspace;
"incarnation" is the token a request record is stamped with when it is first created
([D1](DECISIONS.md#d1)). Alice and Bob are two users in one tenant and one organization. The
*proved by* column is the check the plan runs.

## Another user's request id

| # | When | Then | Proved by |
|---|---|---|---|
| BR-1 | Bob sends Alice's request id while her request is on record | Bob gets his own request id and an empty workspace. Alice's files are untouched | HTTP case, live leg (FIX-1018 delivers it) |
| BR-2 | Bob sends Alice's id after session retention deleted her request | Bob's request runs under that id and sees an empty workspace. Alice's files are untouched and unreachable | HTTP case, evicted leg |
| BR-3 | Alice's record was removed some other way: a dropped delivery, or a memory store that restarted while the directory stayed on disk | Same as BR-2 | Unit: one id, two incarnations, two keys |
| BR-4 | The id is deleted and recreated within the same millisecond, or under a clock that repeats a value | Two incarnations, two workspaces. Nothing depends on the clock | Unit: two records with equal `createdAt` |

## The same user, the same request

| # | When | Then | Proved by |
|---|---|---|---|
| BR-5 | Alice retries with her own id while her request is on record | The same request and the same workspace | HTTP case, a third call in the live leg |
| BR-6 | Alice reuses her own id after her request was deleted | A new request, and an empty workspace | Unit |
| BR-7 | Several blocks, or parallel tool calls, run in one request | One workspace, shared | Existing unit test, still green |
| BR-8 | A request suspends and resumes, in this process or another | It finds the files it left: its incarnation is read from its stored record, never stamped again | Engine unit |
| BR-9 | A queued request adopts the record its host wrote at enqueue | Named for that record's incarnation | Engine unit on the queued path |
| BR-10 | Two same-owner calls race to create one absent id | Both contexts end holding the one incarnation the store kept, and one workspace. The hand-off never rewrites a stored token | Engine unit, concurrent, required |
| BR-11 | A record written before incarnations existed is resumed | Its incarnation is derived from its `createdAt`, the same value every time, in a form no stamped token can take | Engine unit on a legacy record |

## What does not move

| # | When | Then | Proved by |
|---|---|---|---|
| BR-12 | Two tenants send the same id | Separate workspaces, as today | Existing unit test |
| BR-13 | A `session`, `user` or `org` workspace, any non-local provider, or the Claude Code integration's mounts | Keyed exactly as today | Unit: those keys byte-identical |
| BR-14 | A context that carries no incarnation (a hand-built test context) | A key of its own, never equal to one that carries a token | Unit |
| BR-15 | The app upgrades with run-scoped requests in flight | Those requests continue in a new, empty directory; legacy records included. The old directories stay on disk, unreachable | Changeset note; no check |

## Failure taxonomy

Nothing new refuses or throws. The change is which directory a run opens; every case above
succeeds. A handle built without reading the stored record's incarnation is an engine bug,
caught by BR-8 to BR-11, not a runtime path.

## Acceptance criteria this issue owns

[ER-4](../../epics/FIX-1635/BUSINESS-RULES.md#what-a-team-gets-and-what-it-doesnt), met by
[the goal](SPEC.md#the-goal-and-how-well-know-its-met): both legs of the HTTP case pass as Bob,
and the evicted leg failed on FIX-1018's head before this change. The PR names that commit
([ER-16](../../epics/FIX-1635/BUSINESS-RULES.md#what-no-child-may-do)).
