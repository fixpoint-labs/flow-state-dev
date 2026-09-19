# FIX-1405 · Business rules

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md)

The cases, as rules. *Proved by* is the check the plan runs. A human reviews this page; the plan
turns it into work.

## Reading the declared tree

| # | When | Then | Proved by |
|---|---|---|---|
| BR-1 | An app reads a tree that loads cleanly | A record for every worker, team, document and channel the three readers return, in their walk order, and an empty `problems` | CI · the same tree both labs read |
| BR-2 | Any reader reports an error | One `problems` entry per reported path, carrying its layer, the path, and the reader's own wording verbatim | CI |
| BR-3 | A seat's skills fail at a level shared by several seats | One entry per affected seat, not one for the level — as the underlying reader reports it | CI · the red state is a single entry |
| BR-4 | A tree has problems | Every record that loaded is still returned; the call returns normally | CI |
| BR-5 | The root itself is unreadable or a symlink | Throws, naming the root, as all three readers already do. The **only** throw | CI |
| BR-6 | A folder no reader walks is added (`boards/`, say) | Records identical, `problems` still empty. An unwalked folder is neither error nor record | Goal check · the existing decoy-tree control |
| BR-7 | A team declares a `TEAM.md` | It appears in `teams`. A team with no file is absent, not present-and-empty | CI |

## Writing the live inventory

| # | When | Then | Proved by |
|---|---|---|---|
| BR-8 | The binder runs over a roster in an org | One row per **seat**, written by the binder from the roster it holds; one row per **open channel**, written by that channel as it registers. Both keyed by the record's own id | CI |
| BR-9 | The binder runs again over an unchanged roster | A no-op. Rows upsert; nothing duplicates, nothing appends | CI |
| BR-10 | A channel's members changed in the file after it opened | The row holds what the **open channel** holds, not the file. Re-opening is not a migration and neither is this | CI · red state: edit a `CHANNEL.md` after opening, re-run the binder, assert the row still holds the session's members |
| BR-10a | The binder registers a channel | It supplies the channel's **id and nothing about its members**. The channel writes the row from its own session state. A binder carrying members would publish the file-time copy under a live name — BR-10 | CI · red state: the binder passing members through |
| BR-22 | An app registers a **custom** channel kind | Its channels get rows as the built-in's do. The write lives on `defineChannelFlow`, never on a `kind === "channel"` branch. A hand-rolled kind carries it as it already carries the singleton contract; one that does not is a named failure (BR-12), never a silent gap — else BR-14's *every* is false for that kind | CI · red state: a second kind whose channels are missing from the inventory |
| BR-23 | A roster shrinks between boots — a channel or seat is removed from the tree | Its row **stays**. The binder upserts, never deletes: a row means *was registered in this org*, not *still declared*. Removal is explicit; a reader tolerates a row naming something it cannot reach | CI · red state: a second boot with a smaller roster silently dropping rows the first wrote |
| BR-11 | The binder is given no `orgId` | Refuses, naming the roster. An org-scoped write with no org is one nobody can read back | CI · the red state is a silent empty inventory |
| BR-12 | One row fails to write | The rest are still attempted and the failure named. One bad channel is not an app with no inventory | CI |
| BR-13 | An app never turns the inventory on | Nothing declared, nothing written, channels behave as today byte for byte | CI · the off state (BP-035) |

## Reading the live inventory

| # | When | Then | Proved by |
|---|---|---|---|
| BR-14 | A flow in the same org reads the channel collection | **Every** open channel's row, whatever kind minted it: id, kind, members, when it opened | CI |
| BR-21 | A seat asks which other seats exist in this org | One row per registered seat — id and kind. The tree cannot answer this at run time, because a block does not walk folders, and it is where membership and fan-out consumers start (ER-3) | CI · a flow that is not a channel reading seat rows |
| BR-16 | A consumer holds both a declared record and a live row | They join on `id` and nothing else. No mapping table, no second identity | CI · type-level and at run time |
| BR-17 | A seat asks which channels it is in | One prefix read of `inventory/members/<seatId>/` — narrowed **in the store**, never by loading every channel and discarding most (BP-033) | CI · the red state is a full-collection read |
| BR-20 | A channel's membership changes in the inventory | The index changes in the same write. It is a projection of the channel row, never written alone | CI · red state is an index row whose channel row disagrees |
| BR-24 | Two **different** flows in the same org read the collections | Both see the same rows. The collections declare `flowIsolation: false` **explicitly**, so an app that sets `flowIsolateOrgState` does not silently give each flow its own private inventory — which would make BR-14 and BR-21 false for every reader but the writer | CI · red state: the same app with `flowIsolateOrgState: true`, a non-channel reader returning nothing |
| BR-15 | A flow reads under a **different** `orgId` | Nothing. Org rows are keyed by `orgId` | CI · two orgs, one process |
| BR-15a | Two **tenants** share one `orgId` string | They share rows. The store keys org state by the bare `orgId`, no tenant component, so this is an **org** boundary and not a tenant one. A multi-tenant host keeps org ids distinct across tenants | CI · a characterization check pinning it, so a later tenant-aware key is a deliberate change rather than an accident |
| BR-18 | A caller wants to know whether a post will be accepted | It asks the channel. The inventory's `members` is a discovery mirror, and a stale mirror is a wrong answer to an authorization question | CI · the inventory is never read on the post path |
| BR-19 | A seat reaches the inventory through a tool | Only if its own `tools:` names that tool. A block colocated with the seat that its file does not name is still not callable; this widens no fence | CI · the red state is an unnamed tool resolving |

![A vertical fence between two planes. Left is the channel session, holding members and the post fence; right is the org inventory, holding one row per open channel. Three paths approach the fence: a discovery read crosses into the inventory, a post check stops at the channel and never crosses, and a write crosses once from the channel into the inventory as it opens.](figures/the-fence.svg)

One path crosses each way; the middle one does not cross at all. That middle path is BR-18, the rule most likely to be got wrong by someone reading the inventory as the truth about membership.

## Failure taxonomy

**Fatal — the only two throws:** an unreadable root (BR-5) and a binder run with no org (BR-11).
Both are wiring mistakes an app should not boot past.

**Collected, never thrown:** everything the readers report (BR-2, BR-4) and a per-row write failure
(BR-12, including a kind that cannot register). The caller decides what is fatal.

**Silent and correct:** the inventory never turned on (BR-13), an org with no rows yet, a row
outliving what declared it (BR-23).

Nothing retries.

## Acceptance criteria this issue owns

Both labs read their tree through the one shared export, their private copies are gone, and every
existing goal check still passes — including the decoy-tree control (BR-6), which makes "the
composer changed nothing" a measurement rather than a claim. Separately: a channel opened under an
org appears in that org's inventory whatever kind minted it (BR-22), and it and the org's seat rows
read back from a **second** flow in the same org (BR-14, BR-21, BR-24) and from no flow in another
(BR-15).
