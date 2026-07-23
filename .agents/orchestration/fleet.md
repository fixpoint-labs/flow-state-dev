# Fleet: FIX-920, FIX-917, FIX-923, FIX-924

Started: 2026-07-23
Concurrency N: 4 declared, cap 3 simultaneously implementing.
Linear access: MCP is wrong-workspace (OnSecurity). Use Linear GraphQL API + $LINEAR_API_KEY for fixpoint-labs issues.

## Status table
| Issue | Phase | Spec PR | Impl PR | Gate pending? | Worktree | Notes |
|-------|-------|---------|---------|---------------|----------|-------|
| FIX-920 | AWAITING_SPEC_APPROVAL | #853 | — | YES (user sign-off) | claude/fix-920-spec-tsdnqg | depends FIX-918 (Done) |
| FIX-917 | NEEDS_SPEC → dispatching | — | — | no | tbd | block-state fast-follows |
| FIX-923 | NEEDS_SPEC → dispatching | — | — | no | tbd | RESEARCH issue |
| FIX-924 | NEEDS_SPEC → dispatching | — | — | no | tbd | soft-coupled to FIX-923; DO NOT implement 924 until 923 research accepted |

## Active workers (this wake)
- FIX-917 spec: agent a7621470321a9f83b
- FIX-923 spec: agent a4b36595baaf567fd
- FIX-924 spec: agent a44095c6f0aafd351

## Dependencies / sequencing
- FIX-920 unblocked (FIX-918 Done). Parked at spec-approval gate.
- FIX-923 (research) informs FIX-924 (impl). Specs can proceed in parallel; gate 924's IMPLEMENT phase on 923 acceptance.
