# FIX-2930 · Decisions

[Spec](SPEC.md) · **Decisions**

## D1 · The worktree row's tip is the host's own `baseTip`; no tip means today's count

**The call.** The row snapshot runs inside `localWorkspaceHost`, so it passes the host's own
`baseTip` for the row's base to `effectiveCut`, with the row's `baseCommit` as the cut. When the
host has fetched no tip for that base, `effectiveCut` keeps the cut and the count is today's.

**Why.** `effectiveCut` is already built so that a tip can only take the base's commits out of a
read, never add any. No new field on the row is needed, so stored rows need no migration.

**If wrong:** a row whose base the host never fetched shows the old count. The review card reads
the same tip, so the two still agree.
