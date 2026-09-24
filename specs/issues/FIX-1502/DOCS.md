# FIX-1502 · Documentation draft

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs** · [Evolution](EVOLUTION.md)

Three updates, no new page. The implementation reconciles each against shipped behaviour and
publishes it through the `docs-writer` → `docs-editor` pass. Drafted here as prose, per the spec
template, rather than as reader intents; where the repository's rule that prose is written away
from the diff pulls the other way, the publishing pass is where it is honoured.

## UPDATE · `apps/docs/docs/workforce/inventory.md` · new subsection at the end of "Reading the inventory"

### From a browser

The three collections can be read from a browser, through the same collection read your app's
own client code uses:

```ts
import { createResourceClient } from "@flow-state-dev/client";

const resources = createResourceClient({ baseUrl }); // your server's origin
// `channelsRef` is the name the channel's flow gave the collection (see below)
const page = await resources.listCollectionItems(channelSessionId, channelsRef);
// page.items[0].clientData → { id: "eng.queue", kind: "channel", members: ["eng.planner", …], openedAt: "…" }
```

The read goes through a session, and it answers for **that session's organization**. You cannot
name a different organization in the request; the server takes it from the session, which took it
from your principal resolver when it was created. Any session whose flow installs the collection
can read it, which includes every channel built with `inventory: true`.

Each row arrives with its own fields and nothing else: `id` and `kind` for a seat; `id`, `kind`,
`members` and `openedAt` for a channel; `seatId` and `channelId` for a membership. Pass
`nextCursor` back as `cursor` to read the next page.

Two things to keep in mind when you show these rows to a person:

- **A row means registered, not open.** Nothing deletes an inventory row. A seat you fired is
  still listed, and a channel's `members` are who was in it when it registered.
- **The ref is the name your flow gave the collection**, not its pattern. Read it from the
  session's resource manifest if you did not declare the flow yourself.

## UPDATE · `packages/workforce/README.md` · "The live inventory", after the collections table

All three collections can be read from a browser by a session in the same organization, through
the ordinary collection read (`client.state.read`). Each exposes the fields in the table and
nothing else. The organization is always the session's. A row means *was registered*; nothing is
removed when a seat is fired or leaves a channel.

## UPDATE · `apps/docs/docs/devtool/overview.md` · new section after "Task boards"

## Inventory

If your app opens its [live inventory](../workforce/inventory.md), the DevTool can show the whole
organization from one place. Open any channel's session and pick the **Inventory** tab. The tab
appears on any session whose flow declares at least one of the inventory collections.

A channel's session shows all of it:

- **Seats**: every seat registered in the organization, with its kind and the channels it is in.
- **Channels**: every channel registered in the organization, with its kind, its members, and when
  it registered.

Some flows declare only part of the inventory. A seat that can hire other seats, for example,
carries only the seat collection. On those sessions the tab shows what the flow declares and marks
the rest *not installed on this flow*. That is different from an empty section, which means the
collection is there and nothing is registered in it yet.

If your app authenticates with a bearer token, set it in the DevTool's settings as you would for
any other panel; the tab sends it on every request.

Everything on the tab is labelled *registered* on purpose. The inventory keeps a row once it is
written, so a seat fired yesterday still appears, and a channel's members are the ones it had when
it registered. Treat the tab as a map of who has existed here, not a list of who is working now.

The tab reads through the same collection read your own app would use, not the debug endpoint, so
it works with `FSDEV_DEBUG_ENDPOINTS` off. It shows the organization of the session you opened and
no other. If the read is refused, the tab says so with the status rather than showing an empty
organization. If nothing is registered yet, it tells you so; the usual cause is an app that never
calls `openInventory` at boot.

**Voice traps here:** no issue numbers, no checklist, no "used to". Do not call the tab a roster,
and do not write *live*, *open* or *online* about a row.
