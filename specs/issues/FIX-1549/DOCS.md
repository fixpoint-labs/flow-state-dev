# FIX-1549 · Documentation draft

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs** · [Evolution](EVOLUTION.md)

Two existing pages change, plus two changesets. No new page. An app without Workforce needs no
documentation: it stops being refused, and nothing on the Core or Engine pages ever said it was.

## UPDATE · `apps/docs/docs/workforce/durable-hire.md` · "Hiring a seat only one member can reach", after the paragraph ending "each seat's `ownerPin` carries the user."

Installing the private collection also closes the rows to every other collection in your app.
Once a flow that declares it is registered, the app refuses to start if any flow declares a
collection whose pattern could reach a user-owned row: `workforce/roster/**`,
`workforce/roster/[owner]/notes`, a copy of `workforce/roster/[owner]/[seat]`, or a wide
parameterised pattern such as `[tenant]/**`. It doesn't matter which of the two flows registers
first. The error names the pattern, and says it can read user-owned roster rows.

An app that never installs the private collection has no such rows, and none of these patterns
are refused there.

If your app runs its flows in more than one process over the same store, for example a web
server and a queue worker, register the flow that declares the private collection in every
process that serves your app's flows. The check runs per process, so a process that never
registers it does not refuse an overlapping collection, and a flow there could read every
member's private rows.

## UPDATE · `packages/workforce/README.md` · the `defineHiredRosterPrivateCollection()` row

Replace the row's last two sentences ("Any other pattern that can reach those rows, … is
refused.") with:

> Registering it arms a check on the whole registry: any other collection whose pattern can
> reach those rows, including `workforce/roster/**`, `workforce/roster/[owner]/notes`, and a
> parameterised pattern such as `workforce/[area]/[owner]/[seat]`, is refused when either flow
> registers. Register it in every process that serves your flows over the same store.

## CREATE · `.changeset/<name>.md`

```md
---
"@flow-state-dev/core": minor
"@flow-state-dev/engine": patch
---

Resource collections no longer carry Workforce's roster check. `defineResourceCollection` accepts any valid pattern, and a flow registry refuses a pattern that can reach a user-owned roster row only once Workforce's private roster collection is registered in it. `assertRosterCollectionIsNotDeep` is no longer exported from `@flow-state-dev/core`.
```

## Publication ownership

FIX-1549 publishes these after V4 and VG pass. The durable-hire page is Workforce's; nothing
under `apps/docs/docs/resources/` or the Core and Engine READMEs describes the check today, so
nothing there changes.

**Voice constraints to watch** (CLAUDE.md "Writing Style"): no issue numbers on the page, no
em-dash as a connector, no "This …" sentence openers, and no history ("used to refuse").
