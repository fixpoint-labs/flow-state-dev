# FIX-1613 · Decisions

[Spec](SPEC.md) · **Decisions**

What was considered, what was chosen, why, and what each choice locks in. Three decisions are the
sign-off surface. Everything else here is context for them.

## The tree

```mermaid
flowchart TD
  I["FIX-1613"] --> D1["D1 · build the summary and the mark<br/>not the block-facing read of old items"]
  D1 -.->|"rejected"| X1["build both halves<br/>the read's one consumer is gone"]
  I --> D2["D2 · the mark on every turn that has turns out of view<br/>summary on or off · on the request"]
  D2 -.->|"rejected"| X2["mark only when the summary is on<br/>a screen can't say out of view"]
  D2 -.->|"rejected"| X2b["an item in the stream<br/>a new item type for a fact about the turn"]
  I --> D3["D3 · fold at the start of the turn that needs it<br/>in batches · a block of that turn"]
  D3 -.->|"rejected"| X3["fold in the background after a turn<br/>a lost fold drops a turn unsummarized · FIX-2174's"]
```

Solid edges are what you're signing. Dashed edges lost, and the label says why.

<a name="d1"></a>
## D1 · Build the summary and the divider's mark; the block-facing read of a session's old items is not built

| | |
|---|---|
| **Instead of** | Both halves: the original ask (a bounded, newest-first read of a session's items of one component, past the window, for any block) beside the summary Jake's comment added |
| **Because** | The read had one consumer, FIX-1610's channel route record, and channels went with FIX-1786; Workforce's coordinator lines read their last 10 inside the window. The summary doesn't need it either: it folds turns while they are still in the turn's load. Tenet 2: no surface without a caller |
| **Locks in** | The issue's title and Linear text move to the summary and the mark. A block that later needs old items files a new issue against a real caller; nothing here blocks it |

![D1: what FIX-1613 builds. The summary and the mark, chosen, beside both halves. Decides it: a caller for the read. Price: the original ask waits for a consumer](figures/d1-scope.svg)

It comes down to a caller: the read's only one was removed, so it would ship unused.

**What would change my mind:** a caller today that needs a session's items past the window.
FIX-2173 (fork, Backlog) comes closest: its direction lets a `history` function bring in a
*parent* session's items up to the fork point. That is another session's items, cut at a point,
not this issue's newest-first read by component, so its spec designs that read against its own
caller. FIX-2174's manual compact reads through the engine.

<a name="d2"></a>
## D2 · The mark is recorded on every turn that has turns out of view, summary on or off, as `historyStart` on the turn's request

| | |
|---|---|
| **Instead of** | (a) A mark only when the summary is on. (b) An item emitted into the turn's stream |
| **Because** | A screen has to say *out of view* honestly on any flow, and FIX-2154's probe may run with the summary off. The engine is the only place that knows the window: interrupted and parked turns take slots, so a screen's count would be wrong. A field on the request needs no new item type and is written once, with the turn |
| **Locks in** | `historyStart: { requestId, summarized }` on request records and on `SessionRequestSummary`, public from the first release. Absent means every earlier turn was read word for word. Each turn records what it read, so a screen reads the latest |

![D2: where the divider's mark lives. On every turn's request, chosen, beside only when the summary is on. Decides it: any screen can say out of view. Price: a public field on every request past the window](figures/d2-mark.svg)

It comes down to honesty off the summary: without the mark, a screen can't say a turn was dropped.

<a name="d3"></a>
## D3 · The fold runs at the start of the turn that needs it, in batches, as a block of that turn

| | |
|---|---|
| **Instead of** | Folding after a turn finishes, in the background |
| **Because** | A fold that runs before the turn's generators never lets a turn leave unsummarized while the summarizer works. As a block of the turn, its trace and its tokens are that turn's, where a person looking at cost finds them (BP-035). Batching (the oldest quarter of the window at once) makes it one turn in roughly every dozen |
| **Locks in** | On a flow that opts in, the turn that folds waits for one summary call. FIX-2174 moves the fold to the background through the same option; until then the pause is the price |

![D3: when the summary is folded. At the start of the turn, chosen, beside in the background after a turn. Decides it: no turn leaves unsummarized. Price: a pause on the folding turn](figures/d3-when.svg)

It comes down to a lost fold: in the background, a killed fold drops a turn with no summary.

## Decided, not asked

- **`summarize` takes a block**, the author's `summarizer(...)`, so the model, the granularity and
  the objectives are the author's. Core calls it with the summary so far and the turns to fold, and
  reads `summary` from its output. No `summarize: true` default model.
- **One writer of the summary.** The engine's fold step is the only writer of `historySummary` on
  the session record; it writes with the record's version check, and the high-water mark only
  moves forward. Two turns of one conversation at once: the loser keeps the view it loaded and
  does not fold again. That is the convergence point for "a turn is folded once".
  To avoid two summary calls for one fold, a turn re-reads the high-water mark from the session
  record just before it calls the summarizer, and skips the fold if another turn already moved it.
- **When to fold, early.** The fold fires when the oldest unfolded turn reaches the oldest
  quarter of the window, and takes up to a quarter of the window. The turns read word for word
  float between three quarters of the window and all of it. A failed fold has about a quarter of
  the window in turns to succeed before anything leaves; it reads only turns already loaded.
- **The fold takes settled turns in order and stops at the first unsettled one** (running, or
  parked on a gate). The high-water mark never passes a turn that hasn't settled, so a turn that
  settles late is never behind it. If an unsettled turn is about to leave the window, the fold
  moves past it and keeps its id in a pending list on `historySummary`. Each later turn reads
  those ids directly (a get by id, bounded by the list, not a deep read) and folds any that has
  settled, in its own place in the summary. While one is pending the mark reads
  `summarized: false`. A pending turn that retention deletes unsettled is dropped from the list.
- **A session switched on late** starts its summary with what the window holds. What fell out
  before stays out of view, and the mark says so.
- **A failed summary call** is logged, the turn goes on with the summary it had and every turn
  past it, and the next turn tries again. Only a run of failures as long as a quarter of the
  window drops a turn, and then the mark reads `summarized: false`.
- **Order in the turn.** The fold runs after the view of past turns is loaded and before
  `request.onStarted`, and updates that loaded view; Workforce's `resolveTurnWorker` hook sees the
  history it always did.
- **Where the summary goes.** One message before the turns past the mark, worded so any provider
  accepts it in that place (a user-role message, not a mid-history system message). It rides with
  a history read only when that read reaches the mark, so a narrow `history({ limit })` is
  unchanged.
- **The summarizer's items** are not shown in the conversation and are not history: the
  `summarizer` default (no `itemVisibility`) already does this.
- **Retention** can delete turns the summary covers. The summary lives on the session record and
  outlives them, which is the point.
- **Token budgets.** Under `history({ limit: { tokens } })` the summary's tokens count against
  the budget, and the summary rides only when whole turns reach back to the mark; the rest is the
  implementer's.
- **Workforce passes the option through**: `defineAgentWorkerFlow({ historyWindow })` sets the
  flow's `session.historyWindow`. Workforce adds no summary logic. Layer rule: nothing about
  workers in core or engine.

## Considered and dropped

| Alternative | Why not |
|---|---|
| Raise `historyWindow` | Every turn pays for the whole conversation, and it still ends. An invent-kill on this issue since 2026-09-27 |
| Memory alone (the lab's probe) | Keeps facts, not the thread (FIX-1612); a pass on memory is not evidence it replaces the summary (FIX-2154) |
| Fold one settled turn at the boundary, the turn before it would leave | Simpler rules, but a failed call loses that turn on the next one (the flaw the analysis caught), and it is a summary call on every turn once the window fills |
| Summarize every dropped turn on every turn, no batches | One summary call per turn after the window fills; batches cost the same tokens and a twelfth of the pauses |
| A new block kind or a `historySummary` capability | A capability would install per generator, but the summary is one per conversation and the window is flow-level. The option sits where the window is |
| Store the summary in session state | State is the app's schema and is projected to the client by the app's rules |
| A per-worker setting in `WORKER.md` | Session config is per flow. A worker that needs it runs on a flow that turns it on; per-worker can come with FIX-2174 |

## Analysis

2026-10-28 · watermark 2026-10-23 (Jake's extension) · **Right approach; two mechanism flaws folded.**

1. **Reuse** — `reuse-review`: `summarize` extends `historyWindow`; `historySummary` extends the
   session record; `historyStart` is new, argued by D2; the workforce option is a pass-through.
   Named orchestration's `flowPolicy.compact` stub. See [Builds on / Adds](SPEC.md#whats-already-here-and-the-debt).
2. **Prior art** — a running summary plus a recent buffer, folded before loss (LangChain's
   summary buffer, Letta's recursive summary, harness compaction near the limit). Supports folding early.
3. **Other shapes** — a capability or a user-space tap; dropped, recorded in *Considered and dropped*.
4. **New factors** — FIX-2174's high-water-mark comment supports the record field; FIX-2173's
   direction touches D1's *what would change my mind*, now answered there.
5. **Necessity** — right-sized; memory doesn't stand in for the thread (FIX-1612).
6. **Ergonomics** — a narrow history gets no summary, named in the docs line;
   `defineAgentWorkerFlow({ historyWindow })` is a second spelling of a pass-through, accepted.
7. **Concerns** — a failed fold lost turns for good (**folded**: fold a quarter early); a turn
   settling after the mark moved was skipped (**folded**: the mark never passes an unsettled turn).
   Token budgets and the summary's tokens (**recorded** for the implementer, *Decided, not asked*).
   The +1 row is new, not kept (**folded** into the spec's wording). The debt's Adds row was short
   by three items (**folded**).

## How it got here

- **Draft** — framed as FIX-2154 G1 on FIX-1613's issue: an opt-in summary on core's
  `historyWindow` built on `summarizer`, a mark on every turn's request, and the original
  block-facing read dropped for want of a caller.
- **Analysis** — the fold now starts a quarter of the window early and never passes an unsettled
  turn, because a failed or late fold lost turns for good.
- **Review round 1, Codex** — a parked turn the fold moves past is kept by id and folded when
  it settles, because moving the mark past it lost it for good.

- **Review round 1, Cursor** — concurrent turns re-read the high-water mark before the summary
  call; folding one turn at the boundary added to *Considered and dropped*.

## Notes from review

- "Avoid hydrating full items on the +1 probe when only `historyStart` is needed (split query / `withItems: false` tail row). Big perf win on long sessions with summary off." — cursor ([thread](https://github.com/fixpoint-labs/flow-state-dev/pull/4063#discussion_r4403725867))
- "Both snippets use `granularity: \"detailed\"`. For lab latency and the 4k summary signal, `brief` (or documenting workforce defaults) may be a simpler default unless step 4 truly needs detailed." — cursor ([thread](https://github.com/fixpoint-labs/flow-state-dev/pull/4063#discussion_r4403725859))

These are inputs, not instructions. Adopt, adapt, or discard.

**Open: none.**
