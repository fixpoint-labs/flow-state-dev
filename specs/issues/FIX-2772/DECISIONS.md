# FIX-2772 · Decisions

[Spec](SPEC.md) · **Decisions**

Two decisions are the sign-off. The epic fixes the rest: one inventory with a shrink-only
allowlist ([D3](../../epics/FIX-2683/DECISIONS.md#d3)), no legacy path, no read-model growth, no
new shared package ([ER-2, ER-3, ER-4, ER-7](../../epics/FIX-2683/DECISIONS.md#who-owns-what)).
What is left is the two places Teammates' conversation does something no package read or client
does yet, and each needs a package change.

## The tree

```mermaid
flowchart TD
  I["FIX-2772 · Teammates' conversations"] --> M["the conversation on useSessionFeed, the turns view and the workforce client · 22 entries go"]
  I --> D1["D1 · keep the divider · historyStart on the turns view"]
  D1 -.->|"rejected · retires a graded goal step"| X1["drop the divider"]
  I --> D2["D2 · stopTurns leaves a line sent after the stop"]
  D2 -.->|"rejected · a tested behaviour lost in both starters"| X2["stopTurns as it is"]
```

Solid edges are what you're signing. Dashed edges lost, and the label says why.

<a name="d1"></a>
## D1 · Keep the *Earlier turns summarized* divider, by adding each turn's `historyStart` to workforce's session turns view

| | |
|---|---|
| **Instead of** | Dropping the divider from Teammates · or keeping `window.ts`' own request read, which needs `topic` and `client.sessions`, two L3 findings the closure must not see |
| **Because** | The divider is where the worker's word-for-word reading begins: the last answering turn's `historyStart`, moved forward by the summary's mark. The engine already records `historyStart` on every request ([FIX-1613](https://linear.app/fixpoint-labs/issue/FIX-1613)), and the client's request list carries it, but no package read a screen may use does: the turns view's row (`id, action, status, source, startedAt, completedAt, error`) leaves it out, and core's `SessionTurn` with it. Step 4 of `a-worker-talks-to-another-while-you-talk` grades the divider on the page, so dropping it retires a goal step. The turns view is the read this issue already moves the conversation's running, stopped and retryable turns onto, so one field there is the whole addition. ER-1: a missing read goes into the package that owns the data |
| **Locks in** | 1. `historyStart: { requestId } \| null` on core's `SessionTurn` (optional, as on the request summary) and on workforce's turns view row.<br>2. The summary's mark is read from the session's `historySummary` resource through `useResource(…, { session })`. No browser-safe handle to that resource exists today. Core's `historySummary(…)` returns `.resource`, and workforce keeps it private as `earlier.resource` in `worker-default-layer.ts`. So this issue adds **one public export of that existing definition**, from workforce's browser entry: the one its workers declare. It is never a second `defineResource` of the same key. If that means splitting the definition out of core's factory, core exports the split piece, and the factory uses it.<br>3. Changesets: `patch` for `core`, `engine` and `workforce`. Per BP-022 / `release-notes-workflow.md`, an optional field and a new export are additive, so no existing code can trip over them.<br>4. No new public term. `historyStart` is the engine's own, and the export is named for the resource it already is (checked against `glossary.mjs` in the implementation PR) |

![D1, the divider. Chosen: keep it, with historyStart on workforce's session turns view. Instead of: drop it. It comes down to step 4 of a-worker-talks-to-another-while-you-talk, which grades it. Price: one more field on a published view and on core's SessionTurn. Tie: Claude Code-style shows no divider today. Flips if the owner retires that goal step](figures/d1-keep-the-divider.svg)

It comes down to the goal step: dropping the divider retires the proof that the summary works on screen.

**What would change my mind:** the owner retiring step 4's divider check as a lab nicety. Then
the divider goes, `window.ts` is deleted outright, and no package changes for it.

<a name="d2"></a>
## D2 · What Stop promises: the turns running when it looks, and your own follow-up line keeps running

| | |
|---|---|
| **The fork** | When you press Stop and send a follow-up straight away, should your follow-up keep running? And how much should Stop promise about a line someone sends from another tab at the same moment? |
| **In plain terms** | Stop looks once at which turns are running and stops each one. **Chosen (a):** Stop stops every turn running when it looks, and every turn you sent before you pressed it. A line you send after pressing Stop keeps running. A line sent from another tab or device that starts after Stop looked may also run. **Instead of (b):** the server keeps a stop marker on the conversation, so it refuses or stops any turn that starts after the press, from any tab. **Also rejected:** `stopTurns` as it is today, which stops your own follow-up too |
| **Because** | Teammates has a test for the follow-up: *leaves a line sent after the press to run on* (`test/watch-on-notice.test.ts`). Today Teammates gets this by naming each send's request id and aborting by hand. That needs a `.flow(` call, which L3 forbids, so the rule has to move into the workforce client. Workforce's `stopTurns` reads `sessions.requests` once (`packages/workforce/src/workers/client.ts`, `stopTurns`), so a turn that another client starts after that read is not in its list. That is true today and in Teammates today, and only a cutoff held on the server can close it, which is (b). No goal grades a stop across clients. The page goals grade a task's stop from its popup (`stops-and-re-runs-a-task-from-its-popup`, `tells-a-stopped-task-from-a-working-one`), which goes through the board, not `stopTurns`. The unit test grades your own follow-up only. So (a) keeps every graded behaviour, and (b) would build server state that nothing asks for |
| **Trade-off** | With (a), the change stays inside the workforce client and Claude Code-style gets the same follow-up fix, but a send from a second tab that races the press can survive the stop. With (b), Stop means the same from every tab, but it costs a new stop marker on the session that admission must check: a change to the engine and to every turn's start path, for a race between two tabs of one person |
| **Recommendation** | (a). It keeps the behaviour Teammates tests, it fixes the same race for Claude Code-style, and it adds no server state |
| **Locks in** | One `send` contract, shared with [FIX-2776](https://linear.app/fixpoint-labs/issue/FIX-2776) (#5365), which also makes `send` take a `taskId`:<br>1. The workforce client sets the request id of each `send`.<br>2. `send` returns `{ requestId }`.<br>3. `stopTurns` stops each turn running at its read, plus each turn this client sent before the call. It leaves each turn this client sent after the call began, and it resolves to the turns it stopped.<br>Whichever implementation PR lands second rebases onto the other's `send`. `stopTurns`' doc says, in these words, that another client's turn which starts after the read may run.<br>`workforce` changeset: `patch`. Per BP-022 / `release-notes-workflow.md`, nothing a caller compiles changes. A caller that awaited `send` for nothing gets a value it can ignore, and `stopTurns` now leaves only the caller's own later sends, which no caller can be depending on being stopped |
| **What would change my mind** | A goal or a user report that needs Stop to hold across tabs: for example, a shared screen where a second person sends while the first stops. Then (b): a stop marker on the session that the engine checks when it admits a turn, with its own spec |
| **If wrong** | Low cost, and easy to reverse. A person who stops in one tab while sending from another sees that turn finish, and presses Stop again. Moving to (b) later adds the marker. It does not undo (a) |

![D2, Stop then send. Chosen: stopTurns leaves a turn its client sent after the stop began. Instead of: stopTurns as it is, which stops the follow-up too. It comes down to Teammates' test that the follow-up runs. Price: a behaviour change in the workforce client. Also: Claude Code-style gets the same fix. Flips if the owner accepts the race in both starters](figures/d2-stop-leaves-the-new-line.svg)

It comes down to your own follow-up: today's `stopTurns` stops a line you sent after pressing Stop, and nothing graded needs Stop to hold across tabs.

## Decided, not asked

- **Where the hooks live.** In what is left of `src/app/conversations.ts` (ER-4: `src/app/` may
  not gain a file, and no file there may grow). `window.ts` and `files.ts` are deleted; the pure
  code they and `conversations.ts` hold (`toEntries`, `answeringOf`, `windowMarkOf`, the file read)
  moves to `src/lib/`, unchanged in behaviour. The implementer may lay it out otherwise inside
  those limits.
- **Reclassifying is not a way out.** Seven types become screen types, each with the reason the
  settings require, the way Claude Code-style names `ThreadEntry`, `ThreadView`, `AppConnection`
  and `ToolStep`: `ConversationEntry` (drawn from stored items), `ConversationView` (assembled
  from the feed and the turns), `WindowMark` (the divider, computed), `AppConnection` (the page's
  own base path and fetch, for a line's files), and `steps.ts`' `SessionStep`, `StepRun` and
  `RunSummary` (a turn's tool calls grouped into a run, from its items). Every other type is deleted.
  **Each of the seven gets its own written reason on the screen-type list, `steps.ts`' three
  included.** Today the ratchet only asks for a reason when a type stays in the same file, so a
  type in a moved file (all seven move to `src/lib/`) would pass without one. The implementer
  writes the reasons, and review checks them. The coordinator is closing that gap in the ratchet
  separately. A type a view returns
  takes its type from the view.
- **The convergence point for "no new finding" is the inventory test**, which every writer of a
  file under `labs/teammates/src` passes through on `pnpm test`; it already fails on a new finding,
  a stale entry and a grown read-model file. Nothing else enforces it.
- **`ClientHttpError` goes by reading the error's own `status`.** `App.tsx` keeps telling a status
  the server answered from a dead socket; it reads `status` off the failed read's error, with no
  client value. The roster watch that throws it is FIX-2771's.
- **Running, stopped and retryable read the turns view**, as Claude Code-style's thread does,
  instead of the last 20 requests. The turns view lists the turn actions only, which is what
  `QUIET_ACTIONS` approximates by leaving out `dispatch`. A stopped line stays once its turn leaves the read, as today.
- **Approvals answer through `react`'s approval hook**, not a Teammates call.
- **`send` streams through the workforce client** and hands its `Response` to the open
  conversation's `useSessionFeed().followResponse`, as Claude Code-style's `threadFeeds` does.
- **Sibling edges, decided by the coordinator (2026-11-17)** as engineering calls
  ([Where this meets its siblings](SPEC.md#where-this-meets-its-siblings)):
  - `session-feed.ts`: this issue removes `watchState` and `watchRuns`. `sessionFeed`, `watch` and `SessionFeed` belong to the last child off `watchFeed`.
  - `steps.ts`: this issue's.
  - The busy dot (`workers.ts` · `topic`, `Activity`): FIX-2771's.
  - The client in `main.tsx`: the first Teammates child to merge adds it.
  - The shared types and the fake's file: the last Teammates child to merge removes them. Each child ledgers its own scenarios.
- **Tests.** Each Teammates test that pins a conversation behaviour is ported to the hooks with
  its assertion intact; the Stop test is the one D2 must keep green.

## Considered and dropped

- **A conversation view or hook in `react` that both starters share.** The epic's ER-7 keeps copies
  as copies until FIX-2756 pulls them out.
- **`useSession` for the conversation.** It is the chat hook for one flow's own session; Claude
  Code-style's thread uses `useSessionFeed` and the turns view, which is the shape this joins.
- **Reading `historyStart` from `useRequestStream`.** It follows one request, not the session's
  latest answering turn.

## Open

None. The coordinator has decided the sibling edges.

<a name="settled"></a>
## Settled

- **The entry counts.** `node specs/issues/FIX-2772/poc/entry-ledger/check.mjs`, on `main`
  `e90786196b`, with the coordinator's rulings: 57 entries, each owned once. This issue owns 22,
  the last child off `watchFeed` 3, FIX-2771 15, FIX-2773 12, and the last Teammates child to
  merge 5. Its negative control, `PLANT=1`, adds an unowned entry, and the check fails naming it.
  The first draft counted 24 (it held the busy dot and all of `session-feed.ts`, without
  `steps.ts`). The rulings moved those entries, and the ledger still finds no overlap.

## Analysis

### Analysis · FIX-2772 issue spec · 2026-11-17 · watermark 2026-11-17

Run inline by the author: this worker has no sub-agent tool. The coordinator's cross-spec review
covers the set.

**Verdict:** right approach.

1. **Reuse.** `useSessionFeed`, the turns view, the workforce client, `useResource` and the
   approval hook: **reuse**. The turns view and `stopTurns`: **extend** (D1, D2). Nothing new.
2. **Prior art.** Claude Code-style, in this repository, on the same pieces.
3. **Other shapes.** Dropping the divider (D1), accepting the Stop race (D2), a shared
   conversation hook (dropped, ER-7).
4. **New factors.** FIX-2769 merged today with the allowlist this reads.
5. **Necessity.** Yes: the epic's closure needs an empty allowlist.
6. **Ergonomics.** A starter's conversation is hooks over package reads, as in Claude Code-style.
7. **Concerns.** Landing order with the siblings for `session-feed.ts`. The coordinator has decided it (the last child off `watchFeed`).

## How it got here

- **Draft** — the conversation job framed as the 24 allowlist entries the epic's row names,
  replaced by Claude Code-style's pieces; two gaps (the divider's `historyStart`, Stop's follow-up)
  go into workforce and core as D1 and D2.
- **Boundaries (2026-11-17)** — the coordinator's rulings on the sibling edges. The busy dot moves
  to FIX-2771. `steps.ts` is this issue's. `session-feed.ts`' last three entries belong to the last
  child off `watchFeed`, as Gitar's review thread also asked. The client and the scaffolding go to
  the first and last Teammates child to merge. This issue owns 22 entries.
- **Review round 1 (2026-11-17)** — Codex P1: `stopTurns` reads the running turns once, so the
  first draft's claim that another client's send "is still stopped" was false. D2 now states the
  narrower promise, (a), as the owner's six-part ask. The alternative, (b), is a stop marker held
  on the server. Codex P2: D1 now counts the public export of the existing history summary
  resource, and every changeset is `patch` (BP-022). The `send` contract is aligned with FIX-2776.
