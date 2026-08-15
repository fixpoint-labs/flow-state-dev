# dispatch

One of conductor's two seams: **how the work actually gets done.** Conductor works out
which phase an entity is in and what it needs; this directory hands that off to a coding
harness — a phase brief in, a typed result back — and provisions the branch and workspace
the harness runs in.

Its mirror is [`../observe`](../observe), the seam for how the world gets read.

| File | What it owns |
|---|---|
| `types.ts` | the seam itself — `Dispatcher`, `PhaseBrief`, `DispatchResult` |
| `brief.ts` | assembling a brief from an action, and rendering it as markdown for a harness that takes a prompt |
| `branch.ts` | branch naming and basing, and provisioning the worktree the work happens in |
| `claude-code.ts` | the first implementation, backed by Claude Code |

**Vendor-neutral by construction.** Nothing Claude-shaped appears in `types.ts`; a field
that only makes sense for one harness belongs in that harness's options. `claude-code.ts`
is an adapter, and a second vendor is meant to slot in beside it.

Two rules the seam depends on:

- **Conductor owns the branch; the dispatcher owns isolation.** A dispatcher declares
  whether it needs a dedicated worktree, the repo root, or nothing at all because it runs
  in the vendor's own environment — and conductor provisions to match. Harnesses do not
  create workspaces, and conductor does not guess what one needs.
- **`run` settles; it does not throw.** A harness that crashed, timed out, or was never
  installed comes back as a failed result with a reason. That becomes a `dispatch_failed`
  signal and an escalation. A thrown exception would skip the ledger and lose the
  transition entirely.
