# FIX-1766 · Evolution

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md) · **Evolution**

FIX-1766 is slice 2 of the four-slice design in [FIX-1762's EVOLUTION.md](../FIX-1762/EVOLUTION.md),
which Jake confirmed on 2026-10-04. It builds what that design drew for slice 2 and changes two
details, both forced by FIX-1793, which was specced after it.

## Lineage

| Prior intent and precise source | Treatment | Why / evidence | Replacement | Compatibility |
|---|---|---|---|---|
| The overlay: a `worktree-overlay/<runId>` collection plus a git bundle; [FIX-1762 Decided by Jake](../FIX-1762/DECISIONS.md#decided-by-jake-2026-10-04), [Holding uncommitted work](../FIX-1762/EVOLUTION.md#holding-uncommitted-work) | **Amended**: keyed `<projectId>/<run>/<epoch>/`, and declared at two scopes | Storage follows project visibility ([FIX-1793 BR-33](../FIX-1793/BUSINESS-RULES.md#coding-runs)), so a run's work needs its project's key and scope; the epoch keeps a mismatched hold frozen ([D2](DECISIONS.md#d2)) | [D1](DECISIONS.md#d1), S2 S5 | No overlay rows exist yet |
| Restore: live place, else provider snapshot, else clone + bundle + overlay, else base and tell the person; verify and park on mismatch; [Restoring a session](../FIX-1762/EVOLUTION.md#restoring-a-session) | **Retained**, the snapshot branch left to slice 3 | As drawn; the "person" was left open and is the run's owner here | BR-16–BR-23, [D2](DECISIONS.md#d2) | — |
| Worktree states, slice 2 adds `lost` and `restoring` and moves provisioning state onto the run record; [Worktree states](../FIX-1762/EVOLUTION.md#worktree-states) | **Retained** | As drawn | BR-25, S4 | Old records read as no state (BP-030) |
| `checkpoint` and `restore` as declared no-ops on the workspace host; [FIX-1762 PLAN S3](../FIX-1762/PLAN.md#surfaces), shipped in `packages/workspace/src/local-host.ts` | **Superseded**: they do the work now | This slice | S2 | Same methods; a source with no `overlay` keeps today's behaviour |
| Reuse the FIX-150 projection, not a parallel sync machine; issue fence, which names "ProjectedResource*" | **Retained**, read as the `@flow-state-dev/workspace` projection | A `ProjectedResource` (FIX-1518) is read-only and cannot hold writes, as FIX-1762 found for repositories ([why](../FIX-1762/EVOLUTION.md#why-a-repository-is-not-a-projected-resource)) | S2 (with `adopt`) | — |
| A private project's files in its owner's user scope; [FIX-1793 BR-33](../FIX-1793/BUSINESS-RULES.md#coding-runs), [D1](../FIX-1793/DECISIONS.md#d1) | **Retained**, extended to held work | The Architect's fence | BR-12, BR-13 | — |
| harness-manager's "One host's storage" limit; `packages/harness-manager/README.md` → Limits | **Superseded** for runs whose source names an overlay | This slice | S9, [DOCS.md](DOCS.md) | A local repository keeps the limit |

FIX-1762's slice 1 locks are untouched: the remote on the row, the checkout derived from the row,
`project/` beside it, no fetch or reset of a live checkout.

## What slices 3 and 4 get from this one

| Slice | Issue | What it builds on |
|---|---|---|
| 3 | [FIX-1767](https://linear.app/fixpoint-labs/issue/FIX-1767) | The `overlay` field on a run source's answer, so a sandbox host holds work the same way · the manifest on the run record as the fallback when its snapshot is stale, expired or in another region · the `place.state` words and `origin` values, which it reports unchanged · the restore check, applied to a snapshot before it is trusted |
| 4 | [FIX-1768](https://linear.app/fixpoint-labs/issue/FIX-1768) | `held.head` on the record, so a push can prove it carried everything held and "nothing unpushed is deleted" is checkable · one prefix per run, `worktree-overlay/<projectId>/<run>/`, to drop after the pull request merges, frozen epochs included · moved-aside directories to release |

Neither is started here; both are blocked by this issue in Linear.
