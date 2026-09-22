# FIX-1477 · Business rules

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md) · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

The cases, written as rules. Each says what a person or the system does and what happens. The
*proved by* column names the check; [PLAN.md](PLAN.md) says what would make each one fail.

## How deep the rail goes

| # | When | Then | Proved by |
|---|---|---|---|
| BR-1 | A kind whose flow declares `cardinality: "collection"` is opened | Its instances are listed. Opening one of those lists that instance's sessions — three levels | CI · component test over two fixture kinds |
| BR-2 | A kind whose flow declares `cardinality: "singleton"` is opened | Its sessions are listed directly. **No instance level is drawn** — there is no instance to draw | CI · same test, the singleton fixture |
| BR-3 | A consumer tries to tell the navigator how deep to go | There is no way to. No `depth`, no `levels`, and no per-kind override exists on the component's props | CI · a test asserting the exported prop names, so adding one fails |
| BR-4 | A flow's declared cardinality changes between two reads | The next read draws the new depth. Nothing in the app had to be edited | CI |
| BR-5 | A kind appears in the list more than once (two instances of one collection kind) | One kind row, both instances under it. The kind row is never two rows | CI · this is the level the developer tool does not have today |
| BR-6 | A section's kind filter names a kind the server does not have | That section renders empty and says so. Not an error, and the other section is unaffected | CI |

## What a click costs the server

| # | When | Then | Proved by |
|---|---|---|---|
| BR-7 | A **collection** kind row is opened | **Zero** session-list requests are made, for any number of instances under it. A singleton kind row *is* a leaf, so it is BR-8's and not this rule's | CI · a counting fake session client |
| BR-8 | A **leaf** is opened — a singleton kind, or one instance of a collection kind | Exactly one session-list request, for that leaf | CI · same fake |
| BR-9 | A leaf is opened, closed and opened again | No more than one further request. A closed leaf's rows are not re-read on every toggle | CI |
| BR-10 | The navigator is mounted with two sections | One flow-list read, not two. The sections share it | CI |
| BR-11 | A response arrives after its leaf was collapsed, after another leaf was opened, **or after a newer read of the same leaf started** | It is discarded. No leaf shows another leaf's sessions, and no older response overwrites a newer one for the same leaf | CI · resolve two requests out of order, in both shapes |
| BR-12 | A session row carries no recorded owning instance | It is **never attributed to an instance** (BP-030). Under a singleton kind, whose address *is* the kind, it is listed. Under a collection kind it is not listed anywhere: the exact-owner filter never matches an ownerless record (`handleListSessions`, `packages/engine/src/routes/session-routes.ts`) and BR-7 forbids a query at the kind row. The promise is "never misfiled", not "always reachable" | CI · an ownerless fixture session under each cardinality |

## Where a component comes from

| # | When | Then | Proved by |
|---|---|---|---|
| BR-13 | The rebuilt shell renders a component | It resolves to a package import or to a file installed from the component registry. The app defines no component the packages could not export ([ER-4](../../epics/FIX-1455/BUSINESS-RULES.md)) | CI · an import-graph check over the shell's transitive component imports |
| BR-14 | A file in the **reference app** was installed from the component registry | It is byte-identical to its source in that registry. Where the app's version is the better one, it is pushed back into the registry; where it is not, it is reverted | CI · compare every manifest target the app installed, asserting how many |
| BR-15 | The navigator, the roster or the board columns are rendered by the developer tool | They are the same exports the reference app renders. No second implementation exists in either place | CI · the developer tool's navigator folder is gone and nothing imports it |
| BR-16 | `@flow-state-dev/react` is installed by an app that uses no CSS framework | It works and brings none. The package's dependency list gains no styling or icon package | CI · assert the package's declared dependencies |
| BR-17 | A host wants the reference look | It sets CSS custom properties and supplies row slots. It never overrides a class name, because none is published | CI · the developer tool and the reference app render the same component and look like themselves |
| BR-29 | A host renders these components against a deployment that authenticates | They read through the transport the host already supplies — the `fetcher` its clients take — so every request carries its credential. A component that builds its own client lists flows successfully (that route is exempt from authorization) and then fails every session read under it | CI · the developer tool's own bearer path, in V7 |

**BR-14 is stricter for the reference app than the registry is for everyone else.** The
registry's own contract is that you own the source once you install it, and that is right for an
app being built. It is wrong for the app whose entire job is to be copied: a reader who clones a
forked copy inherits the fork and never learns they have one. So other consumers keep their
divergences; this one does not get to.

## What the panel shows, and who may see it

| # | When | Then | Proved by |
|---|---|---|---|
| BR-18 | The right panel is rendered | Boards and the roster are there, whatever mode the app is in. The panel is not conditional ([D7](../../epics/FIX-1455/DECISIONS.md#d7)) | CI |
| BR-19 | A roster is rendered | It shows the organization's seats, read from the standing roster collection. The collection is organization-scoped at the store, so nothing in the component filters. The governing session is one whose flow declares the collection, and the collection has to permit a browser read before any session can serve one ([PLAN.md → Blocked on](PLAN.md#blocked-on), [D4](DECISIONS.md#d4)) | CI, against a fixture collection |
| BR-20 | The roster reports seats that were skipped at boot | The count and the list are shown, not only logged. "The roster" and "what answers" are two numbers ([FIX-1475](https://linear.app/fixpoint-labs/issue/FIX-1475)'s BR-24) | CI |
| BR-21 | A board column is rendered | It shows the rows that board holds, grouped by the existing task statuses. No new status vocabulary is minted | CI |
| BR-22 | A board has no rows | The column says so plainly, and says the likely reason — nothing drains that board. Board wiring is explicit per seat and this must not read as a loading state ([ER-12](../../epics/FIX-1455/BUSINESS-RULES.md)) | CI |
| BR-23 | The navigator lists seats | Those rows come from the server's flow list, which carries **no organization**. This is the [Open fork](DECISIONS.md#open); nothing here presumes its answer | — |
| BR-24 | Any component is given an `orgId` to filter by | There is no such prop. The stack cannot honour one, and a filter that silently does nothing is worse than none ([D8](../../epics/FIX-1455/DECISIONS.md#d8)) | CI · the prop-name assertion in BR-3 covers this too |

## As the viewport narrows

![Three widths side by side. At full width the rail, the channel stream and the boards-and-roster panel all show. At large and below the boards and roster panel yields first and becomes a sheet opened from the header, while the rail and the stream keep their places. Below small the rail yields too and becomes a drawer, and the stream takes the whole column. The stream is the one region present at all three widths](figures/narrow.svg)

Read left to right and watch which box survives. The stream is in all three; everything else has
a width at which it becomes a drawer. The order is the epic's ([ER-7](../../epics/FIX-1455/BUSINESS-RULES.md)),
consumed here rather than re-decided.

| # | When | Then | Proved by |
|---|---|---|---|
| BR-25 | The viewport narrows past the large breakpoint | Boards and the roster yield first, reachable as a sheet from the header | CI · rendered at three widths |
| BR-26 | It narrows past the small breakpoint | The rail yields too, as a second drawer. The stream keeps the column | CI |
| BR-27 | Every kind and every instance is expanded at once, in a 256px rail | Three levels of indentation still read, and the rail scrolls as one list | CI · the expand-all state, not a tidy collapsed one |
| BR-28 | The stream is rendered at any width | It never yields, never collapses, and never becomes a drawer | CI |

## Failure taxonomy

**Nothing here is fatal, and every failure is local.** A flow list that will not load leaves the
rail with a retry and the stream untouched; a failed session list marks its own leaf; a failed
roster or board read marks its own region. No failure in a resource-backed region stops a turn
being sent or rendered — that is the point of keeping them on separate reads.

**Nothing retries silently.** Every failed region shows what failed and offers the retry; a
region that quietly re-reads on a timer hides a broken deployment behind a spinner.

## Acceptance criteria this issue owns

An app that is **not** the reference app renders the workforce chrome from the published package
— the developer tool, in its own skin, with its own affordances and its own authenticated
transport. That is [ER-24](../../epics/FIX-1455/BUSINESS-RULES.md), the claim the epic's
completion gate rests on. Proved by the developer tool running with its navigator folder deleted,
not by an export list.
