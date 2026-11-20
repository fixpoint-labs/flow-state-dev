---
"@flow-state-dev/workspace": patch
"@flow-state-dev/harness-manager": patch
---

Open a PR works when the branch a run was started from is gone from the remote, the normal state of a checkout after its own pull request merged and GitHub deleted the branch (FIX-2858).

- **workspace:** a pull-request landing asks the pinned remote whether the base branch is still there. When it is gone, the pull request goes into the remote's default branch, and the `Landed` result carries `baseGone` with the branch that was gone. `existingPullRequest` looks into the same base. When the remote names no default branch either, the landing is refused with a new reason, `base-gone`, before anything is pushed.
- **harness-manager:** a landing GitHub refuses (`pull-request-failed`, `pull-request-gone`, `base-gone`) is no longer handed to the coding session to fix. The person sees the failure on the review asked again, and only the landing opens the pull request. A refused push is still handed to the coding session, as before. The landed line says when the pull request went into the default branch instead.

Docs: none. No docs page or README documents a landing's base or its refusal reasons.
