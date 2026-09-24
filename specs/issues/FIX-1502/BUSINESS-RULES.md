# FIX-1502 · Business rules

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md) · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

The cases, written as rules. Each says what a person or the system does and what happens. *Proved
by* names the check in [PLAN.md](PLAN.md). **VG** is the goal check on a live hire in a real
browser; the rest run in CI.

## Reading the organization

| # | When | Then | Proved by |
|---|---|---|---|
| BR-1 | A session on a flow that declares the inventory lists a collection | 200, one entry per row in **the session's own organization**, each carrying only the collection's named fields | V1 · VG |
| BR-2 | Two organizations hold rows in the same store | Each organization's sessions see only their own. Neither sees the other's, on any of the three collections | V1 · VG |
| BR-3 | A collection with the same pattern is declared **without** the read | 403 *state read not permitted*. The read is the collections' declaration, never a route default | V1 |
| BR-4 | The request names an organization in its body, query or headers | Ignored. The organization is the session's, set when the session was made | V1 |
| BR-5 | A row carries a key the named fields leave out | The key does not reach the browser | V1 |
| BR-6 | The session's resource manifest is read | It lists the three collections as readable on a channel built with the inventory on, and lists none of them on a channel built without | V2 |

## What the DevTool shows

| # | When | Then | Proved by |
|---|---|---|---|
| BR-7 | A session's manifest lists **any** readable inventory collection — all three on a channel, only the seat collection on a flow carrying the hire tools | An Inventory tab appears on that session. On any other session it does not | V3 |
| BR-8 | The tab is open | **One section per collection the flow declares.** Seats: one row per seat, with its kind, and the channels its membership rows name when the membership collection is declared. Channels: one row per channel, with its kind, its members and when it registered. Nothing is inside an expander | V3 · VG |
| BR-24 | The flow does **not** declare one of the three collections | That section reads *not installed on this flow*. **Never an empty list**: a collection that is absent and one that holds no rows look different to a reader | V3 |
| BR-25 | The tab makes any request — the manifest, and every page of every collection | Through the DevTool's shared client seam, so an app that authenticates with a bearer token gets it on each request. A reader built on a bare client would return 401 in any app with a principal resolver | V3 |
| BR-9 | There are more rows than one page | Every page is read; nothing is silently cut. A read that fails partway says how far it got | V3 |
| BR-10 | The read is refused (403) or the collection is unknown (404) | The tab says so in words, with the status. **Never shown as an empty organization** | V3 |
| BR-11 | The organization has no inventory rows | The tab says nothing is registered and that an app registers rows by opening its inventory at boot | V3 |
| BR-12 | Any heading, label or empty state | Says *registered*. Never *open*, *live*, *online* or *active* ([D2](DECISIONS.md#d2)) | V3 |
| BR-13 | A channel row's members and the membership rows disagree | Each is shown from its own collection. The view does not reconcile them, so a mismatch is visible | V3 |
| BR-14 | A channel row predates `members` or `openedAt` | Members read as none and the time as unknown. Nothing throws ([BP-030](../../../docs/contributing/best-practices.md)) | V3 |
| BR-15 | A seat was fired after it registered | It is still listed as registered. **Today's behaviour, asserted as today's**, so [FIX-1540](https://linear.app/fixpoint-labs/issue/FIX-1540)'s fix flips this check deliberately | V5 |
| BR-16 | The DevTool shows the inventory | It names no organization id and offers no organization picker | V3 |

## Where the rows come from

| # | When | Then | Proved by |
|---|---|---|---|
| BR-17 | The lab's served app boots | It hires, opens its channel, then opens the inventory, in that order and in-process, under the organization its sessions run in | V4 · VG |
| BR-18 | The boot's inventory step reports problems | The app refuses to start and names them. A half-registered organization is not served | V4 |
| BR-19 | The internal seat-writing step | Stays reachable only from inside the process. No route is added to reach it over HTTP | V4 |
| BR-20 | The lab boots twice over the same database | No row is duplicated, and a channel keeps its first registration time | V4 |

## What must not change

| # | When | Then | Proved by |
|---|---|---|---|
| BR-21 | The debug endpoints, their gate and their origin allow-list | Unchanged. The existing debug-gate suite passes unmodified | V6 |
| BR-22 | FIX-1481's row-4 leg and FIX-1497's collaboration check run against the lab after it gains the boot | Both still pass | V6 |
| BR-23 | The roster collection and its panel | Untouched. The view never labels inventory rows as the roster | V6 · review |

## Failure taxonomy

A refused or failed read is **named in the view and never degrades to empty** (BR-10), and
neither does a collection the flow never declared (BR-24). A boot that
could not register its inventory is **fatal for the lab** (BR-18), because a checklist graded on
half an organization proves nothing. Nothing retries. An empty organization is not a failure; it is
stated (BR-11).

## Acceptance criteria this issue owns

A person runs the lab under `fsdev dev` with the debug endpoints off, opens the channel's session
in the shipped DevTool, and — with nothing expanded — reads every seat the tree declares, the
channel, and who is in it, exactly as the store holds them for that organization, while a second
organization's rows planted in the same database appear nowhere. That is VG.
