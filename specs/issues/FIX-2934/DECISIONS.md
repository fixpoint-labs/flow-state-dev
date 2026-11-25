# FIX-2934 · Decisions

[Spec](SPEC.md) · **Decisions**

## D1 · `refreshLock` goes public beside `acquireLock` and `releaseLock`, not onto `WorkspaceHost`

**The call.** Export `refreshLock` from the root with the other lock functions.

**Why.** The lock it refreshes is harness-manager's checkout lease, which is held across
provisioning *and* the run (`acquireCheckout`, `harness-manager/src/workspace.ts`). It is not
the host's provisioning lock, which the host holds only while it provisions. A host method would
put a lock the host does not own on the host's API. The lock primitive is already public, and
a public `acquireLock` with no public refresh is the half-API that sent harness-manager to the
internal door.

**Rejected.** `WorkspaceHost.refresh(lease)`: it couples the host to a lease it never takes.

**If wrong:** a future host that wants to own the run-long lease adds a method then, and
`refreshLock` stays as the primitive under it.

## D2 · This reverses the `/internal` convention for the workspace package, on purpose

**The conflict.** `scripts/check-root-exports.mjs` (FIX-2448) says a root name only FSD's own
packages use belongs on the package's `/internal` subpath. `refreshLock` and `privateTempRoot`
are used only by our packages today, so that rule put them where they are.

**The call.** They go on the root anyway, documented through the changeset's `Docs:` line, which
is how that check clears a name with no adopter import (verified: the check passes on the built
change, listing both as "cleared only by a README or changeset mention"). The epic's premise is
that anyone writing a harness, us or an adopter, needs them, so "only our packages use it" is a
fact about today, not about who the API is for.

**What stays.** The convention itself, for every other package. This issue does not change the
check or the rule.

**If wrong:** two more names on the workspace root that only our packages import, which the
check's list shows the reviewer.
