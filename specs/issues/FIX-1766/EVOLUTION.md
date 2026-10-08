# FIX-1766 · Evolution

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md) · **Evolution**

FIX-1766 is slice 2 of the four-slice design in [FIX-1762's EVOLUTION.md](../FIX-1762/EVOLUTION.md),
which Jake confirmed on 2026-10-04. It builds what that design drew for slice 2 and changes three
details: two forced by FIX-1793, which was specced after it, and the held work's shape, changed
by the amendment below.

## Lineage

| Prior intent and precise source | Treatment | Why / evidence | Replacement | Compatibility |
|---|---|---|---|---|
| The overlay: a `worktree-overlay/<runId>` collection plus a git bundle; [FIX-1762 Decided by Jake](../FIX-1762/DECISIONS.md#decided-by-jake-2026-10-04), [Holding uncommitted work](../FIX-1762/EVOLUTION.md#holding-uncommitted-work) | **Amended**: one git pack per hold, keyed `worktree-overlay/<user\|org>/<scopeId>/<projectId>/<run>/<snapshot>.pack`, in a held-work store ([D3](DECISIONS.md#d3)) | Storage follows project visibility ([FIX-1793 BR-33](../FIX-1793/BUSINESS-RULES.md#coding-runs)), so a run's work needs its project's key and scope; the amendment below replaced paths-plus-bundle with one snapshot | [D1](DECISIONS.md#d1), S1 S2 S7 | No held work exists yet |
| Restore: live place, else provider snapshot, else clone + bundle + overlay, else base and tell the person; verify and park on mismatch; [Restoring a session](../FIX-1762/EVOLUTION.md#restoring-a-session) | **Retained**, the snapshot branch left to slice 3; "bundle + overlay" is now one pack | As drawn; the "person" was left open and is the run's owner here | BR-16–BR-23, [D2](DECISIONS.md#d2) | — |
| Worktree states, slice 2 adds `lost` and `restoring` and moves provisioning state onto the run record; [Worktree states](../FIX-1762/EVOLUTION.md#worktree-states) | **Retained**, written only with holding on | As drawn; off is today's `main` | BR-25, BR-28, S6 | Old records read as no state (BP-030) |
| `checkpoint` and `restore` as declared no-ops on the workspace host; [FIX-1762 PLAN S3](../FIX-1762/PLAN.md#surfaces), shipped in `packages/workspace/src/local-host.ts` | **Superseded** where the host has a held-work store | This slice | S2 S4 | Same methods; a host without `heldWork` keeps today's behaviour |
| Reuse the FIX-150 projection, not a parallel sync machine; issue fence, which names "ProjectedResource*" | **Superseded** by the amendment: held work no longer goes through a projection | A pack is one write of one key, not a second sync machine; reviewed in finding 1 below | S2 | The kept files still use the projection, unchanged |
| A private project's files in its owner's user scope; [FIX-1793 BR-33](../FIX-1793/BUSINESS-RULES.md#coding-runs), [D1](../FIX-1793/DECISIONS.md#d1) | **Retained**, extended to held work | The Architect's fence | BR-12, BR-13 | — |
| harness-manager's "One host's storage" limit; `packages/harness-manager/README.md` → Limits | **Superseded** for hosts with a held-work store | This slice | S10, [DOCS.md](DOCS.md) | A host without one, or a local repository, keeps the limit |

FIX-1762's slice 1 locks are untouched: the remote on the row, the checkout derived from the row,
`project/` beside it, no fetch or reset of a live checkout.

<a name="amendment-history"></a>
## Amendment history

<a name="the-2026-10-08-amendment"></a>
### The 2026-10-08 amendment

After merging [#2878](https://github.com/fixpoint-labs/flow-state-dev/pull/2878), Jake said:
*"yes, amend the spec to the git snapshot shape. I also think we need to consider if this should
only use blob storage"*, and *"It also needs to be entirely optional. When using sandboxes that
preserve state or local file systems, it's not necessary."* The shape comes from jhoffner's
[second look](https://github.com/fixpoint-labs/flow-state-dev/pull/2878#issuecomment-6066140305)
on that PR.

| Merged intent, in this directory at `1fa5f322d` | Treatment | Why | Replacement |
|---|---|---|---|
| Dirty-paths place, binary encoding, tombstones, `projection.adopt()`, per-path hashes, one bundle (old PLAN S2a–c) | **Superseded** | Finding 1: git already expresses base, commits and working tree as one object; the per-path shape lost modes and symlinks | A temporary-index snapshot and one pack per hold: PLAN S2, BR-1–BR-6 |
| The mismatch check over every field and every path hash (old BR-18) | **Amended** | Finding 1: the rebuilt tree equal to the snapshot's covers every path | BR-18, BR-19 |
| Held rows overwritten in place, record written last; "fresh generation, then switch" dropped (old Considered and dropped) | **Superseded** | Finding 2: a crash mid-hold, the likeliest crash, would park the run and lose the previous turn | A new key per hold, switched to last; orphans left for FIX-1768 or a sweep: BR-6, BR-30, goal leg d |
| BR-5 held binary, renamed and nested paths, silent on modes | **Amended** | Finding 4 | Exec bits and symlinks held; staged state and empty directories stated as not kept |
| Old D1's `worktree-overlay/**` collection at org and user scope (old PLAN S5) | **Superseded** under D3's recommendation; returns if D3 picks the collection | Jake's blob-storage question; FSD's state routes read whole scopes at once | A prefix picked by visibility on a held-work store: D1 (locks-in), D3, PLAN S7 |
| The `epoch` key and `held.epoch` (old D2, BR-20, BR-27) | **Superseded** | Every hold is a new key, so a mismatched pack is never overwritten without an epoch | `held.snapshot`: D2, BR-20, BR-27 |
| Holding whenever the source names an overlay | **Amended**: also needs the host's `heldWork` option, off by default | Jake, 2026-10-08 | [Opt-in](DECISIONS.md#opt-in), BR-28, BR-29, goal leg e |
| PR 2 may land org-scope only if FIX-1793 is late | **Already fixed** before merge (finding 3) | — | PR 2 waits on FIX-1793 |
| A bounded retry of a failed hold (finding 5); the retry's actor reading a private project's scope (finding 6) | **Recorded** as implementer notes | Below the spec bar; finding 6 is a check against FIX-1793 BR-34 | [PLAN → Notes from review](PLAN.md#notes-from-review) |

Q1, D1's scope rule and D2's owner are unchanged.

<a name="the-store-lifecycle-amendment"></a>
### The store-lifecycle amendment

Jake merged [#2881](https://github.com/fixpoint-labs/flow-state-dev/pull/2881) (D3 with it); jhoffner's
[second look](https://github.com/fixpoint-labs/flow-state-dev/pull/2881#issuecomment-6068041468)
on it came after. Jake approved its first three findings ("go", 2026-10-08).

| Merged intent, at `b644fd56c` | Treatment | Why | Replacement |
|---|---|---|---|
| `HeldWorkStore` is `put` and `get`; no list, no delete | **Amended**: `delete(key)` and `list(prefix)`, both required, a missing key a no-op; `list` unused in this slice | Finding 1: adding a method later breaks every adapter written now, and FIX-1768's orphan sweep needs `list` | D3, S1, pinned names |
| A hold never deletes; orphans and every superseded pack wait for FIX-1768 | **Superseded**: after the switch, the hold deletes the pack it replaced, unless that pack parked | Finding 2: every pack holds the whole run, so ten turns stored ten; a parked pack is evidence, as a mismatch overwrites and deletes nothing | BR-6, BR-30, guardrails, control `delete-first` on leg d |
| BR-29: an off host provisions from the base and logs | **Superseded**: it parks for the owner, `field: "disabled"` | Finding 3: a mixed fleet restarted runs silently | BR-28, BR-29, the vocabulary table, S4, goal leg f |
| D3's flip case and adapter cost | **Amended** | Finding 4: a shared NFS folder works; `put` must be atomic | D3 |
| D3 open, and "If D3 goes the other way" | **Decided** at #2881's merge; the branch removed | — | D3 |
| Finding 5; four Cursor notes on #2881 | **Recorded** and folded in: implementer notes; the "holding applies" predicate, the `^lastSnapshot` limit, the FIX-367 adapter line, the FIX-1793 line above the fold | Below the spec bar | [PLAN → Notes from review](PLAN.md#notes-from-review), guardrails, D3, SPEC |

## What slices 3 and 4 get from this one

| Slice | Issue | What it builds on |
|---|---|---|
| 3 | [FIX-1767](https://linear.app/fixpoint-labs/issue/FIX-1767) | The `heldWork` option: a sandbox that preserves its state leaves it off and needs nothing from this slice; one that can lose its disk passes a `HeldWorkStore` (a Vercel Blob one, likely) and holds work the same way · `heldPrefix` on a run source's answer · `held.snapshot` and the pack's key on the run record as the fallback when its snapshot is stale, expired or in another region · the `place.state` words and `origin` values, which it reports unchanged · the restore check, applied to a snapshot before it is trusted |
| 4 | [FIX-1768](https://linear.app/fixpoint-labs/issue/FIX-1768) | `held.snapshot` on the record, so a push can prove it carried everything held (the snapshot's tree, committed) and "nothing unpushed is deleted" is checkable · one prefix per run, `worktree-overlay/…/<projectId>/<run>/`, to drop after the pull request merges, by `HeldWorkStore.list` on that prefix and `delete` on each key, which also takes orphans from a crash mid-hold and packs that parked, since no record names them · no change to the port · moved-aside directories to release |

Neither is started here; both are blocked by this issue in Linear.
