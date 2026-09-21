# FIX-1476 · The cases

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md) · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

Every rule carries the state that would make it fail — a state somebody can produce, not a
restatement of the rule with *not* in front of it ([BP-003](../../../docs/contributing/best-practices.md)).
For the rules this issue proves, that state is written once, in
[PLAN.md → The checks](PLAN.md#the-checks), and the row names the check. Rules the framework
already owns carry their own red state here, because no check of ours covers them.

## What the tree produces

| # | When | Then | Proved by |
|---|---|---|---|
| BR-1 | `fsdev gen` runs over the app's workforce tree | `channelKinds` names exactly one entry, `digest`, imported from `./flows/channels/digest` | [V1](PLAN.md#the-checks) — the map's content, which is red on `main` today. Staleness is CI's own `fsdev gen --check` over this app and is not copied here |
| BR-2 | The app boots | No line in `hire.ts` or `fsdev.config.ts` names a channel kind. The kinds map is spread from the generated module; only the built-in is named, under the key the binder seeds | [V2](PLAN.md#the-checks) |
| BR-3 | `readChannelsDirectory` reads the tree | Three records come back — `support.desk`, `support.ada-dm`, `support.noticeboard` — and `errors` is empty | The goal's load leg, treating a non-empty `errors` as fatal, as [channels.md](../../../apps/docs/docs/workforce/channels.md) instructs. **Red:** rename `desk/CHANNEL.md` to `channel.md` and the folder lands in `errors` |
| BR-4 | The roster is bound | `support.desk` opens on kind `channel`; `support.noticeboard` opens on kind `digest`; `support.ada-dm` opens on `channel` because it declares no `flow:` | [V3](PLAN.md#the-checks) |
| BR-5 | `openChannels` writes the noticeboard's state | The kind's `stateSchema` admits all three keys the binder writes — `members`, `instructions`, `transcript` — so the open session carries them | [V4](PLAN.md#the-checks). Note what the failure is: a schema that omits a key **strips it silently**. Session create never refuses on a state-schema mismatch, so this rule is about a key going missing, not about an error |

## The boards

| # | When | Then | Proved by |
|---|---|---|---|
| BR-6 | `support.desk` declares `boards: [followups, escalations]` | Its `read` returns `boards: ["followups", "escalations"]` — the local names, as a whole-array equality | [V5](PLAN.md#the-checks) |
| BR-7 | Any file under `apps/kitchen-sink/workforce/` is searched for `support.desk.followups` | Nothing matches. The pair `("support.desk", "followups")` in the runner kind is the explicit wiring and is expected; the **minted id** appears in no file | [V6](PLAN.md#the-checks) |
| BR-8 | A row is filed on `followups` through the channel's own `fileTask` action | `support.wren`'s drain claims it, runs it, and the row comes back `completed` from `readBoard` **and** out of `resourceState` under the minted id | [V7](PLAN.md#the-checks), which proves execution by an effect **outside** the board, because the board's own report is generated on the path under test. That effect is a real one a followup runner would have, not a file written for the harness ([S3](PLAN.md#surfaces)) |
| BR-9 | A row is filed on `escalations` | `support.wren`'s drain never sees it. The row stays `pending` on `support.desk.escalations` | [V8](PLAN.md#the-checks) — the assertion that this is a **subset** drain and not an ambient one |
| BR-10 | The app hires its roster | Exactly one unattended-board warning is emitted, naming `escalations` and the channel; `followups` is not named | [V9](PLAN.md#the-checks) |
| BR-11 | A channel declaring `boards:` is opened with no org | `openChannels` refuses at startup, naming the channel | Framework-owned (`channel-binder.ts`, `openChannels`'s org guard) and unit-pinned upstream. Carried here because [D5](DECISIONS.md#d5) exists to satisfy it, **not re-proved**. **Red for the app:** remove the org constant from the `openChannels` call and the app fails to boot |
| BR-12 | `boards:` is declared on a channel running `flow: digest` | `channelInstances` refuses by name at bind, before anything is registered | Framework-owned (`validate`'s `holdsBoards` branch) and unit-pinned by `channel-boards.test.ts`. **Not re-proved here.** The app satisfies it by shape: the custom-kind channel declares no boards, and [SPEC.md](SPEC.md) states that as the rule rather than an omission |

## Re-running, and what does not migrate

| # | When | Then | Proved by |
|---|---|---|---|
| BR-13 | The app boots a second time over an unchanged tree | Nothing changes. `openChannels` leaves an open channel exactly as it is | Framework-owned idempotence. The app's obligation is to call it on every boot rather than guard it — **red:** guard the call behind a "first boot" flag and a board added to a `CHANNEL.md` never reaches the running app, because the board list is the one thing re-opening *does* carry |
| BR-14 | A `CHANNEL.md`'s `members:` or charter is edited and the app restarts | The open channel keeps what it was opened with. Only `boards:` reaches it | Framework-owned, and stated to readers in [DOCS.md](DOCS.md) rather than worked around. **Red for the docs:** delete the sentence and a reader edits a charter, restarts, and concludes the tree is not read |
| BR-15 | An adopter's host resolves a principal whose org differs from the one this app declares | The **second** boot refuses the reopen by name — a session's org is fixed at creation, and the binder compares the stored org against the one this run asked for. The declared org must equal the verified principal's | Framework-owned (`channel-binder.ts`, the `session.orgId !== orgId` branch). Carried because [DOCS.md](DOCS.md) tells adopters what to do about it. **Red for the docs:** say the declared value is *ignored* under authentication and an adopter ships a configuration that works once and breaks on restart |

<a name="the-words"></a>
## The words — ER-6, decided here and consumed by every other row

[ER-6](../../epics/FIX-1455/BUSINESS-RULES.md) is FIX-1476's to define. Six terms. What a UI
labels, what a file says, and what prose calls it are the same word.

| Word | Is | Is not |
|---|---|---|
| **Seat** | One hired worker instance, addressed by its own id, often with its own session | *worker*, *bot*, *team member*, *agent*. A seat is not an Agent and a seat is not a session |
| **Kind** | A replaceable flow shape, named by `flow:` in a `WORKER.md` or a `CHANNEL.md` and living as one file | *type*, *template*, *role*, *flow*. "Flow" is the framework word one layer down; at Workforce altitude the word is Kind |
| **Agent** | A persistent identity with its own memory, not bound to a session, a channel or a flow | a running seat, a session, a model call. **The riskiest of the six**, because the industry uses it for all three |
| **Channel** | A named session where members talk, optionally holding boards | *room*, *thread*, *conversation*, *group*. A channel is a session — never an instance level of its own, because a channel kind is `cardinality: "singleton"` |
| **Board** | A ledger of rows somebody claims and settles, declared by local name on a channel | *queue*, *backlog*, *list*, *todo*. A board is held by a channel and run by a seat |
| **Team** | The folder that groups seats and channels, and the qualifier in their ids | *org*, *squad*, *group*, *workspace*. A Team is not an org: an org is the storage and identity scope |

**Two levels, not three.** A channel kind is a singleton, so browsing channels goes kind →
sessions. Seats are a collection, so browsing seats goes kind → seats → sessions. Anything in
this set that draws an instance level above a channel list is drawing a node the framework does
not have ([D8](../../epics/FIX-1455/DECISIONS.md#d8)).

**How this is checked, honestly.** By each child's spec review, which is where
[ER-6](../../epics/FIX-1455/BUSINESS-RULES.md) already puts it. The one mechanical check is
scoped to what *this* issue ships — [V10](PLAN.md#the-checks), over the `description:` lines,
charters, board names and channel ids under `apps/kitchen-sink/workforce/`. It does not reach
FIX-1477's component labels and does not claim to.
