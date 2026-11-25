# FIX-2935 · Decisions

[Spec](SPEC.md) · **Decisions**

## D1 · The shared rule keeps today's bash folder paths

**The call.** The folder rule produces the same path the bash tools produce today for the same
scope and identity. Checkout paths keep their own encoder (D3).

**Why.** Bash folders hold a person's files between turns. Moving them silently would look like
lost work.

**If wrong:** bash folders could move to a stronger encoder with a migration; that is the
filed follow-up, not this issue.

## D2 · The helpers' names are the implementer's

`scopeFolder` and the projection session helper's name are working names. Read
`docs/contributing/glossary.mjs` before naming, and record the chosen names in the PR.

## D3 · Two encoders, both in workspace; checkouts keep theirs

**The call.** The checkout encoder (`encodeSegment`, `tenantSegment`) moves into workspace
unchanged, and `checkoutPathFor` keeps today's component list. It does not adopt `safeSegment`
or call `scopeFolder`.

**Why.** `safeSegment` hashes UTF-8, so `\ud800`, `\ud801`, `\udfff` and U+FFFD all become
`enc---83d544ccc223` (measured). User, org and tenant ids are unrestricted strings, so two
principals would share a checkout, a branch and a lock. A user scope's `scopeComponents` also
has no org, and one user in two orgs needs two checkouts. One encoder would trade isolation for
tidiness. Two, in one package, is the boundary this epic wants.

**If wrong:** nothing moves on disk; the cost is one more function in workspace.
