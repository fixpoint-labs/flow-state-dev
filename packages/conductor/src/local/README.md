# local

A second implementation of the [observer seam](../observe), reading a real git checkout
and the files beside it instead of GitHub. It exists so the process can run end to end —
spec, review, approval, implementation, merge, goal check, and the kill-mid-gate restart
the derived-gate design is built to survive — without burning real issues and real pull
requests on a repository.

**This is not a fake.** The replay harness in [`../testing`](../testing) is one, and says
so: it is handed a world per step. Nothing here is handed an answer. A branch is a real
branch with real commits, merged is real ancestry, mergeability is a real trial merge, and
an empty review inbox means nobody has reviewed the work.

| File | What it owns |
|---|---|
| `git.ts` | one real git command per world fact |
| `store.ts` | the local review record on disk — submissions, verdicts, comments, check results |
| `read-world.ts` | git + files → `World`, driven by the facts the phase's gates declare |
| `observe.ts` | the read path, stated as an `Observer` |

Git already answers most of what a gate asks: a head is `rev-parse`, merged is ancestry, a
guidance hash is `hash-object`. What git does not hold lives under the checkout as files a
human writes in an editor and the next observation picks up.

```
.conductor/local/
  submissions/1/submission.json       { number, branch, base, openedAt }
  submissions/1/reviews/alice.json    a human's verdict
  submissions/1/comments/alice.1.md   free prose
  submissions/1/reviewed-heads.json   the head conductor resolved each review against
  checks/<sha>.json                   what a real check run concluded
```

There is a write path, small and deliberate: opening a submission claims its number from
what is already on disk, the way GitHub assigns a PR number when you open a pull request,
a real check run records its conclusion, and an observation notes which head it resolved
each undated review against. Reading never mints identity. Conductor never writes into
`reviews/` or `comments/`, which is why every entry there can be treated as a human's
without an identity check — `reviewed-heads.json` sits beside the inbox, not in it.

That last file is what keeps an approval honest. A review's timestamp and git's commit
times are both second-precision, so `rev-list --before=<second>` cannot tell a review from
a commit pushed later inside the same second. Re-derived every poll, the answer moves: the
approval follows the branch onto a head nobody read, and never goes stale. Resolved once
and written down, it stays on the commit the reviewer was looking at. Re-saving a verdict
still resolves fresh, because a saved verdict is a new review with a new id.

The middle of the tick is shared with GitHub — the same `reconcile`, the same `World`, the
same gate predicates — so neither source gets to decide on its own what a merged branch or
a new review *means*.
