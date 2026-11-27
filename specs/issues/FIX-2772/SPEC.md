# FIX-2772 · Teammates' conversations

**Spec** · [Decisions](DECISIONS.md)

## Five people, before and after

| Someone who… | Today | After |
|---|---|---|
| **talks to a teammate in the lab** | Sees the reply stream in, a run of steps, Stop, Retry on a failed turn, and approvals, through 600 lines of Teammates' own calls | Sees the same, read through `react`'s session feed and workforce's turns view and client |
| **has a long conversation** | Sees the *Earlier turns summarized* divider where the worker's word-for-word reading begins | Sees the same divider, read from each turn's `historyStart` on workforce's turns view and from the history summary through `react`'s `useResource` ([D1](DECISIONS.md#d1)) |
| **presses Stop and sends a follow-up at once** | The follow-up runs. Only the turns running when Stop looked stop | The same, now in workforce's client, so Claude Code-style gets it too. A line sent from another tab that starts after Stop looked may run, as it can today ([D2](DECISIONS.md#d2)) |
| **starts an app from Teammates** | Copies `session-feed.ts`, a call interface per job and 22 inventory findings in this area | Copies screens and thin hooks over package reads: none of the 22 |
| **maintains the epic** | Teammates' allowlist has 57 entries | It has 35 once this merges; `session-feed.ts`' last 3 go with the last `watchFeed` caller ([Where this meets its siblings](#where-this-meets-its-siblings)) |

The epic locks the rules this issue follows: [FIX-2683 ER-1, ER-2, ER-3, ER-4, ER-7 and
ER-8](../../epics/FIX-2683/DECISIONS.md#who-owns-what), and the shrink-only allowlist of
[D3](../../epics/FIX-2683/DECISIONS.md#d3). This spec names the entries it removes and what
replaces each one. It also names the two calls that need the owner before the replacement can be
built.

## The goal, and how we'll know it's met

**Every conversation screen in Teammates (the thread, its composer, Stop, Retry, approvals,
files, the window divider and a turn's run of steps) reads and writes through package hooks and
clients, and the 22 allowlist entries this issue owns are gone, with every Teammates goal the
conversation touches still passing.**

| Is it the right goal? | |
|---|---|
| **The real need** | The epic's row: "Feed, send, files, stop, approvals, retry, window, activity on the package's session hooks; `App.tsx`'s `ClientHttpError` import; `session-feed.ts` goes." Its goal: Teammates meets claude-code-style's whole inventory, with an empty allowlist at the closure |
| **Smaller, and rejected** | "Move the feed only, and keep the divider and Stop's guard as app code." Each needs a `topic` import or a `.flow(` call, which L3 forbids, so the entries would stay. Or "drop the divider": it retires a graded goal step ([D1](DECISIONS.md#d1)) |
| **Bigger, and not this issue's** | The roster, hire, context, talk and the busy dot (FIX-2771). Task cards and runs (FIX-2773). The shared scaffolding and the fake app's file (the last Teammates child to merge). A conversation view shared with Claude Code-style (FIX-2756, [ER-7](../../epics/FIX-2683/DECISIONS.md#who-owns-what)) |
| **Not done if** | Any of the 22 entries is on the allowlist · an entry left by being moved to the screen-type list without a reason · `session-feed.ts` exists after the last `watchFeed` caller leaves it · a file under `src/app/` grew · the divider, Stop with a follow-up, Retry, an approval, a file thumbnail or a run of steps behaves differently · the fake app keeps a conversation scenario this issue's ledger doesn't map · a page goal in `goals/teammates-lab/` fails |

```mermaid
flowchart LR
  B["this issue's PR head"] --> I["Teammates inventory test"]
  B --> G["the five page goals of goals/teammates-lab"]
  I -->|"none of the 22 entries · no new finding · src/app no longer"| P["PASS · goal met"]
  G -->|"every step passes · divider · Stop · Retry"| P
  C["control · put back conversations.ts' topic import"] -.-> I
  I -.->|"under the control"| F["must FAIL · names the finding"]
```

| How we verify | |
|---|---|
| **Goal check** | `labs/teammates/test/inventory.test.ts` with the 22 entries deleted from `inventory-allowlist.json`, and the five page goals in `goals/teammates-lab/` (`a-worker-talks-to-another-while-you-talk`, `shows-a-workers-steps`, `stops-and-re-runs-a-task-from-its-popup`, `tells-a-stopped-task-from-a-working-one`, `first-run-shows-its-context`) · run by the implementer at completion · verdict on the implementation PR |
| **Signal** | The inventory test passes against the shrunk allowlist (it already fails on a stale or a new entry and on a grown `src/app/` file). Step 4 of `a-worker-talks-to-another-while-you-talk` sees the *Earlier turns summarized* divider above both facts. The ported unit test *leaves a line sent after the press to run on* passes against the workforce client |
| **Input** | Each goal's own held-out input and model |
| **Anti-game** | Don't satisfy the inventory by moving a type to the screen-type list without the reason the settings require (review checks all seven, since a moved file passes the ratchet without one), or a read into a folder the rules don't scan ([ER-2](../../epics/FIX-2683/DECISIONS.md#who-owns-what)). The goals read the page and the store, never the hooks |
| **Control that must fail** | Put `import { topic } from "@flow-state-dev/client"` back in `src/app/conversations.ts`: the inventory fails, naming it. The ported Stop test, run against today's `stopTurns`, fails: the follow-up is stopped |

Beside the goal, `node specs/issues/FIX-2772/poc/entry-ledger/check.mjs` re-derives the entry
counts from the allowlist on `main` ([Settled](DECISIONS.md#settled)).

## What changes

![Before: the conversation screens reach the server through Teammates' own calls, session-feed.ts, client.live with topic, and client.flow. After: through react's useSessionFeed and useResource, workforce's turns view with historyStart and its client's send, stopTurns and retryTurn, and react's approval hook; the 22 entries are gone](figures/what-changes.svg)

The screens keep their behaviour; what they read through moves from Teammates' own calls to
package hooks and clients, two of which change in their package.

```diff
  // labs/teammates: the conversation screen
- const view = useWatch(adapter.watchConversation, sessionId);
- const connection = useWatch(adapter.watchConnection, sessionId) ?? "connecting";
- const mark = useWatch(adapter.watchWindow, sessionId);
+ const { view, connection, mark } = useConversation(sessionId);
+ // useSessionFeed (items, runs, connection, earlier) + useView(sessionTurnsViewRef(), { sessionId })
+ // + useResource(historySummaryResource, { sessionId }) for the summary's mark (D1)
+ // entries and the divider are drawn from them in src/lib
- adapter.send(sessionId, text, attachments);
+ const answer = await workforce.send(sessionId, text, { stream: true, attachments });
+ followResponse(answer);
- adapter.interrupt(sessionId);          adapter.retry(sessionId, requestId);
+ await workforce.stopTurns(sessionId);  await workforce.retryTurn(sessionId, requestId);

  // labs/teammates/src/main.tsx: the one client, built by the entry
+ const client = createClient({ userId: readUserId(), baseUrl: readBasePath(), fetcher });

  // @flow-state-dev/workforce: one row of the session turns view (D1)
  { id, action, status, source, startedAt, completedAt, error,
+   historyStart: { requestId: string } | null }

  // @flow-state-dev/react: a session resource read by session id, kept current (D1)
- useResource(def, { session })      // a useSession view's snapshot only
+ useResource(def, { sessionId })    // reads the session's state, again on its resource notice
```

**The entries it removes, and what replaces each.** All 22 are on
`labs/teammates/test/inventory-allowlist.json` at this branch's merge-base, as
`poc/entry-ledger/check.mjs` re-derives them. *Deleted* means the
finding no longer exists. *Screen type* means the type moves to `src/lib/` and onto
`inventory-settings.ts`'s screen-type list with the reason the settings require, as
claude-code-style lists `ThreadEntry`, `ThreadView`, `AppConnection` and `ToolStep`.

| # | File · symbol · kind | Replaced by | Outcome |
|---|---|---|---|
| 1 | `src/app/conversations.ts` · `topic` · client import | `useView(sessionTurnsViewRef(), { sessionId })`: running, ended, aborted and retryable turns | Deleted |
| 2 | `conversations.ts` · `send` · flow call | workforce client `send(…, { stream: true, attachments })`, its `Response` to the feed's `followResponse` | Deleted |
| 3 | `conversations.ts` · `interrupt` · flow call | workforce client `stopTurns` ([D2](DECISIONS.md#d2)); the stop shows until the turns view shows each stopped turn ended | Deleted |
| 4 | `conversations.ts` · `answerApproval` · flow call | `react`'s approval hook, answering the `user_approval` stop | Deleted |
| 5 | `conversations.ts` · `retry` · flow call | workforce client `retryTurn` | Deleted |
| 6 | `src/app/files.ts` · `createClient` · client import | The client built once in `src/main.tsx`, the entry L3 lets import it, handed down by the provider. Whichever Teammates child merges first adds it there | Deleted |
| 7 | `src/app/window.ts` · `topic` · client import | The turns view's `historyStart` and the history summary's mark through `useResource(…, { sessionId })` ([D1](DECISIONS.md#d1)). The divider's data comes from those two reads, not from `useSessionFeed`'s *earlier* paging, which only loads older items | Deleted |
| 8 | `src/components/App.tsx` · `ClientHttpError` · client import | The failed roster read's `status` read off the error itself, with no client value | Deleted |
| 9 | `src/lib/session-feed.ts` · `watchState` · subscribe call | `useSessionFeed`'s `state` | Deleted |
| 10 | `session-feed.ts` · `watchRuns` · subscribe call | `useSessionFeed`'s `runs` | Deleted |
| 11 | `conversations.ts` · `ConversationEntry` · type | The entries drawn from stored items, in `src/lib/` | Screen type |
| 12 | `conversations.ts` · `ConversationView` · type | What the conversation hook hands back, assembled from the feed and the turns | Screen type |
| 13 | `conversations.ts` · `ConversationCalls` · type | The hooks and the workforce client | Deleted |
| 14 | `files.ts` · `AppConnection` · type | Where the page reads a line's files: the page's own base path and fetch | Screen type |
| 15 | `files.ts` · `FileCalls` · type | `client.upload` and a file read in `src/lib/` | Deleted |
| 16 | `window.ts` · `WindowMark` · type | The divider, drawn from the feed, the turns and the summary | Screen type |
| 17 | `window.ts` · `WindowRead` · type | The turns view's row and the resource's value | Deleted |
| 18 | `window.ts` · `HistorySummaryFace` · type | The history summary's own state type from core | Deleted |
| 19 | `window.ts` · `WindowCalls` · type | The conversation hook | Deleted |
| 20 | `src/app/steps.ts` · `SessionStep` · type | One tool call of a turn, drawn from its item; `steps.ts` moves to `src/lib/` (it reads no server) | Screen type |
| 21 | `steps.ts` · `StepRun` · type | A run of a turn's calls in a row, as one line | Screen type |
| 22 | `steps.ts` · `RunSummary` · type | A run's files, commands and time, for its summary line | Screen type |

15 are deleted and 7 become screen types. **Each of the seven needs its own written reason on the
screen-type list, `steps.ts`' three included.** All seven move to `src/lib/`, and today the
ratchet only asks for a reason when a type stays in the same file, so a moved type would pass
without one. The implementer writes the reasons, and review checks them
([Decided, not asked](DECISIONS.md#decided-not-asked)).

**Docs:** no user page. Each of `core`, `engine`, `workforce` and `react` gets a `patch`
changeset, which `/release-docs` writes up. They say four things:
- A session turns row carries `historyStart`.
- Workforce's browser entry exports the history summary resource.
- `useResource` reads a session resource by `sessionId`, with no `useSession` view.
- `send` returns its request id, and `stopTurns` leaves a turn its client sent after the stop
  began. It also says what Stop does not promise across clients.

Teammates is private: the last Teammates child rewrites its README ([the epic's docs line](../../epics/FIX-2683/SPEC.md#whats-in-the-box)).

## Where this meets its siblings

The conversation job shares five edges with FIX-2771 and FIX-2773. The coordinator decided each
one on 2026-11-17, as an engineering call ([ER-8](../../epics/FIX-2683/DECISIONS.md#who-owns-what)).
`poc/entry-ledger/owners.json` records the result: of the 57 entries, each has exactly one owner.

| Edge | With | Decided |
|---|---|---|
| **`session-feed.ts`** | FIX-2771, FIX-2773 | **Decided.** This PR removes `watchState` and `watchRuns` (entries 9, 10). `sessionFeed`, `watch` and `SessionFeed` belong to *the last child off `watchFeed`*. They go with the file, in the PR that moves the last `watchFeed` caller (FIX-2773's run, review and task-copy reads, FIX-2771's message exchange, or this issue's own) off it. Until then, one session can have two feeds open: the hook's feed and the task copies' feed |
| **`steps.ts`** | FIX-2771, FIX-2773 | **Decided: this issue's.** It moves to `src/lib/` and its three types become screen types (entries 20 to 22). The import line in `runs.ts` and `talk.ts` changes to match |
| **The busy dot** (`workers.ts` · `topic`, `Activity`) | FIX-2771 | **Decided: FIX-2771's.** That child deletes `workers.ts` with `watchActivity` in it. This issue leaves both alone |
| **The client in `main.tsx`** | FIX-2771, FIX-2773 | **Decided.** Whichever Teammates child merges first adds the client and the `AppProvider`'s `client` and `pollIntervalMs` to the entry. Entry 6, `files.ts` · `createClient`, stays this issue's either way |
| **The shared types and the fake** | FIX-2771, FIX-2773 | **Decided.** `AppCalls`, `AppState`, `Unsubscribe`, `Item` and `test/fake-app.ts` · `(file)` · `gone` belong to whichever Teammates child merges last. Each child cuts its own scenarios out of the fake and lists them in its ledger. This issue cuts the conversation's scenarios |

## What stays as it is

- Every conversation behaviour the people table names, and every Teammates test that pins one,
  ported to the hooks. Of the 14 test files that build on the fake app, the conversation's
  scenarios are cut from the fake and listed in this issue's ledger; the fake's file goes with the
  last Teammates child to merge.
- `toEntries`, `answeringOf` and the divider's arithmetic: moved to `src/lib/`, not rewritten. A
  near-copy of Claude Code-style's `entriesOf` stays a copy ([ER-7](../../epics/FIX-2683/DECISIONS.md#who-owns-what)), named for FIX-2756.
- `RETRYABLE_SOURCES`, the page's copy of the engine's retry sources, and the test that pins it.
- The roster, hire, context, talk, tasks and runs: siblings' areas.
- `useSessionFeed`, `useView` and the approval hook in `react`: used, not changed. `useResource`'s
  `{ session }` snapshot path stays as it is, beside the new `{ sessionId }` read.

## What's already here, and the debt

| Already here | What this does with it |
|---|---|
| **The job: one conversation, followed and driven** (items, turns, send, stop, retry, answer). Claude Code-style does it on `useSessionFeed`, the session turns view and the workforce client (`labs/claude-code-style/src/app/sessions.ts`, `calls.ts`); Teammates does it on its own calls. Searched `sessionFeed(`, `stopTurns`, `retryTurn`, `sessions.requests(` across `packages/` and `labs/` | **Joined**: Teammates becomes the second app on Claude Code-style's pieces. No new way to do the job |
| `react`'s `useSessionFeed` ([FIX-2757](https://linear.app/fixpoint-labs/issue/FIX-2757)) | **Reused** as is |
| workforce's session turns view ([FIX-2725 D1](../FIX-2725/DECISIONS.md#d1)) | **Extended** with each turn's `historyStart` ([D1](DECISIONS.md#d1)) |
| workforce client `send`, `stopTurns`, `retryTurn` | **Reused**; `stopTurns` leaves a turn its client sent after the stop began ([D2](DECISIONS.md#d2)) |
| The history summary capability ([FIX-1613](https://linear.app/fixpoint-labs/issue/FIX-1613)): `historyStart` on each request, the summary's mark in a session resource | **Read**, through the turns view and `useResource`'s new read by session id |
| The shared inventory and Teammates' settings ([FIX-2769](https://linear.app/fixpoint-labs/issue/FIX-2769), [epic D3](../../epics/FIX-2683/DECISIONS.md#d3)) | **Used**: 15 entries deleted, seven types named with reasons |

| Adds | Existing piece considered | Why it doesn't fit / how composed |
|---|---|---|
| `historyStart` on `SessionTurn` and the turns view's row | `client.sessions.requests` (has it, but is a client value, L3); the session snapshot (no requests) | **Extends** the turns view: the one read of a session's turns a screen already uses |
| A public browser export of the history summary resource | A second `defineResource` of `historySummary` in the app | **Exports the existing definition**: the one workforce's workers already declare (`earlier.resource`), so there is one definition of the resource ([D1](DECISIONS.md#d1)) |
| `useResource(def, { sessionId })`: a session resource read and kept current without a `useSession` view | `useResource(def, { session })`, which only reads a `useSession` snapshot; `useSession` (one chat's hook, a second stream); the mark on the turns view row (a view has no read of another session's resources: `RequestSessions.read` returns readonly state only); the engine recording the mark on the request (the engine knows nothing about summaries, by design) | **Extends** `useResource`. It uses the existing session state route (`client.sessions.state`, `includeItems: false`) and the session topic's `resource` notice, which is what `window.ts` hears today. No new route ([D1](DECISIONS.md#d1)) |
| `stopTurns` leaves a turn its client sent after the stop began, and `send` returns its request id | A Teammates guard around its own `abort` calls; a stop marker on the session that the server checks (D2's option b) | **Extends** the workforce client. The guard needs `.flow(`, which L3 forbids. Claude Code-style has the same race. The `send` change is shared with FIX-2776 |

| The debt | |
|---|---|
| **Removes** | `window.ts` and `files.ts` as call modules, most of `conversations.ts` (384), three call interfaces, and `session-feed.ts`' connection and runs watches; 22 allowlist entries. The rest of `session-feed.ts` (108 lines) goes with the last `watchFeed` caller |
| **Adds** | One optional field on a published view row, one public export of an existing resource definition, one option on `useResource` (a session resource read by session id), and one rule in the workforce client (with `send` returning its request id). All four are permanent by design and ship as `patch` changesets |
| **Leaves** | The conversation entries drawn twice, here and in Claude Code-style (FIX-2756). The scaffolding entries, for the last Teammates child. A second open feed on one session while `watchFeed` has callers ([Where this meets its siblings](#where-this-meets-its-siblings)) |

**Net: down.** About 500 lines of Teammates' calls and 22 findings go. One field, one export, one hook option and one rule come
to packages that two apps share.

## Sign off

**[The goal](#the-goal-and-how-well-know-its-met), at that size:** every conversation screen on
package hooks and clients, this issue's 22 entries gone, the conversation's goals passing. If
wrong: the epic's closure finds Teammates still reaching the server in its conversation.

**[The debt](#whats-already-here-and-the-debt), net down:** Teammates' conversation calls go, and
`session-feed.ts` goes with the last `watchFeed` caller. One view field, one resource export, one
`useResource` option and one client rule come. If wrong: the packages carry reads that only
Teammates uses.

1. **[D1](DECISIONS.md#d1) · Keep the *Earlier turns summarized* divider, with three additive
   package reads: `historyStart` on workforce's turns view, `useResource` by session id, and the
   history summary resource exported.** The one to weigh. If wrong: the packages carry one
   field, one export and one option for one screen in a private app.
2. **[D2](DECISIONS.md#d2) · Stop stops the turns running when it looks and the ones you sent
   before it, and your own follow-up keeps running. A turn from another tab that starts after
   Stop looked may run.** Instead of a stop marker on the server. If wrong: a person who stops
   in one tab and sends from another sees that turn finish, and presses Stop again.

Improvement · `labs/teammates`, `workforce`, `core`, `engine`, `react` · M (22 entries; four
additive package changes, each with a `patch` changeset) · after FIX-2755 and FIX-2769 (both merged) · blocks FIX-2778 ·
[Linear](https://linear.app/fixpoint-labs/issue/FIX-2772) · epic [FIX-2683](../../epics/FIX-2683/SPEC.md)
