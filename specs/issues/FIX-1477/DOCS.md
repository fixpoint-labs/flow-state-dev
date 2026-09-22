# FIX-1477 · Documentation draft

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs** · [Evolution](EVOLUTION.md)

This issue publishes the components page, the `@flow-state-dev/react` exports entry and the
reference app's README opening — the three the epic assigned it. The epic's shared "What a
Workforce app looks like" section is also this issue's, but only once the behaviour it promises
exists; it is not drafted again here.

**Two deliberate departures from the epic's draft.** Its example mounted the navigator twice; the
page below mounts it once with two sections ([D3](DECISIONS.md#d3)). And its limits paragraph
documented an organization gap this issue proposes to avoid ([the Open fork](DECISIONS.md#open))
— the wording for the other answer is at the bottom.

**No tracking ids appear in any quoted block**, because everything inside the quotes publishes
([user-docs.md](../../../docs/contributing/user-docs.md)).

---

## CREATE · `apps/docs/docs/workforce/ui.md`

Frontmatter: `title: Workforce components`, `sidebar_label: Components`,
`sidebar_position: 9`, `description: Render a roster, its channels and its boards with
components from the client packages.`

> # Workforce components
>
> `@flow-state-dev/react` ships the chrome a workforce needs. Most of it is one component: a
> navigator that browses your flows. Beside it are the roster and a channel's board columns.
> They are the same components the reference app renders — imported, not copied.
>
> ```tsx
> import { FlowNavigator, Roster, BoardColumns } from "@flow-state-dev/react";
>
> <FlowNavigator
>   sections={[
>     { label: "Channels", kinds: ["channel"] },
>     { label: "Seats",    kinds: ["agent"] },
>   ]}
>   onSelectSession={setSessionId}
> />
> ```
>
> `channel` is the channel kind the framework ships; `agent` is the seat kind. A section is a
> label and a set of kind names and nothing else, so an app that declares a channel kind of its
> own adds that name to the same list.
>
> You name the kinds each section covers. You do not name anything else about the shape — the
> navigator reads that from your flows. Generic conversation and item rendering is unchanged and
> still comes from the component registry.
>
> ## How deep the navigator goes, and why it varies
>
> The navigator starts at the kind. How many levels sit under it depends on how that flow was
> declared.
>
> A flow with `cardinality: "collection"` has many addressable copies, so it is **three levels**:
> kind, then instances, then sessions. The seat kind works this way — open `agent` and you get
> the seats you hired, open a seat and you get that seat's sessions.
>
> A flow with `cardinality: "singleton"` is one instance whose address is its kind, so it is
> **two levels**: kind, then sessions. A channel kind works this way, and the reason is worth
> knowing: a channel **is** a session on that kind. A hundred channels are a hundred sessions on
> one instance. There is no middle level to show, so the navigator does not draw one — and you
> will not find your channels one level deeper than you expected.
>
> You do not tell it which shape to use, and there is no prop that would let you. That is
> deliberate: a depth you passed in would be a second opinion about your own flow, and it would
> be wrong the moment that flow changed shape.
>
> ## What it asks your server for
>
> The navigator reads the flow list once, however many sections you give it.
>
> Sessions are read **only when a leaf opens** — a singleton kind, or one instance of a
> collection kind. Opening a kind row asks your server for nothing, so a roster of two hundred
> seats costs one request to draw and one more when somebody opens a seat. If you are watching
> the network tab and see a request per row, something is wrong.
>
> ## Styling it
>
> The components ship with no CSS framework and no icon set, because `@flow-state-dev/react`
> brings neither. You style them two ways:
>
> - **CSS custom properties** for colour, spacing and type. Set them on any ancestor.
> - **Slots** for the parts that are yours — what a row shows beside its name, what sits in a
>   section header, what an empty section says.
>
> The reference app and our own developer tool render this same component and look nothing
> alike. That is the intended amount of control.
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
> **From a standing collection.** The navigator, the roster and the board columns read a
> collection that lives outside any one session — the same rows for everyone in the
> organization, not one session's copy. They read it when they mount, and they do not watch it
> afterwards: a change somebody else makes appears the next time the panel mounts. If you need a
> fresh read on demand, change the component's React `key` — that remounts it and refetches.
>
> Reaching for the wrong one shows up immediately: a region built on the item stream shows one
> session's view of something the whole organization shares.
>
> ## Limits
>
> These components render; they do not administer. There is no create-channel or invite control,
> because there is no runtime verb behind one.
>
> A board column shows the rows a seat drains. A seat is wired to the boards it watches in code,
> so a column with nothing in it usually means nothing drains that board — the column says so
> rather than spinning.
>
> The roster and the board columns are scoped to an organization, because the collections behind
> them are. **The flow list is not.** Treat it as public information about your deployment's
> shape: it is the list of kinds your server has registered, it carries no organization, and it
> is not behind your authentication. So the navigator browses **channel kinds** rather than hired
> seats, and your team is in the roster, which is organization-scoped. When the flow listing
> carries an organization, a seats section becomes available and this page will say so.

## UPDATE · `packages/react/README.md` · a new section after "Render helpers"

> ### Workforce components
>
> `FlowNavigator`, `Roster` and `BoardColumns` browse your flow kinds and their sessions, and
> render a roster and a channel's boards from standing collections. They bring no CSS framework and
> no icon set — style them with CSS custom properties and fill them through slots. Navigator
> depth is read from each flow's declared `cardinality`; there is no depth prop. The flow listing
> carries no organization, so the navigator is not organization-scoped. See
> [Workforce components](https://flow-state.dev/docs/workforce/ui).

## UPDATE · `apps/kitchen-sink/README.md` · the opening and "What to read first"

Replace the opening two paragraphs. The app is described by what a reader will find in it, not
by what it used to host.

> # Kitchen Sink
>
> The canonical reference application for `@flow-state-dev`, and a Workforce app you can copy.
> It hires a team, gives that team channels and boards, and renders all of it with components
> imported from the client packages. No component in this app is one the packages could not
> export, and no file installed from the component registry has been edited in place.
>
> Kitchen sink is a reference app, not a minimal example. It hosts every subsystem and is where
> features get tested end to end. For small, focused, copy-paste-able demos see `examples/`.
>
> ## What to read first
>
> - `workforce/` — the team, its channel kinds and its `CHANNEL.md` instances. This is the
>   authoring path, and it is the shortest route to understanding the app.
> - `app/page.tsx` — the shell: one navigator on the left, the channel stream in the middle,
>   boards and the roster on the right. All three regions are imports.
> - `flows/` — the flows the seats run.

---

## The alternative limits paragraph

If the [Open fork](DECISIONS.md#open) is answered *ship the seats section now*, the `ui.md`
limits section's last paragraph is replaced with this, and the example above gains its Seats
section back:

> **The navigator does not scope by organization.** It shows the flow kinds your server has
> registered, and under them the sessions the caller can see. There is no organization filter, so
> a hired seat appears under its kind whichever organization it was hired for. A session does
> carry an organization when you read it on its own, but the list shape does not include one, so
> the navigator cannot filter or group by it without reading every session individually — which
> is the one thing it is careful not to do. If organization scoping matters for your app, do not
> put a seats section in front of end users until the listing contract carries an organization.

## Ownership and ordering

`ui.md`, the README entry and the reference app's README publish with **PR-C or a follow-up in
the same window**, reconciled against the built components rather than against this draft.

The epic's shared overview section — *What a Workforce app looks like*, plus its two
Related-pages entries — also publishes with PR-C, and only then: it links a durable-hire page
that [FIX-1475](https://linear.app/fixpoint-labs/issue/FIX-1475) owns. Whichever of the two
lands second links the other's page rather than repeating it
([ER-25](../../epics/FIX-1455/BUSINESS-RULES.md)). The wrap's documentation pass reconciles the
two into one narrative.

Nothing here restates [Channels](../../../apps/docs/docs/workforce/channels.md) or
[Code on disk](../../../apps/docs/docs/workforce/code-on-disk.md); they already teach the
convention these components display.
