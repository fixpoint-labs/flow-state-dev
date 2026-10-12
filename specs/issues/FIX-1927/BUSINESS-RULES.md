# FIX-1927 · Business rules

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md) · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

The cases, written as rules. Every row is about a **new** branch cut in a repository the host
lists in `localRepositories`. "Local" is the base as the repository has it; "upstream" is its
remote-tracking copy after the fetch, or as last fetched. The *proved by* column is the check
the plan runs.

## Where a new run starts

| # | When | Then | Proved by |
|---|---|---|---|
| BR-1 | Upstream has commits local lacks (behind) | The branch is cut at upstream's commit. Local's ref, index and working tree are unchanged | CI · `starts-from-upstream`, `local-base-unmoved` |
| BR-2 | Local has commits upstream lacks (ahead) | Cut from local, as today | CI |
| BR-3 | Local and upstream are the same commit | Cut from local, as today | CI |
| BR-4 | Each has commits the other lacks (split) | Refused, `WorkspaceRefusedError` reason `base-diverged`, naming the checkout, the base and both commits, and saying to pull or rebase, or push. No worktree, branch or marker is left | CI · `split-refused` |
| BR-5 | `baseRef` is omitted and `HEAD` is on a branch with an upstream | As BR-1 to BR-4 for that branch. The recorded `baseRef` stays `HEAD` | CI |
| BR-6 | The base has no upstream: a tag, a commit id, a detached `HEAD`, a branch with no tracking, a branch tracking another local branch, or a remote-tracking ref such as `origin/main` | Cut from the base as given, exactly as today. No fetch, and no git process reaches any remote | CI · existing suite unchanged |
| BR-7 | The base doesn't exist locally, even if upstream has it | Refused as today (`remote-unreadable`, naming the ref) | Existing suite |
| BR-8 | A branch is cut | `place.repo.baseRef` is the ref asked for; `place.repo.baseCommit` is the commit cut at | CI |

## The fetch

| # | When | Then | Proved by |
|---|---|---|---|
| BR-9 | A new branch's base has an upstream | Only that upstream branch is fetched, from its remote. Only its remote-tracking ref changes; no local branch, tag, index or file moves | CI · every local ref compared before and after |
| BR-10 | The upstream's URL fails the shape check: a leading `-`, a transport helper, whitespace, a credential, or a scheme other than `https`, `ssh` or `file` | Not fetched; no git process is given the URL. The comparison uses the last-fetched copy, and a warning names the redacted URL | CI · a planted `ext::` URL |
| BR-11 | The fetch fails: offline, a credential refused, a ref lock held, a timeout | Not a refusal. The comparison uses the last-fetched copy; `console.warn` names the checkout, the upstream and git's error | CI · an upstream path removed after the clone |
| BR-12 | The fetch fails and no copy was ever fetched | Cut from local, as today, with the same warning | CI |
| BR-13 | The remote wants a password | It fails at once (no terminal prompt), then BR-11 | CI by construction (the host's git environment) |
| BR-14 | The fetch hangs | It times out inside a bounded slice of the provision budget, then BR-11. The provision still finishes inside its budget | CI · fake clock |
| BR-15 | The host's `remotes.allow` is empty or doesn't name the upstream's host | The fetch still runs: listing the checkout admits its own upstream ([D3](DECISIONS.md#d3)) | CI · host built with `allow: []` |
| BR-16 | A run's project isn't mapped and its remote isn't allowed | Refused by `remotes.allow` before any git process, as today. Nothing is fetched | Existing suite |

## What is never fetched or moved

| # | When | Then | Proved by |
|---|---|---|---|
| BR-17 | The run's branch already exists: a retry, a continuation, or a worktree re-added after `git worktree remove` | Handed back. No fetch, no comparison, no move | CI · git commands counted |
| BR-18 | Two runs on one checkout are provisioned at once | Both start. A fetch that loses a ref lock to the other follows BR-11 | CI |

## Both entry points, and what the run reports

| # | When | Then | Proved by |
|---|---|---|---|
| BR-19 | harness-manager's `workspace: { sourceRepo, baseRef }` cuts a run | The same rules: it goes through the same host path | CI · one case through `provisionCheckout` |
| BR-20 | A run cut from upstream, ahead of local `main`, makes commits | `readRunCommits` reports only the run's commits, whatever the upstream's remote is called | CI · harness-manager |

## Failure taxonomy

One case is fatal: a split (BR-4), refused before anything is made, and clearing once the
person pulls or pushes. A missing base stays fatal, as today. Every fetch problem degrades to
the last-fetched copy with a warning, and never to a refusal. Nothing retries.

## Acceptance criteria this issue owns

[The goal](SPEC.md#the-goal-and-how-well-know-its-met): with a host built as the Lab builds it,
a run on a checkout whose upstream moved ahead starts from upstream with the person's `main`
untouched, and a split is refused with nothing made. Today's `main` must FAIL
`starts-from-upstream`.
