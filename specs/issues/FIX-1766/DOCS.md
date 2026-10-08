# FIX-1766 · Documentation draft

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs** · [Evolution](EVOLUTION.md)

Proposed reader-facing prose. Implementation reconciles it against what ships, then publishes it
per [PLAN.md → Docs](PLAN.md#docs). Voice: `CLAUDE.md` → "Writing Style". Watch for: em-dashes,
"seamless", and the word *checkpoint*, which in these docs already means a durable action's
saved step. Product copy says *held work*; `checkpoint` stays only as the method's name.

## UPDATE · `apps/docs/docs/workforce/projects.md` · "Coding work in a project", after its second paragraph

> A coding run on a repository keeps its work even if the machine it runs on is lost. At the end
> of every turn (when the run finishes, asks a question, or fails), the files it changed, added
> or deleted, and the commits it hasn't pushed, are held in your app's store. The repository
> itself is never copied there, and nothing is written to your git host. If the next turn starts
> on another machine, that machine clones the repository, rebuilds the run's branch from what
> was held, and carries on. At most the turn that was running when the machine died is lost.
>
> Held work lives where the project's files live: a private project's in its owner's space, a
> shared project's in the organization's. Nobody reads it through the app's routes, and only the
> run itself uses it.
>
> Before the rebuilt branch is used, it's checked against what the run recorded. If anything
> disagrees, such as a file that changed in the store or a base commit that's gone from the
> remote, the run stops and asks the person it belongs to, in their inbox, naming what didn't
> match. Nothing is overwritten. When they answer, the run starts again from its base, with the
> held work beside it in `held/` to pick from.
>
> Files your repository ignores, like `.env` or `node_modules`, are not held, and neither is a
> single file over 10 MB. A rebuilt run reinstalls its dependencies. The coding agent's own
> conversation stays on the machine it ran on, so on a new machine the agent starts a fresh one
> and is told what was restored.

## UPDATE · `apps/docs/docs/orchestration/harness-manager.md` · "Limits"

Remove the **One host's storage** bullet. Add:

> - **One turn of work can be lost.** A run's work is held at the end of each turn, so a machine
>   that dies mid-turn loses what that turn did. On a repository the operator listed in
>   `localRepositories`, nothing is held: the work lives on that machine's disk.

## UPDATE · `apps/docs/docs/orchestration/harness-manager.md` · "The checkout", new last paragraph

> The checkout doesn't have to stay on one machine. When the workspace host's source names where
> a run's work is held, the manager holds it at the end of each turn, and an attempt that lands on
> another machine rebuilds the checkout from it. The run record shows which machine the run is on,
> where its place stands (`provisioning`, `ready`, `lost`, `restoring` or `refused`), and when its
> work was last held or why it wasn't.

## UPDATE · `packages/workspace/README.md` · replace the line "`checkpoint` and `restore` exist on the host and do nothing yet…"

> ### Holding a run's work across machines
>
> A repository answer can name a collection to hold the run's uncommitted work in, beside its
> kept files:
>
> ```ts
> { kind: "repo", repo, projectId: "storefront", files, overlay }   // overlay: { collection, collectionId }
> ```
>
> `host.checkpoint(place)` writes the paths git reports changed or untracked, a marker for each
> deleted path, and one git bundle of the commits since the run's base, under
> `<projectId>/<run>/` in `overlay`. Ignored files and files over 10 MB are left out and named in
> what it returns. It goes through the same projection as the kept files, reads git without
> taking its locks, and never writes a ref or contacts the remote. What it returns is a manifest:
> the base and head commits and a hash for every held path. Record it on your run, last.
>
> Hand that record back to `provision`. A place that is live on this host, and recorded as this
> host's, is handed back as it always was. Otherwise the host clones the remote, cuts the branch
> at the recorded base, applies the bundle and the held files, and checks every field of the
> manifest. A place that matches comes back `restored`. One that doesn't comes back refused as a
> mismatch, naming what disagreed, with nothing changed. A directory for the place that this host
> holds but the record doesn't name is moved aside and kept.
>
> A host's identity is its root's: hosts that share a root share their places. Without an
> `overlay`, `checkpoint` does nothing and the run's work lives only on this disk, as before.

## UPDATE · `packages/workspace/README.md` · API table, `localWorkspaceHost` row

> `checkpoint` holds a repository run's work in the answer's `overlay`; `provision` takes the
> run's recorded place and manifest, and rebuilds a lost place from them.

## UPDATE · `packages/harness-manager/README.md` · "Running a project's work", after the `lastSave` paragraph

> When the source names an `overlay`, the manager also holds the run's repository work at the
> same three points. The run record's `held` shows the result: the attempt, the time, the base and
> head commits, any files not held and why, and an error if the hold failed. A failed hold doesn't
> fail the run, and the next one tries again, except on an attempt that would complete: that
> attempt fails, so its retry holds the work. The record's `place` names the machine and the
> place's state. An attempt on another machine rebuilds the checkout from what was held. When the
> held work doesn't match the record, the row parks with a question to the run's owner, and the
> operator's log names the run and what disagreed.

And in "Limits", the same removal and bullet as the docs site.

## UPDATE · `packages/workforce/README.md` · Projects, after the `readProjectFiles` bullet

> - **`worktree-overlay`** holds a coding run's uncommitted repository work, at
>   `worktree-overlay/<projectId>/<run>/…`, in the same scope as the project's files. It has no
>   browser read and no read action; only the run's own attempts use it. `projectWorkspace`
>   names it on every repository answer.

## Publication ownership

FIX-1766 publishes all of the above. FIX-1793 owns the private/shared prose on `projects.md`;
the "where held work lives" paragraph links to it and repeats none of it. FIX-1767 and FIX-1768
extend the states list and the "lost" bullet when they ship.
