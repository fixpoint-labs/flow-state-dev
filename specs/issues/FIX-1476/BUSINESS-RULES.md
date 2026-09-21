# FIX-1476 · The cases

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md) · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

Every rule carries **what would make it fail** — a state somebody can produce, not a restatement
of the rule with *not* in front of it. Where the framework already owns a behaviour and a green
goal already pins it, the row says so and does not re-prove it ([BP-003](../../../docs/contributing/best-practices.md)).

## What the tree produces

| # | When | Then | Proved by · what would make it fail |
|---|---|---|---|
| BR-1 | `fsdev gen` runs over the app's workforce tree | `channelKinds` names exactly one entry, `digest`, imported from `./flows/channels/digest` | The committed `workforce.gen.ts`, and `fsdev gen --check` in the app's build. **Red:** delete `flows/channels/digest.ts` and `--check` exits non-zero; today the same assertion is red because the map is `{}` |
| BR-2 | The app boots | No line in `hire.ts` or `fsdev.config.ts` names a channel kind. The kinds map is spread from the generated module; only the built-in is named, under the key the binder seeds | A grep leg in the goal check over both files. **Red:** hand-write `{ digest: digestKind }` into `hire.ts` and the leg fails while every behavioural leg still passes — which is the point of having it |
| BR-3 | `readChannelsDirectory` reads the tree | Three records come back — `support.desk`, `support.ada-dm`, `support.noticeboard` — and `errors` is empty | The goal check's load leg, treating a non-empty `errors` as fatal, as [channels.md](../../../apps/docs/docs/workforce/channels.md) instructs. **Red:** rename `desk/CHANNEL.md` to `channel.md` and the folder lands in `errors` |
| BR-4 | The roster is bound | `support.desk` opens on kind `channel`; `support.noticeboard` opens on kind `digest`; `support.ada-dm` opens on `channel` because it declares no `flow:` | Reading each session's `flowKind` back over the real route. **Red:** drop the `flow: digest` line and the noticeboard's session comes back on `channel` |
| BR-5 | `digest`'s session state is written by `openChannels` | It parses. The kind's `stateSchema` admits the three keys the binder writes — `members`, `instructions`, `transcript` | The same leg: a create that refuses throws and fails the check. **Red:** drop `transcript` from `digest`'s schema; `openChannels` fails at create with the channel named |

## The boards

| # | When | Then | Proved by · what would make it fail |
|---|---|---|---|
| BR-6 | `support.desk` declares `boards: [followups, escalations]` | Its `read` returns `boards: ["followups", "escalations"]` — the local names, as a whole-array equality | The goal check, reading the names off the tree rather than typing them. **Red:** a read that returned every board in the process, or the minted ids, is not array-equal |
| BR-7 | Any file under `apps/kitchen-sink/workforce/` is searched for `support.desk.followups` | Nothing matches. The pair `("support.desk", "followups")` in the runner kind is the explicit wiring and is expected; the **minted id** appears in no file | A grep leg over the whole tree. **Red:** paste the minted id into the runner's `resources` key instead of `followups.id` and the leg fails while the drain still works — the distinction the leg exists for |
| BR-8 | A row is filed on `followups` through the channel's own `fileTask` action | `support.wren`'s drain claims it, runs it, and the row comes back `completed` from `readBoard` **and** out of `resourceState` under the minted id | The goal check, proving execution by a side effect **outside** the board (a file the worker body writes), because the board's own report is generated on the path under test. **Red:** the existing `by-name` control shape — point the runner at `channelBoard("other.team", "followups")` and everything still compiles while the row stays `pending` |
| BR-9 | A row is filed on `escalations` | `support.wren`'s drain never sees it. The row stays `pending` on `support.desk.escalations` | The same check, one extra leg. **Red:** add `escalations` to the runner kind's resources and the row is claimed — which is the assertion that this is a **subset** drain and not an ambient one |
| BR-10 | The app hires its roster | Exactly one unattended-board warning is emitted, naming `escalations` and the channel; `followups` is not named | `console.warn` captured across the real boot. **Red:** wire `escalations` too and the count drops to zero; drop the runner's declaration and it rises to two, naming `followups` as well |
| BR-11 | A channel declaring `boards:` is opened with no org | `openChannels` refuses at startup, naming the channel | Framework-owned (`channel-binder.ts`, `openChannels`'s org guard) and unit-pinned upstream. Carried here because [D5](DECISIONS.md#d5) exists to satisfy it, **not re-proved**. **Red for the app:** remove the org constant from the `openChannels` call and the app fails to boot |
| BR-12 | `boards:` is declared on a channel running `flow: digest` | `channelInstances` refuses by name at bind, before anything is registered | Framework-owned (`validate`'s `holdsBoards` branch) and unit-pinned by `channel-boards.test.ts`. **Not re-proved here.** The app satisfies it by shape: the custom-kind channel declares no boards, and [SPEC.md](SPEC.md) states that as the rule rather than an omission |

## Re-running, and what does not migrate

| # | When | Then | Proved by · what would make it fail |
|---|---|---|---|
| BR-13 | The app boots a second time over an unchanged tree | Nothing changes. `openChannels` leaves an open channel exactly as it is | Framework-owned idempotence. The app's obligation is to call it on every boot rather than guard it — **red:** guard the call behind a "first boot" flag and a board added to a `CHANNEL.md` never reaches the running app, because the board list is the one thing re-opening *does* carry |
| BR-14 | A `CHANNEL.md`'s `members:` or charter is edited and the app restarts | The open channel keeps what it was opened with. Only `boards:` reaches it | Framework-owned, and stated to readers in [DOCS.md](DOCS.md) rather than worked around. **Red for the docs:** delete the sentence and a reader edits a charter, restarts, and concludes the tree is not read |

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
scoped to what *this* issue ships: a leg asserting that no `description:` line, charter, board
name or channel id under `apps/kitchen-sink/workforce/` contains a word from the *is not* column.
**Red:** write `description: The support bot's noticeboard.` into a `CHANNEL.md`. It does not
reach FIX-1477's component labels and does not claim to.
