# FIX-1906 · Documentation draft

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs** · [Evolution](EVOLUTION.md)

This issue owns the epic's ownership row "a checkout on the host's machine"
([FIX-1903 DOCS](../../epics/FIX-1903/DOCS.md#ownership)). The names below are the ones
[PLAN.md](PLAN.md#pinned-names) pins. The paths and the remote in the examples are illustrative.

## UPDATE · `apps/docs/docs/workforce/projects.md` · new subsection after "Coding work in a project"

FIX-1905 adds "Tools a project's coding work gets" to the same section. Whichever lands second
links to the other rather than repeating it.

> ### Working in a checkout you already have
>
> By default a coding run gets a fresh branch in the host's own clone of the project's
> repository. That clone lives under the host's root, so to see what a run did you fetch from
> it. When the server runs on the machine where you already have the repository checked out,
> you can have runs work in that checkout instead. Each run gets a worktree of your checkout on
> a branch of its own, and the branch shows up in `git branch` there.
>
> The project's row doesn't change: it still names a remote. The server's config says which
> projects are worked in which checkout:
>
> ```ts
> harnessManager({
>   workspace: localWorkspaceHost({
>     root: "/var/fsd/runs",
>     remotes: { allow: [] },
>     localRepositories: ["/home/me/acme"],
>     source: projectWorkspace({
>       checkouts: [
>         {
>           remote: "https://github.com/acme/acme.git",
>           checkout: "/home/me/acme",
>           projects: [
>             { visibility: "shared", id: "web" },
>             { visibility: "shared", id: "api" },
>           ],
>           baseRef: "main",
>         },
>       ],
>     }),
>   }),
>   uses: [projectWorkspaceCapability],
> });
> ```
>
> A run uses the checkout only when its project is listed by both visibility and id, and the
> project's `repository` is exactly the `remote` given here. A private project with the same id
> and remote isn't listed, so its runs never touch your checkout. Neither does a listed project
> whose repository was changed to something else. Those runs go the usual way: a clone, if the
> host allows the remote, or a refusal.
>
> The checkout also has to be in the host's `localRepositories`. That list is what lets the host
> touch a folder on its machine at all. If the two disagree, the run is refused with
> `invalid-remote`, naming the path, before git runs.
>
> Each run's place has the worktree in `checkout/` and the project's files in `project/` beside
> it, as for any other repository. The branch is cut from `baseRef`, or from whatever your
> checkout has checked out when `baseRef` is left out. Nothing is fetched, so `main` is whatever
> you last pulled. The server never switches, resets or cleans your own working tree.
>
> Several projects can share one checkout, and their runs work side by side, each in its own
> worktree on its own branch.
>
> To review a run, open its worktree, or run `git diff main...<branch>` from your checkout. The
> branch stays checked out in the run's worktree, because a run can be continued later, after a
> question is answered or when you send it another turn, and it picks up in the same place. So
> git won't check that branch out a second time in your own tree. When you're done with a run,
> `git worktree remove <path>` frees the branch.
>
> A fresh worktree has no `node_modules`. The coding agent installs them the way your repository
> tells it to. With pnpm that comes from the machine's shared store and takes seconds once the
> checkout has been installed.

## UPDATE · `packages/workspace/README.md` · "A repository on this machine", the paragraph after the example

Replaces the paragraph that begins "The run's branch is cut from `baseRef`".

> The run's branch is cut from `baseRef` (or `HEAD`) and stays in that repository. Nothing is
> fetched, on the first run or a retry, and the repository's own working tree is never touched.
> When the source names no kept files, the place directory is the checkout itself, with no
> `checkout/` level. When it names kept files, the place is laid out like a remote run's: the
> worktree in `checkout/` and the kept files in `project/` beside it. Any bare path not on the
> list is still refused as `invalid-remote`, before git runs.
>
> Runs in one repository don't share a lock. Each has its own place and branch, and git keeps
> concurrent worktrees apart. If git finds one of its own lock files held, that provision fails
> with git's message and isn't retried.

## UPDATE · `packages/workforce/README.md` · the `projectWorkspace()` bullet under "Projects", and its API row

Appended to the bullet, after the harness-manager example:

> Pass `checkouts` to have some projects' runs work in a checkout on the server's machine
> instead of a clone. Each entry gives a `remote`, the absolute `checkout` path, the `projects`
> it serves by `{ visibility, id }`, and an optional `baseRef` (the checkout's `HEAD` when
> omitted). A run uses the checkout only when its project is listed and its `repository` equals
> `remote` exactly; every other run is answered as before. List the same path in the host's
> `localRepositories`. A relative path, a `remote` a project couldn't store, or a project listed
> twice is refused when `projectWorkspace()` is called.

The API row for `projectWorkspace()` becomes:

> | `projectWorkspace({ checkouts? })` / `projectWorkspaceCapability` / `ProjectCheckout` | A run source for a coding run on a project: from the workstream its session leads or was filed from, the project its conversation belongs to, or the project its task names. `checkouts` (`ProjectCheckout[]`: `{ remote, checkout, projects, baseRef? }`) sends the listed projects' runs to a checkout on this machine. The capability holds the collections it reads. See [Projects](#projects). |

## Publication ownership

This issue publishes all three with its implementation PR. The epic's shared paragraph on
reviewing a run in its worktree ("Working on Shift Manager itself") holds as written, because
D3 keeps the branch checked out; FIX-1904 publishes it.
