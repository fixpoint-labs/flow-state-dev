# FIX-1476 · The cases

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md) · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

Every rule carries the state that would make it fail — a state somebody can produce, not a
restatement of the rule with *not* in front of it ([BP-003](../../../docs/contributing/best-practices.md)).
For the rules this issue proves, that state is written once, in
[PLAN.md → The checks](PLAN.md#the-checks), and the row names the check. Rules the framework
already owns carry their own red state here, because no check of ours covers them.

**`support.ada-wren` is the third channel**, renamed from `support.ada-dm` by
[D6](DECISIONS.md#d6). The id is minted from the folder, so moving `channels/ada-wren/` re-keys
it; it holds no `boards:`, which is what makes the rename cost nothing ([D6](DECISIONS.md#d6)).

## What the tree produces

| # | When | Then | Proved by |
|---|---|---|---|
| BR-1 | `fsdev gen` runs over the app's workforce tree | `channelKinds` names exactly one entry, `digest`, imported from `./flows/channels/digest` | [V1](PLAN.md#the-checks) — the map's content, which is red on `main` today. Staleness is CI's own `fsdev gen --check` over this app and is not copied here |
| BR-2 | The app boots | No line in `hire.ts` or `fsdev.config.ts` names a channel kind. The kinds map is spread from the generated module; only the built-in is named, under the key the binder seeds | [V2](PLAN.md#the-checks) |
| BR-3 | `readChannelsDirectory` reads the tree | Three records come back — `support.desk`, `support.ada-wren`, `support.noticeboard` — and `errors` is empty | The goal's load leg, treating a non-empty `errors` as fatal, as [channels.md](../../../apps/docs/docs/workforce/channels.md) instructs. **Red:** rename `desk/CHANNEL.md` to `channel.md` and the folder lands in `errors` |
| BR-4 | The roster is bound | `support.desk` opens on kind `channel`; `support.noticeboard` opens on kind `digest`; `support.ada-wren` opens on `channel` because it declares no `flow:` | [V3](PLAN.md#the-checks) |
| BR-5 | `openChannels` writes the noticeboard's state | The kind's `stateSchema` admits all three keys the binder writes — `members`, `instructions`, `transcript` — so the open session carries them | [V4](PLAN.md#the-checks). Note what the failure is: a schema that omits a key **strips it silently**. Session create never refuses on a state-schema mismatch, so this rule is about a key going missing, not about an error |

## The boards

| # | When | Then | Proved by |
|---|---|---|---|
| BR-6 | `support.desk` declares `boards: [followups, escalations]` | Its `read` returns `boards: ["followups", "escalations"]` — the local names, as a whole-array equality | [V5](PLAN.md#the-checks) |
| BR-7 | Any file under `apps/kitchen-sink/workforce/` is searched for `support.desk.followups` | Nothing matches. The pair `("support.desk", "followups")` in the runner kind is the explicit wiring and is expected; the **minted id** appears in no file | [V6](PLAN.md#the-checks) |
| BR-8 | A row is filed on `followups` through the channel's own `fileTask` action | `support.wren`'s drain claims it, runs it, and the row comes back `completed` from `readBoard` **and** out of `resourceState` under the minted id | [V7](PLAN.md#the-checks), which proves execution by an effect **outside** the board, because the board's own report is generated on the path under test. That effect is a real one a followup runner would have, not a file written for the harness ([S3](PLAN.md#surfaces)) |
| BR-9 | A row is filed on `escalations` | `support.wren`'s drain never sees it. The row stays `pending` on `support.desk.escalations` | [V8](PLAN.md#the-checks) — the assertion that this is a **subset** drain and not an ambient one |
| BR-10 | The app hires its roster | Exactly one unattended-board warning is emitted, naming `escalations` and the channel; `followups` is not named | [V9](PLAN.md#the-checks) |
| BR-11 | ~~A channel declaring `boards:` is opened with no org~~ **Struck (FIX-1442).** A channel declaring `boards:` is opened | It opens. A board always has an address, because every session carries an organization: the one the server resolved for the caller, or `DEFAULT_ORG_ID` when the app configures no `resolvePrincipal` | Framework-owned, and **there is no red state to state**: `OpenChannelsOptions` is `{ client, userId }`, so there is no `orgId` to withhold and no guard left to trip (`channel-binder.ts:113`, and the `openChannels` body comment naming FIX-1442). The rule as written described a refusal the framework cannot produce; it is struck rather than re-aimed, because [D5](DECISIONS.md#d5) no longer exists to satisfy it |
| BR-12 | `boards:` is declared on a channel running `flow: digest` | `channelInstances` refuses by name at bind, before anything is registered | Framework-owned (`validate`'s `holdsBoards` branch) and unit-pinned by `channel-boards.test.ts`. **Not re-proved here.** The app satisfies it by shape: the custom-kind channel declares no boards, and [SPEC.md](SPEC.md) states that as the rule rather than an omission |

## Re-running, and what does not migrate

| # | When | Then | Proved by |
|---|---|---|---|
| BR-13 | The app boots a second time over an unchanged tree | Nothing changes. `openChannels` leaves an open channel exactly as it is | Framework-owned idempotence. The app's obligation is to call it on every boot rather than guard it — **red:** guard the call behind a "first boot" flag and a board added to a `CHANNEL.md` never reaches the running app, because the board list is the one thing re-opening *does* carry |
| BR-14 | A `CHANNEL.md`'s `members:` or charter is edited and the app restarts | The open channel keeps what it was opened with. Only `boards:` reaches it | Framework-owned, and stated to readers in [DOCS.md](DOCS.md) rather than worked around. **Red for the docs:** delete the sentence and a reader edits a charter, restarts, and concludes the tree is not read |
| BR-15 | ~~An adopter's host resolves a principal whose org differs from the one this app declares~~ **Struck (FIX-1442).** An adopter adds authentication to this app | The channels open under whatever organization the server resolves for the caller they are opened as. A session's organization is still fixed at creation, so re-opening cannot move an already-open channel into another one — but nothing compares two organizations at boot, because the app supplies none | Framework-owned. **No red state:** the `session.orgId !== orgId` branch this rule named is gone — `git grep -c orgId origin/main -- packages/workforce/src/channel/channel-binder.ts` → `3`, all three in comments. What an adopter is told instead is in [DOCS.md](DOCS.md) §2: choose the caller, not a constant |

<a name="the-dm"></a>
## Notification, and the DM — added by the owner's reversal

BR-16 is **not about the DM**. It is a general rule about every channel this app opens, and the
DM is the case that made it visible ([D6](DECISIONS.md#d6)).

| # | When | Then | Proved by |
|---|---|---|---|
| BR-16 | A post **that names its author** lands in any channel on the built-in kind | **The named author is not an addressee.** Every other declared member is notified. Both halves are the rule — the author gets nothing, *and* the others still get theirs — because a check on the first half alone passes when delivery is broken and nobody gets anything. On `desk`'s five members that is four deliveries; on `support.ada-wren`'s two it is one, which is why *"a DM notifies only the other one"* needs no rule of its own |
| BR-16a | A post lands **naming no author** | **Every declared member is notified, the poster among them.** Nothing in the delivery says who wrote it, so there is nobody to exclude. This is the hole in BR-16 stated as a rule rather than as a caveat: the skip is only as good as the claim it compares, and this is what "only as good as" means in observable terms | [V13](PLAN.md#the-checks)'s third leg, which asserts it rather than describing it. It closes when FIX-1493 gives the framework a verified per-member identity ([D6](DECISIONS.md#author-identity)); until then a caller who omits `author` gets the pre-BR-16 behaviour and the reference app should not pretend otherwise | [V13](PLAN.md#the-checks). The fan-out hands the app's own notify block both ends of the comparison — the addressee as `member` and the post's `author` — so the skip is user-space and needs no `packages/workforce` change ([S5](PLAN.md#surfaces)). It compares **`author`**, and [D6 → which identity](DECISIONS.md#author-identity) records why that rather than the verified `principal`, what the residual gap is, and why [BP-031](../../../docs/contributing/best-practices.md) does not forbid it. The precondition is in the rule's own *When* rather than buried here, because an unconditional headline over a conditional mechanism is a rule that cannot fail — the omitted-author case is [BR-16a](#the-dm) and is graded, not excused |
| BR-17 | `support.ada-wren` is read | It declares exactly **two** members — `support.ada` and `support.wren`, both seats — and no `flow:` line — it is a channel on the built-in kind, which is what the published [channels.md](../../../apps/docs/docs/workforce/channels.md) already tells readers a direct message is | [V3](PLAN.md#the-checks) covers the kind; the membership — the count **and the two names** — is [V14](PLAN.md#the-checks), which owns the red state. A one-member roster is the shape [D6](DECISIONS.md#d6) reversed, but it is not V14's isolating red state: it co-fails V13 |

**Scope, stated so the diff is not read as a surprise.** BR-16 is general and the notify block is
**shared** — kitchen-sink passes one block to the built-in factory for every channel it opens. So
applying it changes `desk` and the DM alike, and both notify their own poster today. That wider
diff is the point of the rule rather than a side effect: notifying somebody of their own post is
wrong in a five-member channel exactly as it is in a two-member one. (`noticeboard` runs
`flow: digest`, which declares **no fan-out at all** — [S1](PLAN.md#surfaces) — so it notifies
nobody today and is unaffected either way.)

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
