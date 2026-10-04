---
"@flow-state-dev/workforce": minor
---

A mailbox whose `MAILBOX.md` declares `routing:` with a `fallback:` member now sends each post from a person to one member, picked by `routeByPurpose(seats, { model })` passed as `defineMailboxFlow({ route })`, and that member's reply is posted into the mailbox as its line, with the mailbox's last 20 lines in view (the `routed` and `recent` fields on the notify input) (FIX-1610).

A seat of the built-in `agent` kind now needs a `seatId` setting when it is minted, which `hireWorkforce` writes on every seat: one minted straight off the kind without it is refused at the mint, naming the key. On any other kind, the `post-to-mailbox` tool refuses a seat without one before the model is offered the tool (FIX-1610).
