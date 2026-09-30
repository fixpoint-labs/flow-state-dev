# FIX-1084 · Docs

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs**

**Site docs (`apps/docs`): no change.** Nothing a user writes or observes changes: no API, no
option, no address. Package READMEs: no change for the same reason.

**Internal architecture doc: one update.** `docs/architecture/state-and-scopes.md` names the
execution-side bucket builder as the place session routing is decided, which stops being true.

## `docs/architecture/state-and-scopes.md` → "Where resolution happens" · UPDATE

Replace the first paragraph of that section with:

> **Where resolution happens.** One session routing index in
> `packages/engine/src/resources/lineage-scope.ts` walks a flow's session-scoped declarations
> once: singles by canonical storage key, collection instances by pattern prefix, each carrying
> its `sharedToLineage` flag. Both paths read it. On the execution path,
> `createExecutionContext` builds its session buckets from the index and refuses, at context
> construction, collections that share a storage prefix but disagree on the flag, like the
> `flowIsolation` case. User and org buckets are still built in `createExecutionContext`.

Keep the next paragraph and its three bullets (the HTTP helpers). In the third bullet, if the
implementation collapses execution's `storageScopeOf` onto `sessionStorageScope`, replace "It and
`createExecutionContext`'s `storageScopeOf` answer one question, and they have already disagreed
once…" with "Execution calls it too." Otherwise leave it.

In "**Ownership is one rule, in one place.**", extend the first sentence's subject: the
declaration walk that feeds `resolveOwnershipFlag` is now shared as well, so the sentence reads
"`resolveOwnershipFlag`, fed by the session routing index, decides which declaration owns a
storage key…".

Voice: internal doc, dry is fine; no issue numbers are needed beyond those the section already
carries.
