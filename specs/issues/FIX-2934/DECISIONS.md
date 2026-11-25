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
