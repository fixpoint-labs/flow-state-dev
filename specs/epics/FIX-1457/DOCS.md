# FIX-1457 · Documentation draft

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs** · [Evolution](EVOLUTION.md)

**Most of what this set produces is never published.** W5 is release QA: its product is evidence —
a checklist that comes back green, a Lab that hands over an artifact, two seats that collaborate.
A passing proof changes no reader-facing behaviour and gets no page. What *does* reach a reader is
narrow, and this document holds only that.

**All three proofs now have a producer and none has run**, so most of the prose this set will
eventually owe still cannot be written. What changed on 2026-09-22 is *why*: it is no longer that
nobody owns the surface, it is that nobody has built it. That is stated below rather than filled in.
A draft written against a surface nobody has built is a promise, and
[ER-21](BUSINESS-RULES.md) asks for the opposite.

---

## The one shared promise · `apps/docs/docs/workforce/overview.md`

[ER-21](BUSINESS-RULES.md) is the only documentation clause in the set, and it is one claim:
**Workforce is something you run, watch and prove, and the person in it is someone the work asks a
question of — not a second kind of worker.** The Workforce pages teach the first three verbs
unevenly today (`overview.md` and `workers-on-disk.md` teach *describe* and *hire*; nothing teaches
*watch*), and the person appears nowhere.

Written once here so that whichever child ships last does not invent its own version:

> ## Watching a workforce run
>
> A hired roster is not a black box. Every seat is a flow instance and every channel is a session,
> so the same inspector you already point at a flow shows you the workforce: which seats exist,
> which channels are open, what is sitting on each board, and why a row has stopped.
>
> Work stops for a person the same way it stops for anything else — the seat that owns the row parks
> it and says why. The person is not a worker with a queue of their own; they are someone a running
> piece of work asks a question of, and they answer through the app, not by claiming the row.

**This is not publishable yet, and it was not publishable when this spec merged.** It promises a
reading that [ER-Devtool](BUSINESS-RULES.md#er-devtool) has not produced — today a parked row's
reason is only inside a JSON expander and inventory needs a debug flag. Publish it when the
checklist is green, from the child that closes the last failing row. **If W5 exits on five rows of
six** ([Open 1](DECISIONS.md#open)), the second sentence above still holds on rows 1–4 and 6, and
whoever publishes it must not imply an org-wide inventory view that did not ship.

## UPDATE · `apps/docs/docs/devtool/overview.md` and `apps/docs/docs/workforce/inventory.md`

Three reader-facing claims come out of the Devtool checklist, and as of 2026-09-22 they have **two**
owners rather than one. Each is a sentence a reader can act on:

- a parked row shows **why** it is parked, without opening raw JSON —
  **[FIX-1481](https://linear.app/fixpoint-labs/issue/FIX-1481)**, checklist row 4;
- a read-only `references/` document is **visibly distinct** from a mutable `resources/` one, which
  is the distinction [`documents-on-disk.md`](../../../apps/docs/docs/workforce/documents-on-disk.md)
  already teaches on disk and the inspector does not yet show — **FIX-1481**, row 6;
- **inventory is readable at org level** without `FSDEV_DEBUG_ENDPOINTS=1`, which is what
  [`inventory.md`](../../../apps/docs/docs/workforce/inventory.md) describes as data and does not
  describe as something you can look at — **[FIX-1502](https://linear.app/fixpoint-labs/issue/FIX-1502)**,
  row 5, which [FIX-1486](https://linear.app/fixpoint-labs/issue/FIX-1486) blocks in Linear —
  **under one reading of the row, not both** ([Open 1](DECISIONS.md#open)).
  **This one may not ship in W5 at all**; if the owner exits on five
  rows of six, `inventory.md` keeps describing data and gains no reading, and that is the shipped
  outcome rather than an omission to fix later.

**The pages, the wording and the screenshots belong to whichever child ships the change**, in its
own `DOCS.md`. What is fixed here is the *claim set*: three readings, stated as behaviour a reader
gets, never as a Devtool column that exists because a status value was added
([ER-8](BUSINESS-RULES.md)).

**Rows 1–3 of the checklist ride [FIX-1320](https://linear.app/fixpoint-labs/issue/FIX-1320)**, an
epic W5 does not run. Whatever it publishes about the instance list and session switching is its
own; this set does not draft it and must not duplicate it.

## Not drafted yet, and why

| Owed by | What it would say | Why there is no draft |
|---|---|---|
| [FIX-1496](https://linear.app/fixpoint-labs/issue/FIX-1496), ER-DevForce | Nothing, most likely. A Lab completing a path exercises documented surfaces; it does not change them — and its artifact leg lives in `goals/`, which is not published | **Filed, in spec review.** Its own `DOCS.md` carries whatever it owes. If the thinnest path turns out to need an undocumented step, that correction is the child's to publish, against what it actually hit |
| [FIX-1497](https://linear.app/fixpoint-labs/issue/FIX-1497), ER-Collab | Possibly a worked multi-seat example on [`channels.md`](../../../apps/docs/docs/workforce/channels.md) — file → assign → drain → handoff, on today's paths | **Filed, no spec yet**, and the scenario's shape is what the child decides. A pre-written example would fix the shape before anyone ran it |
| [FIX-1474](https://linear.app/fixpoint-labs/issue/FIX-1474) | A named path for notifying a seat **while** filing on a board | **Backlog, and explore first.** It composes existing channel, dispatch and board primitives; until it lands there is no named path to document, and inventing one here would pre-empt the explore |

## Ownership

| Material | Publisher | Specific draft |
|---|---|---|
| The shared *Watching a workforce run* section above | Whichever child closes the last failing checklist row, after ER-Devtool is green | This document |
| Two Devtool readings — the parked reason, and the read-only reference | [FIX-1481](https://linear.app/fixpoint-labs/issue/FIX-1481) | Its `DOCS.md` |
| The third — org-level inventory | [FIX-1502](https://linear.app/fixpoint-labs/issue/FIX-1502), **not FIX-1481** · re-owned 2026-09-22 · may not ship this epic | Its `DOCS.md`, once it has one |
| The instance list, session switching and request inspection | [FIX-1320](https://linear.app/fixpoint-labs/issue/FIX-1320) — **not this set** | Its own spec |
| A multi-seat worked example, if the scenario warrants one | [FIX-1497](https://linear.app/fixpoint-labs/issue/FIX-1497), once it has a spec | Its `DOCS.md` |
| A named notify-and-file path, if it lands | [FIX-1474](https://linear.app/fixpoint-labs/issue/FIX-1474) | Its own spec |

**Tracking ids stay in this document.** Everything under `apps/docs/` is published documentation and
carries no issue or PR numbers ([`user-docs.md`](../../../docs/contributing/user-docs.md), the
outsider rule). The quoted block above is page text; the ids around it are not.

## No documentation impact

**[FIX-1467](https://linear.app/fixpoint-labs/issue/FIX-1467).** Already published by itself.
[`documents-on-disk.md`](../../../apps/docs/docs/workforce/documents-on-disk.md) teaches
`references/` versus `resources/`, the shared namespace, the four derived fields a `references/`
file may not declare, and the migration. This set restates none of it.

**[FIX-1468](https://linear.app/fixpoint-labs/issue/FIX-1468).** A handle type that omits
`writeContent`. Additive and typed; whether it needs a line in `packages/*/README.md` is its own
call, not a set-level promise.

**[FIX-1469](https://linear.app/fixpoint-labs/issue/FIX-1469).** A decision about the graded labs'
document migration, under `goals/`, which is not published. Its kitchen-sink half is stale and
belongs to [FIX-1455](https://linear.app/fixpoint-labs/issue/FIX-1455) ([D9](DECISIONS.md#d9)).

**~~[FIX-1458](https://linear.app/fixpoint-labs/issue/FIX-1458)~~.** Canceled. It shipped nothing, so
it documents nothing; its constraints survive as [D2](DECISIONS.md#d2) and [D7](DECISIONS.md#d7).
