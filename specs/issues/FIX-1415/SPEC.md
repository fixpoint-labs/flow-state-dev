# FIX-1415 · Explore: a seat can open, close, and invite on a dynamic room

**Spec** · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

**Explore / not-ship. Needs Architect + Cycle Manager ratify.** Design · `workforce` · thin · 0 ship PRs until ratification · related-not-child of [FIX-1407](https://linear.app/fixpoint-labs/issue/FIX-1407) · sibling of [FIX-1480](https://linear.app/fixpoint-labs/issue/FIX-1480)

This set is a direction brief. Approving it retains the exploration. It does **not** authorize production channel-admin, a Channel type, a second room registry, or a Collab release reopen.

## Five people, before and after

| Someone who… | Today | After a ratified ship |
|---|---|---|
| **manages a team mid-run and needs a room that was not in the files** | Asks a human to add a `CHANNEL.md` and restart. The seat itself has no room tool | Names a room on a channel kind the app already registered. Collab mints a session. The file tree is untouched |
| **looks up rooms the same way Labs already look rooms up** | Sees file-declared rooms that also have an inventory row. A room created while the app ran is missing | Sees that room on the same lookup — or we have said, on purpose, that they will not ([D1](DECISIONS.md#d1)) |
| **runs a seat whose tools list is empty** | Reaches no catalog tool | Still reaches no catalog tool. Room admin is not always on |
| **tries to delete the standup that was declared in a file** | There is no delete tool. Re-opening the room leaves its members as they were at first open | Refused. A declared room stays. Delete applies to a Collab-minted room |
| **tries to invent a new channel kind from the tool** | n/a | Refused. Create opens a session on a kind the app already registered |

An app can already declare rooms and open one session per room on one shared kind. A **seat** cannot open, close, or change membership while work is running. That gap is a capability, the same shape as seat-hire. It is not a new kind of thing in the framework, and it is not a merge of the two tickets.

## What changes

![Two panels. Today a manager can talk but cannot open a room, file rooms become sessions on one kind, and discover only shows rooms in both the file tree and the inventory. After, the kind installs a channel-admin capability, the seat names the tools, and a new room is a session on that kind. Declared rooms stay. Whether teammates can find a room with no file is the open call.](figures/what-changes.svg)

Read the fence row. Room admin is a catalog tool a seat must name. The door it writes is a session on the channel kind that already exists. A declared room is not that door. The yellow box is the live call: after a seat opens a room that has no file, can teammates find it the way they find every other room?

**What a manager's file would look like, if this ships:**

```diff
  # WORKER.md — eng.manager
  flow: agent
  description: Opens a room when the work needs one.
+ tools: [create, delete, invite, uninvite]
+ capabilities:
+   channel-admin: []
```

The verb names are the recommended cut. They are [still open](DECISIONS.md#recommended-still-open).

**What that seat would call, on a room Collab can mint:**

```diff
+ create({ channelId: "eng.feature", description: "The feature room.",
+          members: ["eng.ada"] })
+ → { channelId: "eng.feature" }
```

`channelId` is the session id. `kind` defaults to `"channel"`. There is no field for source code, a new flow name, or a `system:` flag.

## What stays as it is

- **File declaration and boot open.** `CHANNEL.md`, `channelInstances`, and `openChannels` stay the way a declared room comes into existence. This ticket does not add verbs to that binder.
- **One kind, many sessions.** A room is a named session on a registered channel kind. Create does not register a kind.
- **Post, fan-out, and boards.** A channel holds the conversation. Seats do the admin. Boards stay on the channel; this ticket does not drain them.
- **Inventory rows.** A row means the room was registered. Nothing in this explore deletes one.
- **Seat-hire.** [FIX-1480](https://linear.app/fixpoint-labs/issue/FIX-1480) stays a sibling. Hiring a person is not opening a room.
- **Collab's mint.** Dynamic rooms are minted there. This explore specifies the seat-facing tools. It does not reopen the Collab release.
- **W4 first-cut.** Related, not a child. Not a hard gate of work routing.
- **The DevForce manager.** Pressure on the design only. Not a Workforce teach path until the tools and the mint both exist.

## Sign off

This is **ratify, then file ship tickets** — not implement. The four walls named on the issue stay open. The leans are in [DECISIONS.md](DECISIONS.md#recommended-still-open). Ratifying this brief does not close them.

1. **[D1](DECISIONS.md#d1) · After a seat opens a room that was never in a file, teammates find it the same way they find declared rooms.** The minted-room list is the "declared" half for a room with no file. The inventory row is still required. If wrong: dynamic rooms are a second, quieter directory, and "what rooms are there?" has two answers.
2. **The surface is a capability plus named tools, on sessions of a channel kind the app already registered.** Declared rooms cannot be created, deleted, or re-membered by the tool. Dynamic rooms come from Collab's mint. Not a Channel type, not a second registry, not always-on, not a new flow kind. If wrong: we have taught "capability" as the thing you add when the noun is important, which is how Channel and ChannelAdmin become types.

The POC ran the current join, the current binder, and a re-open. A room that exists only as an inventory row is **invisible**. Two declared rooms share **one** instance. A file that says `system:` is **refused**. Re-opening a bound room **does not** change its members. That is why D1 is the call to weigh, and why invite cannot be "edit the file." [POC](poc/channel-admin-compose/README.md).
