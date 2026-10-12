# FIX-1927 · Documentation draft

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs** · [Evolution](EVOLUTION.md)

Four reader-facing surfaces describe a local checkout as never fetched, and two give a review
command that misleads once a run can start from upstream. No new page. Voice rules most at risk
here: no em-dashes as connectors, no sentence opening on "This", and introduce *upstream* in
plain words on first use.

## UPDATE · `apps/docs/docs/shift-manager/overview.md` · "Working on Shift Manager itself", the second and third paragraphs

Replace the paragraph that starts "Ask the chief of staff…" and the one after it with:

> Ask the [chief of staff](../workforce/chief-of-staff.md) for work on either project, and say
> which one, for example "on Shift Manager, make the empty Inbox say who to ask". A coding agent
> picks it up in a fresh worktree of your checkout, on a branch of its own. Before cutting that
> branch, the Lab fetches the latest `main` from GitHub and starts from whichever is newer, that
> or your local `main`. So you don't need to pull first, and commits you haven't pushed are kept.
> Your own `main`, its files and your index aren't touched.
>
> If your `main` and `origin/main` each have commits the other lacks, the run is refused before
> anything is made, and the refusal names both commits. Pull or rebase, or push, then ask again.
> If the fetch fails, because you're offline for instance, the run starts from the `origin/main`
> you last fetched, and a warning prints where you started Shift Manager.
>
> Review the work in that worktree, or from your checkout with
> `git log -p <branch> --not main origin/main`. That shows only the run's commits, whichever of
> the two it started from. The branch stays checked out in its worktree, so git won't check it
> out a second time in yours.
>
> Only those two projects get a worktree of your checkout. Apart from that fetch, the Lab reaches
> no git remote, so a coding run on a project you add yourself, even one on this repository, is
> refused, naming the repository, and nothing is cloned.

## UPDATE · `packages/shift-manager/README.md` · "Working on Shift Manager itself", the same two paragraphs

The same four paragraphs as above, with the chief of staff unlinked, as the README has it today.

## UPDATE · `apps/docs/docs/workforce/projects.md` · the local-checkout section, the paragraph that starts "Each run's place has the worktree"

> Each run's place has the worktree in `checkout/` and the
> [project's files](#the-projects-own-files) in `project/` beside it, as for any other
> repository. The branch is cut from `baseRef`, or from whatever your checkout has checked out
> when `baseRef` is left out.
>
> Before the server cuts a new branch, it fetches that base's upstream, the remote branch it
> tracks, such as `origin/main`. Then it starts from whichever is newer: upstream when you
> haven't pulled, your own branch when it has commits you haven't pushed. Only the
> remote-tracking copy is updated. The server never switches, resets or cleans your working
> tree, and never moves your branch.
>
> A few cases go differently:
>
> - **Your branch and its upstream have each moved.** The run is refused with `base-diverged`,
>   naming both commits, and nothing is made. Pull or rebase, or push, and the next run starts.
> - **The fetch fails**, because you're offline, a credential is refused, or it times out. The run
>   starts from the copy you last fetched, and the server logs a warning naming the checkout and
>   git's error.
> - **The base has no upstream**, such as a tag, a commit, or a branch that tracks nothing. It is
>   used as it is, with no fetch.
> - **The run already has its branch**, on a retry or a later turn. It's handed back as it was,
>   and nothing is fetched.
>
> Listing the checkout is what allows the fetch, so the upstream doesn't need to be in
> `remotes.allow`. That list still decides which remotes the host clones. The upstream's URL is
> checked before git sees it: one that uses a transport helper such as `ext::`, starts with `-`,
> or uses a scheme other than `https`, `ssh` or `file` isn't fetched, and the server logs why.

## UPDATE · `apps/docs/docs/workforce/projects.md` · the paragraph that starts "To review a run"

Replace its first sentence with:

> To review a run, open its worktree, or run `git log -p <branch> --not main origin/main` from
> your checkout. That shows only the run's commits, whether it started from your `main` or from
> `origin/main`. `git diff main...<branch>` would also show upstream commits your `main` doesn't
> have yet.

The rest of the paragraph stays.

## UPDATE · `packages/workspace/README.md` · "A repository on this machine", the paragraph that starts "The run's branch is cut from"

> The run's branch is cut from `baseRef` (or `HEAD`) and stays in that repository. For a new
> branch whose base tracks an upstream, the host first fetches that one upstream branch, which
> updates only its remote-tracking ref, then cuts from whichever of the two is newer. Listing
> the repository allows the fetch; `remotes.allow` isn't asked. The URL is still checked as any
> remote is, with an absolute path read as `file://`. When local and upstream have each moved,
> the provision is refused as `base-diverged` before anything is made. A failed fetch isn't a
> refusal: the host compares with the last-fetched copy and logs a warning. A base with no
> upstream fetches nothing, and neither does a branch that already exists. `place.repo.baseCommit`
> is the commit the branch was cut at. The repository's own branches, index and working tree
> are never touched. When the source names no kept files, the place directory is the checkout
> itself, with no `checkout/` level. When it names kept files, the place is laid out like a
> remote run's: the worktree in `checkout/` and the kept files in `project/` beside it. Any bare
> path not on the list is still refused as `invalid-remote`, before git runs.

## UPDATE · `packages/workspace/README.md` · "Which remotes a host reaches", the refusal table and the line under it

Add a row after `remote-unreadable`:

> | `base-diverged` | A repository on this machine: the base and its upstream each have commits the other lacks. Nothing is made |

Replace the table's last sentence, "None of these clears on a retry, so fail the run with the
reason.", with:

> None of these clears on a retry by itself, so fail the run with the reason. `base-diverged`
> clears once someone pulls or rebases, or pushes, in that repository.

## CREATE · `.changeset/local-checkout-starts-from-upstream.md`

```md
---
"@flow-state-dev/workspace": minor
"@flow-state-dev/harness-manager": patch
---

A repository listed in `localRepositories` now fetches the base's upstream before it cuts a new run's branch, and cuts from whichever of local and upstream is newer. A base whose local and upstream copies have each moved is refused as `base-diverged`; a failed fetch falls back to the last-fetched copy with a warning. `place.repo.baseCommit` is now set for these repositories, and `readRunCommits` also leaves out the base's upstream (FIX-1927).
```

## Publication ownership

This issue publishes all of it. The `fsd` profile's own config needs no change, and no doc
about the default projects moves (that is FIX-1904's).
