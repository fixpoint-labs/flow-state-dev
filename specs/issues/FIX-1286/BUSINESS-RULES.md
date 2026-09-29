# FIX-1286 · Business rules

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md) · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

The cases, as rules. "Workspace" means the local provider's `scope: "run"` workspace. Alice and
Bob are two users in one tenant and one organization. The *proved by* column is the check the
plan runs.

## Another user's request id

| # | When | Then | Proved by |
|---|---|---|---|
| BR-1 | Bob sends Alice's request id while her request is on record | Bob gets his own request id and an empty workspace. Alice's files are untouched | HTTP case, live leg (FIX-1018 delivers it) |
| BR-2 | Bob sends Alice's id after retention deleted her request | Bob's request runs under that id and sees an empty workspace. Alice's files are untouched and unreachable | HTTP case, evicted leg |
| BR-3 | Alice's record was removed some other way: a dropped delivery, or a memory store that restarted while the directory stayed on disk | Same as BR-2 | Unit: two contexts, one id, two start times |
| BR-4 | Bob reuses the id through any other entry point (a direct dispatch, a queued run) | The workspace follows the request that runs, never the id alone | Unit on the key; FIX-1018's own cases cover the refusal |

## The same user, the same request

| # | When | Then | Proved by |
|---|---|---|---|
| BR-5 | Alice retries with her own id while her request is on record | The same request and the same workspace | HTTP case, a third call in the live leg |
| BR-6 | Alice reuses her own id after her request was deleted | A new request, and an empty workspace | Unit |
| BR-7 | Several blocks, or parallel tool calls, run in one request | One workspace, shared | Existing unit test, still green |
| BR-8 | A request suspends and resumes, in this process or another | It finds the files it left: its start time is read from its stored record, never re-stamped | Engine unit, BP-035 second path |
| BR-9 | A queued request adopts the record its host wrote at enqueue | Named for that record's start time | Engine unit on the queued path |

## What does not move

| # | When | Then | Proved by |
|---|---|---|---|
| BR-10 | Two tenants send the same id | Separate workspaces, as today | Existing unit test |
| BR-11 | A `session`, `user` or `org` workspace, or any non-local provider | Named exactly as today | Existing unit tests, unchanged |
| BR-12 | A context that carries no start time (a hand-built test context) | A key of its own, never equal to one that carries a time | Unit |
| BR-13 | The app upgrades with run-scoped requests in flight | Those requests continue in a new, empty directory. The old directories stay on disk, unreachable | Changeset note; no check |

## Failure taxonomy

Nothing new refuses or throws. The change is which directory a run opens; every case above
succeeds. A store that cannot return a request's start time is an engine bug, caught by the
engine unit on BR-8 and BR-9, not a runtime path.

## Acceptance criteria this issue owns

[ER-4](../../epics/FIX-1635/BUSINESS-RULES.md#what-a-team-gets-and-what-it-doesnt), met by
[the goal](SPEC.md#the-goal-and-how-well-know-its-met): both legs of the HTTP case pass as Bob,
and the evicted leg failed on FIX-1018's head before this change. The PR names that commit
([ER-16](../../epics/FIX-1635/BUSINESS-RULES.md#what-no-child-may-do)).
