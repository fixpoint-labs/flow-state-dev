---
description: The desk channel. A human poke is leftover, not a transport.
flow: channel
members:
  - night-watch
  - reviewer
  - triage
---

A `CHANNEL.md` is Layer 2 consumption. It is not an inbound transport
and it is not in the event catalog.

`hooks.yaml` beside this file may say a poke wakes the desk. That poke
is leftover — same as #2369 / #2370 / #2372. It does not become a
webhook and it does not mint a Heartbeats surface.

Today's `CHANNEL.md` closed key list refuses unknown keys. `wake:` here
would not hire. Proposed: a channel-wake reader, or keep pokes leftover.
