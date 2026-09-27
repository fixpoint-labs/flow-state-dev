---
"@flow-state-dev/workforce": patch
---

A channel whose `CHANNEL.md` declares `routing:` with a `fallback:` member now sends each post from a person to one member, picked by `routeByPurpose(seats, { model })` passed as `defineChannelFlow({ route })`, and that member's reply is posted into the channel as its line, with the channel's last 20 lines in view (the `routed` and `recent` fields on the notify input) (FIX-1610).
