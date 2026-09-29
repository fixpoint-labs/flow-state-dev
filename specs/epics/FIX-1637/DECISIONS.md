# FIX-1637 · Decisions

[Spec](SPEC.md) · **Decisions** · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

The calls above any single issue. D1 is open and the owner's: it overrides the PRD's
three-child split. D2 tests the epic's own kill line. D3 corrects one line of the Architect's
guidance against what ships. The rest were decided here so no child reopens them.

## The tree

```mermaid
flowchart TD
  E["FIX-1637"] --> D1["D1 · one page, one writer · open"]
  D1 -.->|"alternative"| X1["three children, three pages, as the PRD split them"]
  E --> D2["D2 · a new page that links the rest"]
  D2 -.->|"rejected"| X2["a nav or index change only"]
  D2 -.->|"rejected"| X2b["grow the Work that outlives the turn guide"]
  E --> D3["D3 · the event row names only shipped doors"]
  D3 -.->|"rejected"| X3["FIX-441's topic bus · notify and NotificationFlow"]
```

<a name="d1"></a>
## D1 · One page from one writer: fold FIX-1638 and FIX-1640 into FIX-1639? · open

| | |
|---|---|
| **Instead of** | The PRD's split: three children, three pages (the guide, the config matrix, the glossary), each written in isolation, as the Architect's "do not merge bodies" note asks |
| **Because** | All three describe the same five surfaces: webhook ingress, schedule dispatch, `dispatcher()`, the `{ id }` / `{ key }` policy, channels and boards. Three isolated writers produce three phrasings of one thing, the drift `polish-docs` exists to clean. The split also costs two extra spec gates and a cross-spec pass for a three-column table and three definitions |
| **Locks in** | FIX-1639 publishes everything. The table may still be its own linkable page inside FIX-1639 if the writer finds it reads better. FIX-1638 and FIX-1640 close as folded only when the owner says so |

### Fold the table and the terms into the page, or keep three children?

**Plain terms.** The PRD asks for three documents: a guide, a table of where settings live, and
a short glossary. They explain the same handful of features. Written by three people who never
see each other's drafts, they'll describe those features three slightly different ways, and a
reader will find the disagreements.

**The trade-off.** Folding gives one consistent page for one review. It overrides the owner's
split and the Architect's note. Every deliverable still ships; only the number of tickets changes.

![Fold into one page, recommended, beside three children as the PRD split them. Decides it: one writer describing five features once, where three would describe them three ways. Price: overriding the owner's split and the Architect's note. Tie: every deliverable ships either way. Locks in FIX-1639 as the only writer. Flips if the owner wants each deliverable reviewable on its own](figures/open-one-page.svg)

It comes down to consistency: three isolated writers describe five features three ways.

**My recommendation.** Fold. The table and the terms read against the page they sit in, so
they should be written with it.

**What would change my mind.** If you want the table or the terms reviewable and linkable on
their own schedule, say for FIX-453's architecture work or a design partner, keep them split.

**What being wrong costs.** Low and reversible: one fold to re-split, before any page is written.

<a name="d2"></a>
## D2 · A new page that links the existing ones, not a nav change and not a longer guide

| | |
|---|---|
| **Instead of** | A sidebar or index entry pointing at the eight existing pages (the kill line's second clause) · adding webhooks, schedules and the table to *Work that outlives the turn* |
| **Because** | Checked against `main`. Three things the outcome needs exist on no page: the flow / host / ops table, the queue-host `{ id }` fence on the guides' reading path (it lives in a reference refusal table and the channels page), and the terms. A nav entry can't supply them. *Work that outlives the turn* is the right map for step 3 and the wrong home for webhooks and schedules, which start work rather than outlive it |
| **Locks in** | One new guide page. *Work that outlives the turn* stays the step-3 map and gains a link; the page links it rather than repeating it |

**What would change my mind:** the three missing pieces fitting in a short section of an
existing page without it losing its subject. Then the kill line holds and FIX-1639 is a nav edit.

![A new page that links the rest, chosen, beside a nav change only. Decides it: three pieces no page has, which a nav entry cannot supply. Price: one more guide beside Work that outlives the turn. Locks in a page that links rather than repeats. Flips if the missing pieces fit an existing page](figures/d2-new-page.svg)

It comes down to what's missing: a nav entry can point at pages, not supply the table.

<a name="d3"></a>
## D3 · The event row names only doors that ship

| | |
|---|---|
| **Instead of** | The Architect's suggested event-ingress row on FIX-1638: FIX-441's topic, or notification, bus (`.notify(topic)` and `NotificationFlow` subscribers), cited as Done history. Only that bus is rejected. Cross-flow delivery itself ships and stays on the row |
| **Because** | [FIX-441](https://linear.app/fixpoint-labs/issue/FIX-441) is **Canceled**, and neither name is exported. The Proof requires every key on the page to resolve to a shipped export. What ships: **`dispatcher({ flowKind, action, session })` into the receiver's `internal.actions` is the cross-flow bus**, for another flow on the same server; any other source (a queue, a bus) mounts a custom `InboundTransportAdapter`. Workforce's channel wake is the L2 fan-out and belongs to the channels section |
| **Locks in** | The table's event row has two lines, both shipped, and the first names `dispatcher()`. One event to many flows is one dispatcher per receiver, or a router. FIX-1639 rewords the `notification` row in *Inbound transports → Known sources* as drift: it keeps the value, since core's `InboundSource` still lists it and the DevTool still labels it, and stops describing it as cross-flow event subscribers, which no shipped transport emits. FIX-441 is soft-related, never reopened |

**What would change my mind:** a pub/sub surface shipping before FIX-1639 publishes. Then the
row names it.

![Only shipped doors, chosen, with dispatcher as the cross-flow bus, beside FIX-441's topic bus the guidance named. Decides it: notify and NotificationFlow are not exported, so a reader's code fails to compile. Price: no one-to-many topic in the row. Locks in two shipped lines in the event row and the notification source row reworded, not removed. Flips if a pub/sub surface ships first](figures/d3-shipped-doors.svg)

It comes down to the export check: the canceled topic bus on the page fails the Proof.

## Who owns what

![Who owns what: eight rules by FIX-1639, FIX-1638, FIX-1640 and the closure FIX-1642. FIX-1639 owns the page, the fence statement, the project's verified-caller rule, the drift fixes and the contributor line; it owns the table and the terms under D1, with dashed cells showing FIX-1638 and FIX-1640 owning them, and FIX-1638 owning the verified-caller rule, if D1 re-splits. The closure owns the proof and consumes every other rule](figures/ownership.svg)

Every rule has one owner today, the project's PR-1 included. The dashed cells are where
ownership moves if the owner answers D1 with a re-split; nothing else changes. FIX-1641 owns no
rule and has no column: it consumes ER-6.

## Decided, not asked

- **`epic-wake` moves out of published docs.** One line in `docs/contributing/orchestration.md`
  says it is contributor tooling and not the product's *wake*. The outsider rule
  ([`user-docs.md`](../../../docs/contributing/user-docs.md)) keeps internal tooling names out
  of `apps/docs`, which mentions none of `epic-wake`, Conductor or DevForce today. Holds whether
  D1 folds or re-splits; it departs from the PRD's letter, so it's flagged in the PR.
- **Three terms, one definition each.** *Wake*: something outside the flow (a webhook delivery,
  a schedule tick) starts a run through the host. *Dispatch*: a flow sends one unit of work to
  an entry, into its own session or an existing one. *Schedule tick*: your scheduler calling a
  schedule's dispatch endpoint. The two Architect notes phrase *wake* slightly differently; this
  one reconciles them to what the reference pages do.
- **The ops column names what fires, and links.** It never says how to deploy on a cloud. The
  per-scheduler and deploy guides already exist.
- **FIX-1641's authoring shapes stay in the example.** Filed while this spec was written, with
  its examples PR (#2369) already open: a `WORKER.md` wake block, today's flow-level bindings,
  and a `wakes:` alias, each compiled by user-land code in `examples/wake-authoring` to the
  bindings that ship. No framework API changes, so ER-6 holds. The page may link the example
  and teaches neither as a framework feature. It blocks the closure because every child does,
  not because the closure checks it: the run proves the page alone. The page never waits for it.
- **The page lives in the guides site.** Placement in the sidebar is FIX-1639's; the closure
  starts from the nav, so it must be reachable there.

## Decided in review, recorded so no child reopens them

- **FIX-1641 stays a child and keeps its block on the closure.** Review asked to unblock it,
  since the run proves only the page. The closure rule wires every child
  ([`orchestration.md`](../../../docs/contributing/orchestration.md#the-closure-issue-every-epic-ends-in-qa)),
  so the closure run waits for #2369 to merge or for the owner to close FIX-1641 with its
  findings filed to FIX-1639, which drops the block. The page does not wait either way.
- **D3 rejects the topic bus only.** Owner clarification on the PR: `dispatcher()` into
  `internal.actions` is the shipped cross-flow bus and the event row names it. The invent-kill
  is FIX-441's `.notify` / `NotificationFlow`.
- **The `notification` source row is reworded, not removed.** The runtime still recognizes the
  value, so removing it would make the docs disagree with the DevTool.
- **After-request work is a dispatched run, never a side chain.** `.sideChain()` is
  request-scoped: the request stays open until it settles. The table's keeps-going row names
  `dispatcher()` alone.
- **The fence follows the effective dispatcher, not the host's package.** A `bullmqWorker`
  process in `worker-only` mode installs no dispatcher and does not refuse `{ id }`; `colocated`
  and `dispatch-only` do, as does a custom dispatcher without `dispatchLocal`.

## What the end-state POC showed

No end-state POC. Docs only, and the assembled surface is one page; the closure run is the
end-state check. FIX-1641 is a child's exploration of authoring shapes, not a test of the
set's division.

## How it got here

- **Drafted (2026-09-29)** from the owner's PRD and the Architect's guidance on FIX-1637,
  FIX-1638, FIX-1639 and FIX-1640. Checking the guidance against `main` found FIX-441
  canceled (D3), a `notification` source row still describing its subscribers, and the per-scheduler guides already
  published. Closure FIX-1642 filed. FIX-1641 (wake authoring POC) joined the same hour and
  was wired to block it. Project rule PR-1 inherited from the project spec (#2367).
- **Review, 2026-09-29.** The owner narrowed D3's rejection to the topic bus. Codex's checks
  turned D3's `notification` row from removed to reworded, took `.sideChain()` off the
  keeps-going row, and scoped the fence to the effective dispatcher. FIX-1641's block on the
  closure kept and explained. No decision reversed.

**Open: D1.**
