# FIX-1277 · Documentation draft

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs**

No site documentation changes. Every store accepts, refuses and reports exactly what it does
today, with the same error text, so no page in `apps/docs` or `docs/architecture` becomes wrong.
`docs/architecture/state-and-scopes.md` describes the rule's meaning, not where its code lives.

One package README gains the new public helpers.

## UPDATE · `packages/contracts/README.md` · the "Pure helpers" bullet

- **Pure helpers** (`@flow-state-dev/contracts/helpers`) — `deepEqual` /
  `looseDeepEqual`, `cloneValue` (structural deep copy), `mapLimit`
  (bounded-concurrency map), `toError` (unknown-throw coercion), the
  string-case utilities `camelToKebab` /
  `normalizeTagName`, and the resource-state version rule every
  `ResourceStateStore` adapter shares: `assertSetExpectedVersion` and
  `assertDeleteExpectedVersion` refuse a version the verb can't act on by
  throwing a `TypeError`, and `resourceStateConflict` builds the conflict a
  losing write returns. A custom adapter calls these rather than restating
  them. Re-exported from `@flow-state-dev/core/helpers`.

## Publication ownership

FIX-1277 publishes this with the implementation. No epic owns the README.
