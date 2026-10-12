# FIX-1872 · Decisions

[Spec](SPEC.md) · **Decisions** · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

What was chosen, what lost, and what each choice locks in. Two decisions are the sign-off surface.
The direction itself, a post that needs an answer is a task and the claim ticket is the only fence,
is the epic's [D2](../../epics/FIX-1870/DECISIONS.md#d2), decided by the product owner and not
reopened here.

## The tree

```mermaid
flowchart TD
  I["FIX-1872 · one fence"] --> S["sort · no post today is a tell · POC"]
  I --> D1["D1 · a post row runs on the delegate's own post entry"]
  D1 -.->|"rejected · any task-taker could be handed a post"| X1["fold posts into ordinary tasks"]
  I --> D2["D2 · the model names who · the post goes as written"]
  D2 -.->|"rejected · the delegate reads a paraphrase"| X2["the model writes the task like any other"]
```

Solid edges are what you're signing. Dashed edges lost, and the label says why.

<a name="d1"></a>
## D1 · A post row is worked on the delegate's own post entry, not folded into ordinary tasks

| | |
|---|---|
| **Instead of** | Posts become ordinary task rows, worked on the `work` entry every task-taking worker has. `delegatedPostEntry` retires and "takes posts" stops being a separate thing |
| **Because** | Who can be handed a post is part of what the person gets. Today a coordinator hands a feature request to the EM, which takes posts, and not to the coder, which takes only tasks; the FIX-1791 check's leg a and FIX-1826's measured `takes` reads rest on that split. Folding would let any task-taker receive a post, which changes who answers (epic ER-8, and its kill line). Keeping the entry changes only the fence, which is all D2 asked (tenet 2: realign what exists) |
| **Locks in** | Delegate flows keep declaring `delegatedPostEntry(turn)`, the same helper and argument, and a post reaches only them. Where it is declared may move by one line, so the board can reach it: each app with its own delegate flow edits that line, and FIX-1887's rename map carries it as a declaration move. Two entries stay, `work` for tasks and the post entry for posts, both behind the one claim gate |

![D1, where a post's row is worked. Chosen: on the delegate's own post entry. Instead of: on the ordinary task entry, retiring the post entry. It comes down to the first row, who can be handed a post: chosen, only a delegate that takes posts, as today; instead, any task-taking worker, so a coder can get a feature request meant for the EM. Second row, the price: chosen keeps two entries an app may declare and may move one line; instead has one entry. Third row, a tie: the answer is fenced once by the claim ticket either way. Locks in delegatedPostEntry kept, one possible line move per app. Flips if the product wants any task-taking worker to receive posts](figures/d1-post-entry.svg)

It comes down to who can be handed a post: folding lets a coder get the EM's feature request.

**What would change my mind:** the product wanting a post to reach any worker that takes tasks.
Then folding is the simpler shape, and `listDelegates`' `takes` loses a value.

<a name="d2"></a>
## D2 · On a post, the coordinator's model names who; the post goes as written

| | |
|---|---|
| **Instead of** | Under judgment, the model writes the task with `dispatchTask` like any other task: its own goal and title, which the delegate reads |
| **Because** | A delegate today reads `<who wrote it>, through <coordinator>: <the post>`, with the conversation's recent lines, and answers that. A paraphrase changes what it answers, and the FIX-1791 check grades a held-out word arriving intact. The post's identity also has to come from the server, so a second hand-off of the same post to the same delegate in one round is skipped rather than filed twice (BR-2) |
| **Locks in** | On a coordinator turn that is routing a post, `dispatchTask` takes the post being routed as its task, filled from the server; the model chooses `to` and, for a workstream, `target`, and nothing else. A coordinator can't add its own framing to a post. It can still file an ordinary task in its own words, which is a separate row and a separate answer |

![D2, what the delegate reads when the judgment turn hands on a post. Chosen: the post as the person wrote it, with who wrote it and the recent lines. Instead of: the task the model writes, as for any dispatched task. It comes down to the first row, what the delegate answers: chosen, the person's own words, as today; instead, the model's paraphrase, which can drop a detail. Second row, the price: chosen gives dispatchTask a post form on a coordinator turn, a shape only coordinators see; instead, one shape everywhere. Third row, a tie: the routing record names who either way. Locks in the model names who and target, nothing else, on a post. Flips if the product wants coordinators to brief delegates in their own words](figures/d2-post-as-written.svg)

It comes down to what the delegate answers: a paraphrase can drop the detail the person asked about.

**What would change my mind:** the product wanting a coordinator to brief its delegates in its
own words. Then a post becomes an ordinary task the model writes, and the person's message is
only context.

## Decided, not asked

- **No post today is a tell.** Every way onto the post entry expects an answer back
  ([POC](poc/inventory/README.md), F1 to F3). So nothing becomes a plain message, and no tell
  path is built. The one plain message that remains is the round-deadline wake (BR-12), which
  carries no answer and decides nothing.
- **The row is worked in the session the post goes to today:** the delegate's own session for
  this conversation, or for a workstream the session its entry names. Existing sessions are
  reused, with their history. Never a task session (FIX-1794's review round 2 rule).
- **A post row's ending is the coordinator's, not the generic task notice's:** it lands the
  delegate's reply as its line, feeds the round, and wakes no turn. A failed or cancelled post row
  writes no line, as a failed post writes none today (BR-9).
- **A post row's identity is server-derived** from the post, round and delegate record, so a
  replayed routing and a second hand-off file nothing new. Top-level row fields, never `metadata`
  (BP-031).
- **Post rows are ordinary rows on the board**, listed and cancellable like any. Hiding them
  would be the special kind of task epic ER-9 rules out.
- **Row cost is accepted** (epic D2). It is bounded and measured, not avoided (BR-22).
- **A delivery in flight at the upgrade loses its answer.** The entry it would answer on is gone;
  its round closes at its deadline (BR-19). Keeping the old entry for a drain period would ship
  two fences (epic ER-10).
- **`target` is accepted on a post only.** An ordinary task to a workstream is still refused
  (BR-15), so lifting FIX-1794's refusal stays inside coordinator posts, as the epic asked.

## Which methods already do this job

The job: hand work to another worker and hear its one answer. Searched by `wait`, `answer`,
`handOff`, `deliver`, `notice`, `onTaskSettled` and `dispatcher(` across `packages/`.

| Entry | What it does |
|---|---|
| The coordinator's `handOff` + delivery ledger (FIX-1791) | Delivers a post, answer fenced by a token. **Retired here** |
| The board's task tools and `onTaskSettled` (FIX-1794) | Files a row, hears its ending once. **The closest; posts move onto it** |
| `dispatchTask` (FIX-1875) | Starts a row now, can wait. **The path posts are sent through** |
| `dispatcher()` with `session: { from: true }` (FIX-1312) | Flow-code transport, no fence. Kept for the deadline wake |

Two entries did the job the same way; this issue folds the first into the second.

## Considered and dropped

| Alternative | Why not |
|---|---|
| Keep the post entry as an internal entry and pass the claim ticket in the post | The ticket would travel through another flow's input and back, and nobody renews the row's lease while the delegate works. A fence carried in a payload is the token again |
| Keep the round's record of which rows it waits on as the fence | It never refuses anything, so it isn't one. It stays as bookkeeping only (BR-13) |
| A tell path for some posts | No post is a tell (the sort) |
| Hide post rows from the board | A task shown differently, which epic ER-9 defers |

## Settled

- **No coordinator post today is a tell** — **CONFIRMED** by
  [`poc/inventory/`](poc/inventory/README.md) on `da8f63fd7`: two dispatchers onto the post entry,
  two routes into them, and the entry sends back only an answer or a report of none. Its negative
  control fails as it should.

## How it got here

- **Draft** — framed as epic D2 made concrete: posts sorted (none is a tell), every post a row
  through `dispatchTask`, worked on the delegate's own post entry in its existing session, with the
  ledger, its two entries and `handOff` gone in one PR.

**Open: none.**
