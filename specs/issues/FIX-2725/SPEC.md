# FIX-2725 · Views can read sessions: worker sessions, session turns and the coding board as live views

**Spec** · [Decisions](DECISIONS.md)

## Five people, before and after

| Someone who… | Today | After |
|---|---|---|
| **opens the lab's sidebar** | Sees sessions an app assembled: one list call per worker, then four reads per row, then a subscription it keeps by hand, and a poll every 3 s | Sees one view's answer. It changes when a session opens or a turn starts or ends, and never once per streamed word |
| **watches a session's turns** (running, stopped, failed) | Gets them from an app that re-reads the session's requests on every notice | Gets them from one view; the words still stream as they do today ([D3](DECISIONS.md#d3)) |
| **watches a coding board** | Gets rows an app built from the board, each task's holds, a `harness` action run in another session, `getTask` per task and a pull-request read per run | Gets the rows from one view the harness kit serves. The app asks nothing per row |
| **builds a screen on workforce** | Writes the ~1,100 adapter lines claude-code-style has, or calls `listWorkerSessions` and assembles the rest | Watches three views with `useView`, and the session list call is gone |
| **asks for someone else's session** | Is refused by the session routes | Is refused the same way: a view reads only the caller's own sessions, decided by the server ([D1](DECISIONS.md#d1)) |

[FIX-2627](../FIX-2627/DECISIONS.md#decided-during-implementation) deferred these three views
here: a view could not list sessions or read a session's requests, and a kit could not add a view
to flows another kit builds. [FIX-2628](../FIX-2628/DECISIONS.md#how-it-got-here) waits on this
to delete its adapter.

## The goal, and how we'll know it's met

**A screen shows a user's sessions with a worker, a session's turns and a session's coding board
by watching three views the kits install, current within a second of each change with no poll,
showing only the caller's own sessions, so an app writes none of that assembly.**

| Is it the right goal? | |
|---|---|
| **The real need** | The issue: "designs a recorded, read-only session read for views … then builds the three screens on it. It also decides how a kit puts a view into flows another kit builds." FIX-2628 (owner, Fork B): "about 1,100 of `src/adapter.ts`'s 1,622 lines feed the three views" |
| **Smaller, and rejected** | "The engine reads; the views come later." Nothing an app deletes. Or "the views answer, but are polled." The lab already polls; a view that never wakes is the same screen |
| **Bigger, and not this issue's** | Deleting the lab's adapter ([FIX-2628](../FIX-2628/SPEC.md)). Moving teammates and Shift Manager onto the views (their epics). A view of what an app adds to a row, such as the lab's dismissals |
| **Not done if** | An area of the adapter has no view to replace it ([the map](#what-replaces-each-part-of-the-adapter)) · a view answers a session the caller may not run in · a screen stays current only by a poll · the session list or the board re-runs once per streamed chunk · a view runs an action in another session · `listWorkerSessions` survives |

```mermaid
flowchart LR
  H["a serve host · workforce and harness kits · scripted harness · push on, poll off"] --> W["alice's client watches the three views"]
  X["alice opens a session, sends a line, files a coding task that stops for review"] --> W
  W -->|"each screen equals a fresh store read within 1 s · quiet during a streamed reply"| P["PASS · goal met"]
  B["bob asks for alice's session"] -->|"nothing of hers in any answer"| P
  C["control · session reads not recorded"] -.-> W
  W -.->|"under the control"| F["must FAIL · a screen stays stale"]
```

The check compares each screen with what the store holds after each step and counts view runs; it
never reads the recorder.

| How we verify | |
|---|---|
| **Goal check** | `goals/views/screens-read-sessions-live/` (new), shaped like `goals/realtime/app-views-read-on-notice/` · model `n/a`, scripted harness · real `serve()` host with push · run by the implementer at completion · verdict on the implementation PR |
| **Signal** | `a:equals-store`: after each step, each of the three answers equals what a fresh read of the store says (sessions and their running state, turns and their status, board rows with holds, harness and review), within 1 s, poll off. `b:quiet`: during one reply of 40 streamed chunks, the session list and the board each run at most 3 times. `c:own-only`: bob's call with alice's session id answers nothing of hers and names no topic of hers. `d:no-actions`: no view run starts a request |
| **Input** | Two workers, one on the agent flow and one coding worker with `harness: codex`. A second session opened from another tab. A task that fails once, then is retried. An app whose `agent` entry is its own flow must pass `a` too |
| **Anti-game** | Don't assert on the recorder, the hearing list or a view's unit test. Keep the poll off: a timer hides a missed notice |
| **Control that must fail** | `GOAL_CONTROL=unrecorded-session-reads`: the two new reads record nothing, so a new session never reaches the list; FAILS `a:equals-store`. `GOAL_CONTROL=admit-by-input`: the reads skip the owner check; FAILS `c:own-only`. Today's `main` has no views to watch |

## What changes

![Before and after. Before, the lab's adapter lists sessions through the client, reads requests, holds and task details per row, runs a harness action in another session and polls. After, the engine gives a view two more reads of the caller's own sessions, recorded on topics those writes already publish; workforce serves the worker sessions and session turns views on its roster flow; the harness kit serves the coding board on its own flow and a recorded-work view on the coding worker flow; the screen watches them](figures/what-changes.svg)

The engine adds the reads, each kit serves its views on a flow it already owns, and the screen
only watches.

```diff
  // a view's block, in any kit (D1)
  execute: async (input, ctx) => {
+   const host = requireRequestHost(ctx);
+   const rows = await host.sessions!.list({ flowKind: "agent", fields: { workerId: input.worker }, limit: 50 });
+   const turns = await host.sessions!.turns(input.sessionId, { limit: 50 });  // status, never the words
  }

  // a screen (FIX-2628 writes these hooks)
- const rows = useWatch((on) => adapter.watchSessions(on), []);
+ const { value: rows } = useView(workerSessionsViewRef(), { worker: mode.worker });
- const tasks = useWatch((on) => adapter.watchTasks(sessionId, on, setStale), [sessionId]);
+ const { value: tasks, stale } = useView(codingBoardViewRef(), { sessionId });      // the harnesses flow, user scope (D2)
```

Names past `list`, `turns` and the four views' names are the implementer's.

**Docs:** at release, the Views page gains "reading your sessions" (what a view may read of the
caller's sessions, and when it hears a change); the workforce and harness-manager READMEs list
their new views, and the workforce README drops `listWorkerSessions`. No new page. Contributor
docs in the implementation PR: `flows-and-actions.md`'s view section, `state-and-scopes.md`'s
paragraph on reading another session, and the `view` row of `mechanisms.yaml`.

## How a change reaches the screen

```mermaid
flowchart LR
  W["a session or request write"] --> N["notices it already publishes · user topic run · session topic request and run"]
  V["a view run"] --> R["sessions.list · sessions.turns · board read of a named conversation"]
  R --> O{"the caller's own? same user, tenant and org"}
  O -->|"no"| U["nothing, as an unknown session"]
  O -->|"yes"| H["recorded · hears only the kinds that change it"]
  N --> L["client.live · reads the view again"]
  H --> L
```

## What replaces each part of the adapter

| Adapter area (FIX-2628's count) | Replaced by |
|---|---|
| Worker sessions, ~220: `watchSessions`, `rowOf`, `runningTurns`, `firstLineOf`, `waitingCountFor` | workforce's **worker sessions** view: per row the id, title (else the first line), worker, last change, whether a turn runs, the session's fields, and the tasks waiting on the user by id and attempt, so the app takes away its own dismissals |
| Session turns, ~500: `watchThread`'s request reads, stopping, retry, and `watchTaskWork`'s work | workforce's **session turns** view (each turn's status, times, source and error); the words stay on `sessionFeed` and the in-flight call on the request stream ([D3](DECISIONS.md#d3)); `entriesOf` and `withStopped` move unchanged, as FIX-2628 says; the plan and pull requests come from the **recorded work** view |
| Coding board, ~350: `boardOf`, `harnessOf`, `tasksAndTopicsOf`, `holdsOf`, `watchTasks`, outputs, errors, review answers' lookup | harness-manager's **coding board** view: the task-list rows plus each one's open holds and where their answers go, its harness, review and landing, and its pull requests by number. Answering stays the Inbox client's `answerOne` and the board's actions |
| Row types, ~150 | The views' output types |
| `createWorkforceClient`'s `listWorkerSessions` | Removed. `findWorkerSession` stays: it finds the one session a write goes to, not a screen's list |

## What stays as it is

- The session stream, `sessionFeed`, a request's stream, and every action and answer route.
- `sessions.read` and `sessions.history` for actions; who may read a session; `assertSessionAdmitted` on the view routes.
- The board's own task-list view, its notices and FIX-2625's partial answers.
- The HTTP session list and request list for clients.

## What's already here, and the debt

| Already here | What this does with it |
|---|---|
| **The job: let a running block read the caller's other sessions.** Mechanism `view` (`view-reads.ts` `createViewDependencies`), and `RequestSessions.read` / `history` (`request-host.ts:349`, FIX-2160 D2, FIX-2173). Searched `sessions.list`, `listWorkerSessions`, `requests(`, `PeerSessionView`, `history(` across `packages/` | **Extends** `RequestSessions` with `list` and `turns`, through its one owner rule. This is the third and fourth read there; none lists |
| The HTTP session list (`SessionListOptions`: flow, user, tenant, org, parentage, readonly fields, limit) and request list | **Reused** below the new reads: the same store filters, at the source (BP-033) |
| [FIX-2623](../FIX-2623/DECISIONS.md#d1): reads recorded, not declared; peer reads refused in user and org views | **Amended:** user views may read the caller's sessions. Org views still refuse |
| [FIX-2625 D3](../FIX-2625/DECISIONS.md#d3): a board read is heard on its board notices | **Kept:** a board read of a named conversation records that conversation where a running session would be |
| [FIX-2627](../FIX-2627/DECISIONS.md#decided-not-asked)'s coding board "served by a package that depends on both", and its deferral | **Built**, on the harness kit's own flow, not a `views` slot ([D2](DECISIONS.md#d2)) |
| The conversation ledger, user-scoped "so a task session on another flow reads and settles the row" (`conversation-board/ledger.ts`) | **Builds on:** why the board can be served from any flow |

| Adds | Existing piece considered | Why it doesn't fit / how composed |
|---|---|---|
| `sessions.list`, `sessions.turns` | `sessions.history`; the HTTP lists | **Extends** `RequestSessions`. `history` is what a model reads (settled turns, with words); a screen needs every turn's status and no words |
| Two hearing rules | `createViewDependencies` | **Extends** the one surface; a row each in `views-dependency-matrix.test.ts` |
| Worker sessions and session turns views | The roster view, `listWorkerSessions` | **Composed** on the roster flow; the client call goes |
| Coding board view | The board's task-list view, `inboxItems` | **Composed:** the same list code and Inbox rule, run on the server |
| Recorded work view | `readRecordedWork`; the `changes` view | **Composed** beside `changes` on the coding worker flow; the browser reader stays for teammates and Shift Manager |

| The debt | |
|---|---|
| **Removes** | `listWorkerSessions`; the reason FIX-2628 keeps ~1,100 adapter lines; the peer-read refusal in user views |
| **Adds** | Two reads and four views, permanent by design. Sessions are listed two ways, the HTTP list and the view read: permanent by design, one store filter under both, as an action and a view share one board read |
| **Leaves** | Teammates and Shift Manager keep `readRecordedWork` and their own assembly (their epics). `sessions.read` in a session view still hears every chunk of the session it reads; narrowing it is the implementer's, under D1's rule |

**Net: down.** Each app stops assembling sessions; the framework gains reads it already half had.

## Sign off

**[The goal](#the-goal-and-how-well-know-its-met), at that size:** three live views, own sessions
only, no poll, and nothing left for an app to assemble. If wrong: views that exist but still leave
the lab its adapter.

**[The debt](#whats-already-here-and-the-debt), net down:** the adapter's reason and a client call
go; two reads and four views come. If wrong: a second session list that drifts from the first.

1. **[D2](DECISIONS.md#d2) · No kit adds a view to another kit's flows: a view that reads across
   them runs at user scope on its own kit's flow.** The one to weigh. If wrong: a later view that
   needs another flow's session resources has no home.
2. **[D1](DECISIONS.md#d1) · A view may list the caller's sessions and read their turns; the
   server decides which, and it hears only the changes that alter them.** If wrong: a session
   list that wakes on every word, or one a caller can point at someone else's.
3. **[D3](DECISIONS.md#d3) · The turns view answers each turn's state; the words stay on the
   stream.** If wrong: two paths to a thread an app must stitch.

**Open: none.**

Feature · `core`, `engine`, `workforce`, `harness-manager`, `client` · M (two reads, two hearing
rules, four views, one client call removed) · after FIX-2625, FIX-2627, FIX-2734 (merged) · blocks
FIX-2628 · [Linear](https://linear.app/fixpoint-labs/issue/FIX-2725)
