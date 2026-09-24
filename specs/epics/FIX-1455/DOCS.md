# FIX-1455 · Documentation draft

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs** · [Evolution](EVOLUTION.md)

This is the reader-facing prose the set owes, written once here so five issues do not each
invent their own version of the same story. Only changed material appears. The channel and
board pages already teach the convention this set demonstrates, so nothing from
[`channels.md`](../../../apps/docs/docs/workforce/channels.md) or
[`code-on-disk.md`](../../../apps/docs/docs/workforce/code-on-disk.md) is restated here.

---

## UPDATE · `apps/docs/docs/workforce/overview.md` · new section after "Workforce or orchestration"

### What a Workforce app looks like

A Workforce app is a roster, the channels that roster talks in, and the boards its work sits
on. You describe the roster in files, hire it, and open sessions against the seats you get
back. Nothing about that is a special application shape: the seats are flow copies, the
channels are flows, and the boards are ledgers.

Three things turn that into an app someone can use:

- **The roster outlives the process.** A team you hire while the app is running is still there
  after a restart or a redeploy, because the hire is written to the store your app already
  uses. See [Durable hire](./durable-hire).
- **A channel is what a reader opens.** A channel's transcript is the session history, scoped
  to that channel — not a second kind of conversation beside sessions. See
  [Channels](./channels).
- **The chrome is importable.** One navigator browses the whole workforce, and the roster and
  board columns ship beside it, as components from `@flow-state-dev/react`. An app renders a
  workforce without writing them. See [Workforce components](./ui).

Files stay the authoring path throughout. A `WORKER.md` under `teams/` and a `CHANNEL.md`
beside it are still how a roster is written down; runtime hire adds to that roster, it does
not replace the tree.

## UPDATE · `apps/docs/docs/workforce/overview.md` · "Related pages"

Two entries, in the existing list's style:

- [Durable hire](./durable-hire) — a roster hired at runtime, written to your store, reloaded on
  the next boot.
- [Workforce components](./ui) — browse your flow kinds, instances and sessions, and render a
  roster and boards, with React components.

---

## CREATE · `apps/docs/docs/workforce/durable-hire.md`

Frontmatter: `title: Durable hire`, `sidebar_label: Durable hire`, `sidebar_position: 8`,
`description: Hire a team while the app is running and have it still be there after a redeploy.`

> # Durable hire
>
> `hireWorkforce` reads files and registers nothing. That is enough for a roster you ship with
> the app, and not enough for a roster somebody adds to while it runs: hire a team from a
> request and it lives in the process that handled the request.
>
> Durable hire writes the roster to the store your app already configured, under the org the
> caller belongs to. The next boot reads it back and hires it alongside the file-declared
> roster.
>
> ```ts
> import { hireWorkforce } from "@flow-state-dev/workforce";
> import { readWorkforce } from "@flow-state-dev/workforce/loader";
>
> // The tree, as before.
> const { workers } = await readWorkforce("./workforce");
>
> // Plus whatever was hired at runtime and stored, for this org.
> const stored = await store.workforce.list({ orgId });
>
> const seats = hireWorkforce([...workers, ...stored]);
> ```
>
> A stored record carries the same fields a `WORKER.md` carries: an id, a `flow:` naming its
> kind, and settings. It is hired by the same call, refused by the same rules, and addressed
> the same way. A record whose kind is not registered is refused at hire, so a stored roster
> cannot outlive the flow it names — check the errors array rather than assuming a clean boot.
>
> ## What is durable, and what is not
>
> Seats and the roster are durable. **Channels and boards are declared in files**, and a
> channel is not created at runtime. A channel's rows and transcript persist the way any
> session's items do; the channel's *existence* comes from `CHANNEL.md`.
>
> Two ids are durable and worth knowing: the seat id, which comes from the record, and the org
> id, which scopes it. A hire with no org is refused. Nothing is stored per user.
>
> ## If there is no store
>
> An app with no persistent store configured hires from files only, and a runtime hire raises
> rather than silently living in memory. That is deliberate: a roster that quietly disappears on
> the next deploy is worse than one that refuses to be created.
>
> ## Coming from a file-only roster
>
> Existing apps need no change. A tree that declares its whole roster keeps working exactly as
> before, and reads back an empty stored list. Adopting runtime hire means merging the two
> sources at boot, as above — not moving your `WORKER.md` files into the store.

## CREATE · `apps/docs/docs/workforce/ui.md`

Frontmatter: `title: Workforce components`, `sidebar_label: Components`,
`sidebar_position: 9`, `description: Render a roster, its channels and its boards with
components from the client packages.`

> # Workforce components
>
> `@flow-state-dev/react` ships the chrome a workforce needs. Most of it is one component: a
> navigator that browses your flows. Beside it are the roster and a channel's board columns.
> They are the same components the reference app renders, imported rather than copied.
>
> ```tsx
> import { FlowNavigator, Roster, BoardColumns } from "@flow-state-dev/react";
>
> // Your channels, and your seats, from the same component.
> <FlowNavigator kinds={["topic", "dm"]} />
> <FlowNavigator kinds={["agent"]} />
> ```
>
> You name the kinds it covers; it renders from live data. Generic conversation and item
> rendering is unchanged and still comes from the `@flow-state-dev/ui` registry.
>
> ## How deep the navigator goes, and why it varies
>
> The navigator starts at the kind. How many levels sit under it depends on how that flow was
> declared.
>
> A flow with `cardinality: "collection"` has many addressable copies, so it is **three levels**:
> kind, then instances, then sessions. The seat kind works this way — open `agent` and you get the
> seats you hired, open a seat and you get that seat's sessions.
>
> A flow with `cardinality: "singleton"` is one instance whose address is its kind, so it is **two
> levels**: kind, then sessions. Channel kinds work this way, and the reason is worth knowing: a
> channel **is** a session on the channel kind. A hundred channels are a hundred sessions on one
> instance. There is no middle level to show, so the navigator does not draw one.
>
> You do not tell it which shape to use. It reads `cardinality` off the flow list. That is
> deliberate: a depth you passed in would be a second opinion about your own flow, and it would be
> wrong the moment that flow changed shape.
>
> ## Two sources, and which one a component reads
>
> A component reads one of two sources, and the distinction decides what it shows and when it
> updates.
>
> **From the session's item stream.** The turn stream, task updates and approval cards render
> the items a session persisted. They update as items arrive, and they are still there after a
> reload, because the items are durable — the stream is where they are read from, not how long
> they live.
>
> **From a standing collection.** The navigator, the roster and the board columns subscribe to a
> collection outside any session and re-render when it changes. Two people looking at the same
> board see the same rows.
>
> Reaching for the wrong one shows up immediately: a region built on the item stream shows one
> session's view of something the whole org shares.
>
> ## Limits
>
> These components render; they do not administer. There is no create-channel or invite control,
> because there is no runtime verb behind one. A board column shows the rows a seat drains — a
> seat is wired to the boards it watches in code, so a column with nothing in it usually means
> nothing drains that board.
>
> **The navigator does not scope by organization.** It shows the flow kinds your server has
> registered, and under them the sessions the caller can see — which today means the caller's own
> sessions within their tenant. There is no organization filter, so a user whose sessions span two
> organizations **inside one tenant** sees both under the same kind. Separate tenants stay
> separate; organizations within a tenant do not.
>
> A session does carry an organization when you read it on its own, but the list shape does not
> include one, so the navigator cannot filter or group by it without reading every session
> individually — which is the one thing it is careful not to do. If organization scoping matters
> for your app, treat the session list as tenant-scoped and partition by other means until the
> listing contract carries an organization.

---

## UPDATE · `packages/react/README.md` · the exports list

Add, in the existing list's style:

> **Workforce** — `FlowNavigator`, `Roster`, `BoardColumns`. Browse your flow kinds, their
> instances and their sessions, and render a roster and a channel's boards, from live
> collections. Session listing is tenant-scoped, not org-scoped. See
> [Workforce components](https://flow-state.dev/docs/workforce/ui).

## UPDATE · `apps/kitchen-sink/README.md` · the opening and the "Flows" list

Replace the opening two paragraphs and the flow list's framing. The app is described by what a
reader will find in it, not by what it used to host.

> # Kitchen Sink
>
> The canonical reference application for `@flow-state-dev`, and a Workforce app you can copy.
> It hires a team, gives that team channels and boards, and renders all of it with components
> imported from the client packages — no component in this app is one the packages could not
> export.
>
> Kitchen sink is a reference app, not a minimal example. It hosts every subsystem and is where
> features get tested end to end. For small, focused, copy-paste-able demos see `examples/`.
>
> ## What to read first
>
> - `workforce/` — the team, its channel kinds and its `CHANNEL.md` instances. This is the
>   authoring path, and it is the shortest route to understanding the app.
> - `app/page.tsx` — the shell: one navigator over channels and seats on the left, the channel
>   stream in the middle, boards and the roster on the right.
> - `flows/` — the flows the seats run.

---

## Ownership

| Material | Publisher | Specific draft |
|---|---|---|
| Overview's shared "What a Workforce app looks like" and its two Related-pages entries | FIX-1477, after ER-22, ER-23 and ER-24 hold | This document |
| `durable-hire.md`, and the durability limits it states | FIX-1475 | Its `DOCS.md` |
| `ui.md`, the `packages/react/README.md` exports, the kitchen-sink README rewrite | FIX-1477 | Its `DOCS.md` |
| The patterns line in the kitchen-sink README, and any `@flow-state-dev/patterns` mention the audit retires | FIX-1478 | Its PR, with its *keep because…* notes |
| A hire-from-the-rail section in `durable-hire.md`, `SeatDetail` in `packages/react/README.md`, `createSeatHireBlocks` in `packages/workforce/README.md` | FIX-1500, linking FIX-1475's and FIX-1477's material rather than repeating it | [Its `DOCS.md`](../../issues/FIX-1500/DOCS.md) |
| The manager seat in the kitchen-sink README | FIX-1527, beside FIX-1477's rewrite | [Its `DOCS.md`](../../issues/FIX-1527/DOCS.md) |

**The navigator page's organization limit is tracked as
[FIX-1486](https://linear.app/fixpoint-labs/issue/FIX-1486)** — flow and session listing carry no
org identity, which blocks FIX-1477's org-aware behaviour only. **The id is cited here and not in
the drafted page**: everything inside the quoted block above is published to `apps/docs`, where
tracking ids are forbidden ([user-docs.md](../../../docs/contributing/user-docs.md), the outsider
rule). The page states the *behaviour* and its limit; this document holds the ticket. When FIX-1486
lands, the limits paragraph is rewritten — by FIX-1477, which publishes the page.

**`FlowNavigator` is a placeholder name, not a lock.** [D8](DECISIONS.md#d8) settles that there is
*one* navigator and that its depth comes from `cardinality`; what it is called, and what its props
are beyond that, is FIX-1477's to name in its own spec. The draft above uses a name so the prose
reads — change it there, not here.

Publish each specific with its implementation. **The shared overview section waits until the
behavior it promises is available** — it links a page and a component set that do not exist
until FIX-1475 and FIX-1477 land, so publishing it when this spec merges would document a
promise. Whichever of FIX-1475 and FIX-1477 lands second links the first's page rather than
repeating it (ER-25); the wrap's docs-polish pass reconciles the two into one narrative.

## No documentation impact

**FIX-1429.** It serves a workforce the app already declares, over a route the app already
exposes. The file convention, the hire call and the route are all documented as they are; no
reader-facing syntax, limit or failure behavior changes. The goal check it moves off `NOT RUN`
is an internal artifact.

**FIX-1476.** The convention it demonstrates is already published:
[Channels](../../../apps/docs/docs/workforce/channels.md) teaches the `CHANNEL.md` instance,
the bare board-name list, the explicit per-seat drain through `channelBoard` / `taskBoard` and
the unattended-board warning, and
[Code on disk](../../../apps/docs/docs/workforce/code-on-disk.md) teaches a channel kind as
`workforce/flows/channels/<kind>.ts` picked up by `fsdev gen`. FIX-1476 writes a worked example
against those pages. If building it turns up a limit or failure the pages state wrongly, that
correction is FIX-1476's to publish and belongs in its own `DOCS.md` — reconciling a draft
against tested behavior is the implementation's job, not a reason to pre-write a page here.
