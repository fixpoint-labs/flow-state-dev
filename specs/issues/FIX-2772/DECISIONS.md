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
  I --> D1["D1 · keep the divider · three additive package reads"]
  D1 -.->|"rejected · retires a graded goal step"| X1["drop the divider"]
  I --> D2["D2 · stopTurns leaves a line sent after the stop"]
  D2 -.->|"rejected · a tested behaviour lost in both starters"| X2["stopTurns as it is"]
```

Solid edges are what you're signing. Dashed edges lost, and the label says why.

<a name="d1"></a>
## D1 · Keep the *Earlier turns summarized* divider, with three small package reads

| | |
|---|---|
| **The fork** | Does Teammates keep the divider that shows where a worker's word-for-word reading of the conversation begins, at the price of three additive package changes? Or does the divider go? |
| **In plain terms** | The divider's position comes from two facts: the turn where the worker's history window started, and how far the history summary reaches. **Chosen:** keep it. Each turn row of workforce's turns view carries `historyStart`. `react`'s `useResource` learns to read a session's resource by session id. Workforce exports the history summary resource its workers already use. **Instead of:** drop the divider from Teammates. **Also rejected:** keep `window.ts`' own reads, which need `topic` and `client.sessions`: two L3 findings the closure must not see |
| **Because** | The engine already records `historyStart` on every request ([FIX-1613](https://linear.app/fixpoint-labs/issue/FIX-1613)), but no read a screen may use carries it. The turns view's row leaves it out, and so does core's `SessionTurn`. The summary's mark lives in the session's `historySummary` resource. `useResource(def, { session })` only reads the snapshot of a `useSession` view (`packages/react/src/hooks/useResource.ts`, the session branch reads `options.session?.snapshot?.resources` and never fetches), and this spec does not use `useSession`. So the mark needs a read of its own. Two other places for it are ruled out. A view cannot read another session's resources (`RequestSessions.read` returns readonly state only). And the engine must not record a summary mark, because by design it knows nothing about summaries (`core/src/utility/history-summary.ts`). That leaves `useResource` reading by session id, over the session state route and the session topic's `resource` notice that `window.ts` already uses. The divider's data comes from those reads, never from `useSessionFeed`'s *earlier* paging, which only loads older items. Step 4 of `a-worker-talks-to-another-while-you-talk` grades the divider on the page, so dropping it retires a goal step. ER-1 puts each missing read in the package that owns the data |
| **Trade-off** | Keeping the divider costs three additive changes in published packages, each a `patch` changeset: a field in `core`, `engine` and `workforce`, one export in `workforce`, and one option in `react`. Dropping it costs nothing in the packages, but it retires the only on-screen proof that the summary works and turns step 4 of a graded goal into a skip |
| **Recommendation** | Keep it. Each change is additive, has a second use (Claude Code-style can draw the same divider, and any screen can read a session resource by id), and keeps a graded goal step |
| **Locks in** | 1. `historyStart: { requestId } \| null` on core's `SessionTurn` (optional, as on the request summary) and on workforce's turns view row.<br>2. `useResource(def, { sessionId })` at session scope reads `client.sessions.state(sessionId, { includeItems: false })`. It reads again on the session topic's `resource` notice for that resource's name, and as the user and org scopes read, wherever push can miss a change. It has no setters, like `{ session }`. The `{ session }` snapshot path stays as it is.<br>3. One public export of the existing history summary definition, from workforce's browser entry: the one its workers declare (`earlier.resource` in `worker-default-layer.ts`), never a second `defineResource`. If that means splitting the definition out of core's factory, core exports the split piece, and the factory uses it.<br>4. Changesets: `patch` for `core`, `engine`, `workforce` and `react`, per BP-022 / `release-notes-workflow.md`. An optional field, a new export and a new option are additive.<br>5. No new public term. `historyStart` is the engine's own, `sessionId` is the session's, and the export is named for the resource it already is (checked against `glossary.mjs` in the implementation PR) |
| **What would change my mind** | The owner retiring step 4's divider check as a lab nicety. Then the divider goes, `window.ts` is deleted outright, and none of the three package changes is made |
| **If wrong** | Low cost. Each change is additive and used by Teammates' divider alone at first. If no other screen ever reads them, the packages carry one field, one export and one option for a private lab |

![D1, the divider. Chosen: keep it, with historyStart on workforce's session turns view, useResource reading by session id, and the summary resource exported. Instead of: drop it. It comes down to step 4 of a-worker-talks-to-another-while-you-talk, which grades it. Price: three additive package changes. Tie: Claude Code-style shows no divider today. Flips if the owner retires that goal step](figures/d1-keep-the-divider.svg)

It comes down to the goal step: dropping the divider retires the only proof that the summary works on screen.

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
- **Sibling edges** were decided by the coordinator on 2026-11-17, as engineering calls. The
  table lives in one place: [SPEC.md → Where this meets its siblings](SPEC.md#where-this-meets-its-siblings).
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

- **The entry counts.** `node specs/issues/FIX-2772/poc/entry-ledger/check.mjs`, run on
  this branch's merge-base, with the coordinator's rulings: 57 entries, each owned once. This issue owns 22,
  the last child off `watchFeed` 3, FIX-2771 15, FIX-2773 12, and the last Teammates child to
  merge 5. Its negative control, `PLANT=1`, adds an unowned entry, and the check fails naming it.
  The first draft counted 24 (it held the busy dot and all of `session-feed.ts`, without
  `steps.ts`). The rulings moved those entries, and the ledger still finds no overlap.

## Analysis

### Analysis · FIX-2772 issue spec · 2026-11-17 · watermark 2026-11-17

Run inline by the author: this worker has no sub-agent tool. The coordinator's cross-spec review
covers the set.

**Verdict:** right approach.

1. **Reuse.** `useSessionFeed`, the turns view, the workforce client and the approval hook:
   **reuse**. The turns view, `useResource` and `stopTurns`: **extend** (D1, D2). The history
   summary resource: **export** the existing definition. Nothing new.
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
- **Review round 2 (2026-11-17)** — Greptile P1, confirmed against `useResource.ts`: at session
  scope `useResource` only reads a `useSession` snapshot and never fetches, so the export alone
  could not supply the summary's mark. D1 now adds `useResource(def, { sessionId })` over the
  existing session state route and resource notice. The mark on the turns view row and an engine
  field were ruled out. D1 is rewritten as a six-part ask: the fork is the same (keep the divider
  or drop it), and its price grows from one field to three additive reads. Greptile P2: SPEC opens
  on the people table, and the epic's rules follow it. Cursor: the sibling table lives only in
  SPEC, the counts point at the merge-base and `check.mjs` instead of a pinned commit, the
  wiring mermaid is gone, and the divider prose names its data source.
