# FIX-1788 · Decisions

[Spec](SPEC.md) · **Decisions** · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

What the model already decided is the epic's ([ER-1](../../epics/FIX-1786/BUSINESS-RULES.md#what-a-team-gets-and-what-it-doesnt),
[D3](../../epics/FIX-1786/DECISIONS.md#d3)) and is not reopened here. These are the calls this
issue makes about forks and about where a session learns its worker. D1 and D2, on hires made
before this release, were withdrawn by [epic D9](../../epics/FIX-1786/DECISIONS.md#d9).

## The tree

```mermaid
flowchart TD
  I["FIX-1788"] --> D3["D3 · a fork copies the shared instructions"]
  D3 -.->|"rejected · an edit to the files changes your fork"| X3["a fork follows them"]
  I --> D4["D4 · a session's worker is named at create"]
  D4 -.->|"rejected · every message carries the worker"| X4["named on the first turn"]
```

Solid edges are what was chosen. D3 is decided, and D4 is this amendment's ask. D1 and D2 were
signed, then withdrawn by [epic D9](../../epics/FIX-1786/DECISIONS.md#d9), so the tree leaves them out.

<a name="d1"></a>
## D1 · Removed by epic D9 · old hires, their memory and their conversations moved by one operator step

Signed by Jake on 2026-10-06; withdrawn on 2026-10-07 by [epic D9](../../epics/FIX-1786/DECISIONS.md#d9): "No consumers yet. No need for
backwards support of any kind." Nothing reads or moves a hire made before this release, its
private cells or its sessions: they are dropped. The card as signed is at
[the commit before the sweep](https://github.com/fixpoint-labs/flow-state-dev/blob/2ab5e6b0bd77c798142a48922131aa52f45f737d/specs/issues/FIX-1788/DECISIONS.md#d1).

<a name="d2"></a>
## D2 · Removed by epic D9 · a worker hired for the whole org went, as a private copy, to each member who talked to it

Signed by Jake on 2026-10-06; withdrawn with D1, by the same call. It decided where the operator
step put an org-wide hire, and the step is gone. The card as signed is at
[the commit before the sweep](https://github.com/fixpoint-labs/flow-state-dev/blob/2ab5e6b0bd77c798142a48922131aa52f45f737d/specs/issues/FIX-1788/DECISIONS.md#d2).

<a name="d3"></a><a name="q1"></a>
## D3 · A fork copies a standard worker's shared instructions; it doesn't follow them

Formerly Q1. Decided by Jake on 2026-10-06 ("I agree with the recommendations").

| | |
|---|---|
| **Instead of** | Following them: a fork picks up the installation's later edits, with its owner's changes kept on top |
| **Because** | Standard workers in model variants (a Codex, a Claude and a Cursor researcher) share core instructions, per the 2026-10-04 lock. A copy is what a library copy does (ER-10): nothing changes under its owner. One rule for every copy a user holds, fork or library. A fork is the user saying they want something different |
| **Locks in** | Alice forks the researcher to change its model. Next month the installation improves the researcher's instructions; her fork keeps last month's text until she forks again. Following later edits may come later as an opt-in on a fork. Taking it away later would change running workers, so it doesn't ship first |

What lost: follow keeps forks current, at the cost of a layered configuration (the file, then the
user's changes, merged on every turn), and an edit to the files would change what runs with every
forker's access.

![D3, formerly Q1: does a fork copy a standard worker's shared instructions or follow them? Copy, chosen, beside follow. Decides it: nothing changes under the owner, the library's rule. Price: forks go stale until re-forked. Locks in one rule for every copy, with following as a later opt-in; flips if users fork to change one setting while the core changes weekly](figures/d3-fork-copies.svg)

It comes down to the library's rule: nothing changes under its owner, so forks go stale.

**What would change my mind:** users who fork mostly to change one setting, while the core
instructions change every week. Then forks stale at once, and the opt-in earns its layering.

<a name="d4"></a>
## D4 · A session's worker is named once, when the session is created

Jake, on #2812's review (SPEC.md, the app example): the worker belongs to the session, not to a
message. The epic records this as D3 change 3's session-record form (#2813).

| | |
|---|---|
| **Instead of** | The worker flow linking the session on its first turn, from a `worker` field in that turn's input (this spec as merged in #2812) |
| **Because** | A session can't change its worker, so a message is the wrong place to name one. First-turn linking was an implementation convenience (create ran no flow code), and it leaked into every app call. At create, the server checks the worker once and nothing after it can touch the link |
| **Locks in** | The engine runs a flow-declared check on every path that writes a new session (S1), and Workforce declares it for every worker flow. No session on a worker flow exists without a worker. The client gains `worker` on `createSession` and on `listSessions`, and Workforce gains `findWorkerSession` and `ensureWorkerSession` |

![D4: where a session learns its worker. At create, in a server-only field on the session record, chosen, beside on the first turn in server-owned state. Decides it: what carries the worker, the session once, so messages never name one. Price: an engine check on every way a session is made. Locks in a create check and worker on create and list; flips if an app must open a session before it knows its worker](figures/d4-link-at-create.svg)

It comes down to what carries the worker: the session, once, at create, so messages never name one.

**What would change my mind:** an app that must open a session before it knows which worker will
run it, such as a triage chat that hands off later. That is a new session per worker today, and
would stay one.

## Decided, not asked

The mechanism lives in [PLAN.md](PLAN.md#surfaces) and is not restated here. S1 covers the one
session-birth function, the create check and the server-written state. S5 covers the link and
the derived id, and S5a the app helpers and racing calls. BR-10 to BR-19c rule the sessions.
What PLAN doesn't hold:

- **Server-written session state ships here, not with FIX-1791.** Epic D3 *Locks in* (3) has
  FIX-1788 pick and build the mechanism and FIX-1791 consume it. The create must also refuse those
  fields before any app can seed them. FIX-1791's delegates ([#2815](https://github.com/fixpoint-labs/flow-state-dev/pull/2815))
  are the consumer.
- **The app-facing API is today's client plus two helpers** (Jake, #2812). They are methods on a
  bound `createWorkforceClient({ userId, baseUrl })`, with the session client's transport options,
  so they need no ambient state and no new endpoint (Codex on #2818). Their criteria object
  grows later: [FIX-1794](https://linear.app/fixpoint-labs/issue/FIX-1794) adds `taskId`,
  [FIX-1793](https://linear.app/fixpoint-labs/issue/FIX-1793) adds `workstreamId`, and FIX-1791
  adds a key for the coordinator conversation a delegate's session belongs to. The engine knows no
  worker.
- **Ids.** A worker's id is unique on its owner's roster and can't be a standard worker's id. A
  fork gets a new one.
- **Fork and the library's copy share one write path.** FIX-1788 owns it; FIX-1795 calls it
  for a template (the epic's coordination seams). No library work is pulled in here.

## Considered and dropped

| Alternative | Why not |
|---|---|
| Keep a copy per worker and narrow the pins | Keeps registration per process: a hire or fire waits for a restart elsewhere, and FIX-1798 can never remove pins |
| The link in plain session state, checked on read | A caller seeds a link to their own other worker through the session create ([epic POC](../../epics/FIX-1786/poc/singleton-worker-link/README.md), O1) |
| The link in a row only flow code writes, keyed by session id | Outlives a deleted session: a new session at the same id inherits it (POC, R1) |
| The link set by flow code on the first turn | Puts the worker in a message ([D4](#d4)) |
| A `getWorkerSession` helper returning a session-bound handle | Today's client already creates, lists and sends; two lookup helpers are all an app needs (Jake, #2812) |
| A worker noun in the engine | No consumer outside Workforce (epic [D3](../../epics/FIX-1786/DECISIONS.md#d3)); the client's `worker` maps onto a generic field |

## Settled

- **Which flows a worker names, and where each is defined:** 23 flows over 94 `WORKER.md`
  files, every file classified, the control failing. [`poc/flow-inventory/`](poc/flow-inventory/README.md).

## How it got here

- **Draft** — framed as the epic's privacy spine: workers as user-scoped rows, one copy per flow,
  a server-owned link set once on the first turn; old hires carried by one operator step, an
  org-wide hire copied to the members who used it; four PRs, engine first.
- **Merged** in #2812 before round two was folded; this amendment carries it.
- **Round two, amendment 1** — D1 and D2 signed; Q1 decided as copy, now D3. The worker moved from
  the first turn to session create (D4), on the review of the app example, with the whole app path
  on today's client plus `findWorkerSession` and `ensureWorkerSession`. The same mechanism holds a
  coordinator's delegates. A worker's later edit, fork or fire is ruled for its sessions.
- **Review of #2818** — S1 became one session-birth function every path reaches, `fsdev run`
  included (second look). FIX-1791's coordinator-conversation key was reserved in the criteria
  object (architect). "Decided, not asked" was cut to what PLAN doesn't hold.
- **Amendment 2, with the epic's gate answers** — the app example passes the same `baseUrl` to
  `createClient` as to `createWorkforceClient`, as FIX-1791's example does; nothing else moved.
- **Amended after merge, the D9 sweep (2026-10-07)** — [epic D9](../../epics/FIX-1786/DECISIONS.md#d9) took out backwards support: D1 and
  D2, the upgrade step (S13, P3), reading an older stored configuration (BR-21), the upgrade
  rules (BR-28 to BR-33a), leg c and V10, the upgrade docs, and the deprecation markers (S2, V2,
  BR-27). [EVOLUTION.md](EVOLUTION.md#amendment-d9) has each.

**Open:** none.
