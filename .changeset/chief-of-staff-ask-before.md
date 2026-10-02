---
"@flow-state-dev/workforce": minor
---

`createSeatHireCapability` takes `askBefore` to put named changes behind a person's approval: a listed `hire` or `fire` tool runs its refusals, then suspends with a `human_approval` (`data: { verb, seatId, kind, owner, incarnation }`) and on approve changes that row only; a seat id that names another row by then is refused. `rehire` always asks, and the capability also carries `brokenSeats` and `rehire` as tools. Asking needs durable execution; without it a listed tool refuses by name. A hire under the id of a seat the app declares is refused, from the capability and from `createSeatHireBlocks`. `brokenSeats` reports each row's `owner` (`organization` or `me`) and `rehire` takes it, so a repair reaches the row it names. `resolveHeldPackages` takes an optional organization id so a hired org seat's packages resolve (FIX-1719).
