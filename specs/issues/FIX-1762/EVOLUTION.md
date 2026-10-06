# FIX-1762 · Evolution

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md) · **Evolution**

FIX-1762 is slice 1 of a four-slice design for how a project, its repository, its own files, the
worktree a run edits, and the place that run lives in fit together. Jake reviewed the design on
2026-10-04 and confirmed its calls ([DECISIONS.md](DECISIONS.md#decided-by-jake-2026-10-04)). This
page is the whole arc, so each later slice plugs into what slice 1 builds instead of redoing it.

## Lineage

| Prior intent and precise source | Treatment | Why / evidence | Replacement | Compatibility |
|---|---|---|---|---|
| A project is a row in the org resource plane, nothing in L1, no new folder; [FIX-1650 D2](../../epics/FIX-1650/DECISIONS.md#d2), [ER-10](../../epics/FIX-1650/BUSINESS-RULES.md#what-no-child-may-do) | **Retained**, extended by one field | The repository is project data a person changes at runtime | S5: `repository` on the row | Old rows read as `null` |
| The checkout's source repository is host-set, one per manager; no retained spec, provenance is `WorkspaceConfig.sourceRepo` in `packages/harness-manager/src/workspace.ts` and its README | **Amended**: provisioning moves behind a shared workspace host; a fixed `sourceRepo` becomes a constant source | Repository and files sources both need it, and tool workers too ([D2](DECISIONS.md#d2)) | S1, S3, S4 | A fixed `sourceRepo` behaves as today |
| The workspace projection binds a whole collection to a place (FIX-150, `@flow-state-dev/workspace`) | **Retained**, extended with a key-prefix scope | One project's files must never reach another's run | S2 | Unscoped mounts unchanged |

## Who owns what

![Ownership map: FSD's durable store holds the project row, the run record, project-files and, from slice 2, the worktree overlay; the ephemeral place holds checkout/, project/ and .fsdev/; outside FSD are the git remote and a sandbox provider's snapshots](figures/evo-ownership.svg)

Three kinds of storage: FSD's store is the record, the place is fast and disposable, and anything
outside FSD is only pointed at. Code is copied from the remote into the place, never into FSD's
store; the overlay (slice 2) is the one exception, and it is dropped once the work is pushed.

## Why a repository is not a projected resource

A projected collection serves read-only records from a store the app owns, read or searched one at
a time. A repository is a tree of files plus history, branches and refs, written by commits and
pushes and synced by git's own clone, fetch and push, read by an agent in a working directory. So
the project holds a reference to the remote, and the run's checkout is the projection. A read-only
view of repository files for the UI or search could later be a projected collection over the git
host's API, next to the checkout, not instead of it.

## Layers

![Layers: Workforce holds projects, the project row and projectWorkspace, which fills the run-source hook; harness-manager and the bash and file tools both call the shared workspace layer, which holds the run source, the workspace host, places, the projection and sandbox adapters; core and engine are unchanged](figures/evo-layers.svg)

Two hooks are the only seams: the run source (which repository and base, or which files; Workforce
fills it) and the workspace host (where files live and how they are kept; the operator picks local
disk or, from slice 3, a sandbox).

## One run, end to end

![Sequence of one coding run: resolve the source, fetch into the host clone, add the worktree, record branch, base and place, hydrate project files, the agent's turn, checkpoint dirty paths to the overlay, flush project files, decide, push and open a pull request, retire the overlay and release the place](figures/evo-one-run.svg)

Slice 1 builds steps 1–3, 5, 6, 8 and 9 (and records the remote and base on the run). Step 7 is
slice 2, step 10 and 11 are slice 4.

## Inside a place

```
<root>/clones/<remote-key>.git        one per remote, fetched before each new branch
<root>/<tenant>/<user>/<board>/<row>--<phase>/
    checkout/      git worktree on the row's branch, the agent's cwd (repository projects)
      .fsdev/      ask markers, ignored by git (today)
    project/       hydrated from project-files/<projectId>, synced back
    workspace/     the agent's cwd for a project with no repository
```

In a sandbox (slice 3) the same directories sit at the sandbox's root, with no shared clone. The
two never contain each other, so git never sees project files and the projection never sees code.

## Worktree states

![Worktree states: requested, provisioning, ready, running, parked, refused; and from later slices lost, restoring, pushed and retired](figures/evo-worktree-states.svg)

Slice 1 keeps today's provisioning, running, parked and refused. Slice 2 adds lost and restoring and
moves provisioning state onto the run record; slice 4 adds pushed and retired.

## Holding uncommitted work

![Durability table: the live place survives only a parked turn; a provider snapshot survives a stop but only in its region and provider and until its TTL; FSD's overlay survives everything up to the last checkpoint on any host, region or provider; a pushed branch survives everything](figures/evo-durability.svg)

The overlay is what lets FSD say uncommitted work is safe regardless of provider, region or crash;
a provider snapshot only buys fast resume (decided by Jake). Slice 2.

![A checkpoint writes only the paths git reports dirty, a tombstone for each deletion, and the unpushed commits as one bundle, with the base and head recorded; ignored files such as node_modules and .env are skipped](figures/evo-checkpoint.svg)

A checkpoint costs about `git status` plus the changed files, through the same projection as
project files, so two writers get the same conflict outcomes.

## Restoring a session

![Restore: use the live place if it is there, else a valid provider snapshot, else clone at the base and apply the bundle and overlay, else start at the base and tell the person; always verify against the run record and park the row on a mismatch](figures/evo-restore.svg)

Slice 2, with the snapshot branch in slice 3. Verification against the run record catches a stale
or foreign snapshot; a mismatch parks the row for a person and never overwrites.

## A project with no repository

![A project with no repository: project-files is the record, starting empty; each run's workspace/ is hydrated from it and synced back, a tool worker after each write and a harness at turn end and when parked; two runs merge per file and a conflict is reported; a lost place hydrates again](figures/evo-no-repo-files.svg)

Slice 1 ([D1](DECISIONS.md#d1)). With no git there is nothing to check into, so the sync is the
save and a restore is just another hydrate; no overlay is needed.

## Harness worker and tool worker

![A harness worker runs a vendor process inside the place that edits checkout/ unseen and is checkpointed after the turn; a tool worker runs its model loop on the FSD server and edits through tool calls, checkpointed after any write](figures/evo-harness-vs-tool.svg)

Storage is the same either way. What differs is who runs the model loop, where, and how much of the
editing FSD sees, which is why the run source and workspace host live in the shared layer
([D2](DECISIONS.md#d2)).

## Slices

| Slice | Issue | What it adds |
|---|---|---|
| 1 | FIX-1762 | Repository on the project; the shared run source and local workspace host; one clone per allowed remote; `checkout/` + `project/` for repository projects, `workspace/` for the rest; key-scoped sync back |
| 2 | [FIX-1766](https://linear.app/fixpoint-labs/issue/FIX-1766) | The `worktree-overlay/<runId>` collection and bundle, the lost and restoring states, provisioning state on the run record, several hosts |
| 3 | [FIX-1767](https://linear.app/fixpoint-labs/issue/FIX-1767) | A Vercel sandbox workspace host; the provider snapshot for fast resume, the overlay as fallback |
| 4 | [FIX-1768](https://linear.app/fixpoint-labs/issue/FIX-1768) | Push the branch, open the pull request, then drop the overlay and release the place |

Each slice works alone and none redoes the one before it.
