# FIX-1812 · Decisions

[Spec](SPEC.md) · **Decisions** · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md)

<a name="d1"></a>
## D1 · A rename wrapper is one the model reads

A site is in scope when the sequencer has a `description` and its chain is exactly one
`.step(block)`. A `description` only matters when a model reads the block as a tool, so this is
the line between "a wrapper that renames a block for the model" and "a sequencer that is an
action's root".

- **Instead of:** every one-step sequencer. The 893 undescribed ones are action roots, durable
  flags (`durable: true`), state carriers (`stateSchema`) and test harnesses. `.as()` cannot
  replace them; removing them would be a different change (pass the block to the action
  directly) with different risks.
- **Because:** tenet 3 (subtract): the issue retires one pattern, and this keeps the diff to
  that pattern.
- **Locks in:** the sweep checker's classification. A described one-step wrapper added later
  fails the checker until it is classified.

## Engineering calls

- **E1 · Docs and README examples are sites.** They are what authors copy, so the pattern
  survives in them if they are left. `projects.md` shows `createProject` with no approval tap,
  so there it is a pure rename and is replaced.
- **E2 · An inner block built in place takes the name directly.** The kitchen-sink mailbox
  control constructs its dispatcher inline. It gets `name` and `description` on the dispatcher
  itself; `.as()` is for blocks you did not build.
- **E3 · Tests about sequencer tools stay.** `packages/core/test/flow-config.test.ts` has two
  rename-shaped wrappers, but the subject of those tests is a sequencer used as a tool.
- **E4 · Mailbox sites may disappear first.** FIX-1786 retires mailboxes. If
  `mailbox-post-control.ts` is gone when this is built, its entry is removed from the checker
  and recorded as removed elsewhere.
- **E5 · Taps stay as sequencers.** `fire`, `createProject` (host) and `setRepository` keep
  their wrapper, per the issue. Whether `.as()` could compose with taps is out of scope.

## Open

None.

## How it got here

- **Draft:** written from the issue, FIX-1811's description, and `main` at `028d3547`; the site
  list comes from the sweep checker, not from reading.
