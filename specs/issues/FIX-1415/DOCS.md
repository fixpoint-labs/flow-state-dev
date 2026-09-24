# FIX-1415 · Documentation intent

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs** · [Evolution](EVOLUTION.md)

**Explore / not-ship.** No published page changes in this PR. What follows is what SHIP-A's implementation PR would hand `docs-writer`, then `docs-editor`. Do not draft the sentences here — the writer has not read this spec, which is the point.

## Destinations, after a ship

| Destination | Operation | What the reader must learn |
|---|---|---|
| `packages/workforce/README.md` | UPDATE · next to `openChannels` and `createWorkforceCapability` | There is a factory a **worker kind** installs when some of its seats should be able to open a dynamic room. Installing it is not granting it: a seat still names the verbs in `tools:`. The tool opens a session on a channel kind the app already registered. It does not invent a kind. A room that was declared in a file cannot be deleted or re-membered this way |
| Workforce user docs (the existing channels page, not a new noun page) | UPDATE | A seat opens a dynamic room by calling the tool. Teammates find that room the same way they find file-declared ones if [D1](DECISIONS.md#d1) shipped. Declared rooms stay. Empty `tools:` still means no room admin |
| Seat-hire docs, if any exist by then | CROSS-LINK only | Opening a room is not hiring a seat |

## Voice traps

- Do not say "we used to only open rooms from files." Outsider rule.
- Do not mention FIX-1415, W4, Door B, Collab, or ChannelAdmin.
- Do not document TTL, charter rewrite, or an EM-only tool.
- Do not imply every seat can open a room.
- Do not imply a declared standup can be deleted from chat.

## Not a destination

The channels file-convention page stays the authoring path. A kitchen-sink teach example is not proposed this cycle.
