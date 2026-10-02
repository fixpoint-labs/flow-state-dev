# FIX-1746 · Documentation draft

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs**

The proposed reader-facing changes, section by section. Each operation inserts a plate and replaces the named prose with the paragraph drafted here. Prose not named is unchanged. This draft is input to `docs-writer`, which reconciles it against the code on the PR's base before anything is published ([PLAN → Docs](PLAN.md#docs)).

## PR 1

### UPDATE · `apps/docs/docs/workforce/channels.md` · What a channel is

Replace the four paragraphs after the heading, keep the tip box after it.

```md
![Where each part of a channel lives. The channel kind is one registered instance, and every channel is a session on it. The support.desk session holds its members and charter in session state, and its transcript as channel-post items. A woken seat answers from a session of its own. The board rows and the inventory row are organization data outside the session. The session holds no board, the inventory's members list is a copy for finding channels, and only the seat's answer line reaches the channel.](./channel-parts.svg)
```

A channel is a named session on `channel`, the one flow kind the framework ships for them. Two channels are two sessions on that one registered instance. What differs per channel lives in its own session: its members and charter as state, written when it is opened, and every line as an item. A board the channel holds is organization data with an id built from the channel's, so the session never stores it.

### UPDATE · `apps/docs/docs/workforce/inventory.md` · opening, and When to use which source

Keep the collection table. Replace the source list with the plate and this paragraph.

```md
![The records about one seat and one channel. The tree declares them. Inventory rows record that they were registered and are never deleted. A roster row exists while a hired seat is hired. The channel's session holds the members a post is checked against; the inventory's copy is for finding things.](./seat-channel-records.svg)
```

Ask the record that owns the answer. Whether a seat exists in your files is the tree's. Whether it was ever registered in this organization is the inventory's, and that row stays after the seat is fired. Whether it is hired right now is the roster's. Whether a post from it will be accepted is the channel's, which checks its own members.

Correct the seats row of the collection table to the key the code writes, if the PR's claims check confirms a hired seat's row is keyed by its address.

## PR 2

### UPDATE · `apps/docs/docs/workforce/durable-hire.md` · Who can reach a hired seat

Replace the bullet list and the Alice and Bob example. Keep the paragraph on the resolver.

```md
![Two seats hired in the acme organization. The org-visible seat answers at acme.support.ada; its roster row can be listed by any acme member's browser, showing seatId, flow and instructions, and any acme member the resolver admits can use it. The user-owned seat answers at acme.~alice.research; its roster row has no browser read, and only alice signed in to acme can use it. Outside acme both seats answer 404 Unknown flow and are left out of the flow list.](./hired-seat-reach.svg)
```

A hired seat answers only the callers its pin admits: the organization that hired it, and the one person who hired it when it is user-owned. Anyone else gets `404 Unknown flow`, the same answer as an address your app does not serve, and `GET /api/flows` leaves the seat out. A session opened earlier can't be resumed by them either. Knowing a seat's address grants nothing.

### UPDATE · `apps/docs/docs/workforce/durable-hire.md` · What a seat saves for a person

Replace the second and third paragraphs; keep the projected-resource warning and the upgrade link.

A seat keeps what it learns about a person in one of three places, shown above. By default, one cell per person per organization, which every seat in that organization shares. With flow isolation, one cell per person per seat. The person's own data outside hired seats is a third cell, which no hired seat reads or writes.

### UPDATE · `apps/docs/docs/workforce/built-in-worker.md` · What isolation does and does not give you

Insert the same plate (`./seat-person-data.svg`) after the first paragraph and cut the sentence it restates. Keep the warning that a rename or turning the flag on later leaves old memory behind.

### UPDATE · `apps/docs/docs/workforce/overview.md` · What a Workforce app looks like

Replace the first paragraph with the plate and this paragraph; keep the three bullets' links as a list of pages to read next, and fold What it will not do into it.

Workforce reads your files and hires them. Each `WORKER.md` becomes a flow copy with its own address. Each `CHANNEL.md` becomes a named session on a channel kind, the built-in one unless the file names another. Sessions, resources and boards work as they do on any flow, and live where they always do.

## PR 3

### UPDATE · `apps/docs/docs/workforce/documents-on-disk.md` · Who reaches what

Replace the tree listing and the two paragraphs before the `references:` example with the plate and this paragraph. Keep the narrowing example, the filter code and the per-seat document section.

A folder means two different things here. Under `references/`, it is a wall: a seat reads the references of its organization, its team and its own folder, and nothing beside them. Under `resources/`, it is only part of the name: every document there is the organization's, and a flow that installs them reaches all of them unless you filter.

### UPDATE · `apps/docs/docs/workforce/workers-on-disk.md` · What a team folder keeps to itself

Keep the first paragraph. Replace the second with the same plate (`./document-reach.svg`) and one sentence: team documents under `resources/` reach every worker of a kind, and under `references/` only that team's.

### UPDATE · `apps/docs/docs/workforce/ui.md` · Where each component reads from

Replace the three bold paragraphs' first sentences with the plate; keep the refresh guidance.

Each component reads one of three places. Messages and cards read one session's items, which arrive live and survive a reload. The roster and board panels read an organization's collection once when they mount. The navigator reads the flow list once, and a seat's sessions only when you open it.

## PR 4

### UPDATE · `apps/docs/docs/fundamentals/state-and-scopes.md` · The four scopes; Why four scopes?

Keep the table. Insert the plate after it. Delete Why four scopes? and cut The other three scopes to its code examples and their one-line lead-ins.

Organization and user state are shared by every flow on the server. A flow can keep its own user state instead, per copy. Session state belongs to one conversation, beside its items, metadata and journal. Request state lasts one action. None of it reaches the browser unless a scope's `client` block names it.

### UPDATE · `apps/docs/docs/fundamentals/overview.md` · State in four scopes

Replace the lifetime table with the same plate (`../fundamentals/state-scopes.svg`) and keep the paragraph on concurrent writes.

### UPDATE · `apps/docs/docs/fundamentals/flows.md` · How an instance is addressed; What the definition owns

Insert the plate before the refusal table and cut the paragraphs it restates.

The definition decides what every copy shares: its transports, the settings a copy may take, and the entries only the flow can reach. Each copy has its own id, its settings, its resources and its isolated state. A session belongs to the copy that created it, and any other copy is refused.

### UPDATE · `apps/docs/docs/getting-started/your-first-flow.md` · What just happened

Insert the plate and rewrite the section around it in about the same length.

Three places took part. Your browser holds a session's items and the state you exposed. The server runs the flow you registered. The store keeps the session, so a reload picks up where you were.

## PR 5

### UPDATE · `apps/docs/guides/board-lifecycle.md` · A board is two things; What a board is not

A board is stored rows and a drain. The rows sit at the backing you choose, which decides how long they last. The drain is a block that claims and runs rows, and only while a request is running it. Rows nobody drains wait where they are.

### UPDATE · `apps/docs/guides/anatomy-of-a-flow.md` · sections 3 and 5

Insert the flow and the scopes plates from Fundamentals by relative path, and cut the sentence each restates.

## Publication ownership

Each PR publishes only its own sections. Shared plates are owned by the PR that draws them; a later PR links them. The projects page is not edited here, except the colour change to its five plates once its own PR has merged.
