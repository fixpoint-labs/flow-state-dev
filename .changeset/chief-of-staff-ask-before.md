---
"@flow-state-dev/workforce": minor
---

`createSeatHireCapability` takes `askBefore` to put named changes behind a person's approval: a listed `hire` or `fire` tool runs its refusals, then suspends with a `human_approval` (`data: { verb, seatId, kind }`) and changes the roster only on approve. `rehire` always asks, and the capability also carries `brokenSeats` and `rehire` as tools. Asking needs durable execution; without it a listed tool refuses by name. A hire under the id of a seat the app declares is refused, from the capability and from `createSeatHireBlocks`. `resolveHeldPackages` takes an optional organization id so a hired org seat's packages resolve (FIX-1719).
