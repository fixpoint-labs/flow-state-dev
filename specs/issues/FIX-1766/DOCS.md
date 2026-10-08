# FIX-1766 · Documentation draft

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs** · [Evolution](EVOLUTION.md)

Proposed reader-facing prose. Implementation reconciles it against what ships, then publishes it
per [PLAN.md → Docs](PLAN.md#docs). Voice: `CLAUDE.md` → "Writing Style". Watch for: em-dashes,
"seamless", and the word *checkpoint*, which in these docs already means a durable action's
saved step. Product copy says *held work*; `checkpoint` stays only as the method's name. Written
for [D3](DECISIONS.md#d3)'s recommendation; if it goes the other way, "held-work store" becomes
"a collection in your app's store".

## UPDATE · `apps/docs/docs/workforce/projects.md` · "Coding work in a project", after its second paragraph

> A coding run can keep its work even if the machine it runs on is lost. This is off unless the
> operator turns it on for the workspace host, and most setups don't need it: a run on your own
> machine, or in a sandbox that keeps its disk, still has its work when it comes back.
>
> With it on, at the end of every turn (when the run finishes, asks a question, or fails), the
> run's unpushed commits and a snapshot of its files, edits, new files and deletions included,
> are written as one compact git pack to the held-work store the operator configured. The
> repository itself is never copied there, and nothing is written to your git host. If the next
> turn starts on another machine, that machine clones the repository, rebuilds the run's branch
> from the pack, and carries on. At most the turn that was running when the machine died is lost,
> and that holds even if it died while the work was being written.
>
> Held work lives where the project's files live: a private project's under its owner, a shared
> project's under the organization. The app's routes can't read it, and only the run itself uses
> it.
>
> Before the rebuilt branch is used, it's checked against what the run recorded. If anything
> disagrees, such as a pack that changed in the store or a base commit that's gone from the
> remote, the run stops and asks the person it belongs to, in their inbox, naming what didn't
> match. Nothing is overwritten. When they answer, the run starts again from its base, with the
> held files beside it in `held/` to pick from.
>
> Files your repository ignores, like `.env` or `node_modules`, are not held, and neither is a
> single file over 10 MB. A rebuilt run reinstalls its dependencies, and its changes come back
> unstaged. The coding agent's own conversation stays on the machine it ran on, so on a new
> machine the agent starts a fresh one and is told what was restored.

## UPDATE · `apps/docs/docs/orchestration/harness-manager.md` · "Limits"

Remove the **One host's storage** bullet. Add:

> - **Holding work across machines is opt-in.** Without a held-work store on the workspace host,
>   a run's work lives on that machine's disk, as before.
> - **One turn of work can be lost.** A run's work is held at the end of each turn, so a machine
>   that dies mid-turn loses what that turn did. On a repository the operator listed in
>   `localRepositories`, nothing is held: the work lives on that machine's disk.

## UPDATE · `apps/docs/docs/orchestration/harness-manager.md` · "The checkout", new last paragraph

> The checkout doesn't have to stay on one machine. When the workspace host has a held-work store
> and the source names where a run's work is held, the manager holds it at the end of each turn,
> and an attempt that lands on another machine rebuilds the checkout from it. The run record shows
> which machine the run is on, where its place stands (`provisioning`, `ready`, `lost`,
> `restoring` or `refused`), and when its work was last held or why it wasn't.

## UPDATE · `packages/workspace/README.md` · replace the line "`checkpoint` and `restore` exist on the host and do nothing yet…"

> ### Holding a run's work across machines
>
> Off by default. Turn it on by giving the host somewhere to put held work:
>
> ```ts
> localWorkspaceHost({ root, remotes, source, heldWork: fileHeldWorkStore({ dir: "/shared/held-work" }) });
> ```
>
> A `HeldWorkStore` has two methods, `put(key, bytes)` and `get(key)`. `fileHeldWorkStore` keeps
> each key as a file; for hosts on different machines, put its folder on shared storage or write
> a store over S3 or Vercel Blob. A host on a disk that is kept doesn't need one.
>
> The source names where a run's held work goes, with `heldPrefix` on a repository answer. Without
> a store or a prefix, `checkpoint` returns `null` and does nothing else.
>
> `host.checkpoint(place)` snapshots the checkout through a temporary index, packs the commits
> from the run's base to that snapshot, and `put`s the pack under `<heldPrefix>/<place>/<snapshot>.pack`.
> It never touches the repository's own index, writes no ref, and never contacts the remote.
> Ignored files and files over 10 MB are left out and named in what it returns: the base, head
> and snapshot commits, and the pack's key, hash and size. Record it on your run, last, after
> `checkpoint` returns; every hold uses a new key, so a run that crashes mid-hold still points at
> the last good one.
>
> Hand that record back to `provision`. The place it returns says where it came from in
> `origin`: `new` for a first provision, `live` for a place that is live on this host and
> recorded as this host's, handed back as it always was, `held` for one rebuilt from held work,
> and `base` when nothing was ever held. To rebuild, the host clones the remote, cuts the branch
> at the recorded base, unpacks the pack, checks out the snapshot, resets the branch to the head
> with the changes unstaged, and checks the rebuilt tree against the snapshot. When anything
> disagrees, `provision` rejects with `HeldWorkMismatchError`, naming the field, with nothing
> changed. That is not a `WorkspaceRefusedError`: a refusal won't clear on a retry, while a
> mismatch waits for a person to decide. A directory for the place that this host holds but the
> record doesn't name is moved aside and kept.
>
> A host's identity is its root's: hosts that share a root share their places.

## UPDATE · `packages/workspace/README.md` · API table

> | `localWorkspaceHost` | … `checkpoint` holds a repository run's work in `heldWork`, when the host has one; `provision` takes the run's recorded place and hold, and rebuilds a lost place from them. |
> | `HeldWorkStore` | Where held work goes: `put(key, bytes)`, `get(key)`. |
> | `fileHeldWorkStore({ dir })` | A `HeldWorkStore` over a folder. |
> | `HeldWorkMismatchError` | A rebuilt place disagreed with the run's record; `field` names what. |

## UPDATE · `packages/harness-manager/README.md` · "Running a project's work", after the `lastSave` paragraph

> When the workspace host has a held-work store and the source names where to hold, the manager
> also holds the run's repository work at the same three points. The run record's `held` shows
> the result: the attempt, the time, the base, head and snapshot commits, the pack's key, any
> files not held and why, and an error if the hold failed. A failed hold doesn't fail the run,
> and the next one tries again, except on an attempt that would complete: that attempt fails, so
> its retry holds the work. The record's `place` names the machine and its `state`:
> `provisioning`, `ready`, `lost`, `restoring` or `refused`. An attempt on another machine
> rebuilds the checkout from what was held. When the held work doesn't match the record,
> `place.state` stays `lost` and the row's status becomes `parked`, with a question to the run's
> owner; the operator's log names the run and what disagreed. Without a held-work store, none of
> this happens and the record has no `place` or `held`.

And in "Limits", the same removal and bullets as the docs site.

## UPDATE · `packages/workforce/README.md` · Projects, after the `readProjectFiles` bullet

> - **Held work.** `projectWorkspace` names where a coding run's held work goes on every
>   repository answer, as `heldPrefix`: under the project's owner for a private project, under
>   the organization for a shared one, the same rule as the project's files. It is used only when
>   the workspace host has a held-work store.

## Publication ownership

FIX-1766 publishes all of the above. FIX-1793 owns the private/shared prose on `projects.md`;
the "where held work lives" paragraph links to it and repeats none of it. FIX-1767 and FIX-1768
extend the states list and the "lost" bullet when they ship.
