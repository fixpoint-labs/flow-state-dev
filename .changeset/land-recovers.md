---
"@flow-state-dev/harness-manager": patch
"@flow-state-dev/workspace": patch
---

Open a PR and Merge locally on a coding run's review now find their way past a failure instead of giving up after one (FIX-2658).

- **workspace:** `land` lands the branch the run's checkout is on when the run's own branch is gone (the run renamed it, or moved its work to a branch it named), provided it holds commits over the new `LandTarget.baseCommit`; `Landed.branch` names the branch landed. A pull request already open from the branch is the landing, and no second one is opened. A push refused then is let go only when the remote branch already holds the checkout's tip; otherwise it is `push-failed`. A gone branch with nothing to land is refused as `branch-gone`.
- **harness-manager:** a landing that fails is handed to the run's coding session as one more step, with the exact error and the person's note, and tried again when that step stops, without asking the person. New option `landAttempts` (default 3) caps the tries; `1` asks the person after every failure, as before. Failures no run can fix (no remote, no GitHub repository, a repointed remote, an unknown base, a host that can't land) go straight back to the person. An accept takes optional `words`. The review's data carries `landAttempts`, every try with its error, which `reviewDetail` reads.

Docs: packages/harness-manager/README.md (`landAttempts`, the hand-off to the coding session, `words` on an accept), packages/workspace/README.md (`land` and a moved branch, an open pull request, `baseCommit`, `branch-gone`)
