---
"@flow-state-dev/workforce": patch
"@flow-state-dev/harness-manager": patch
---

A coding run's replies to review comments now go through one checked poster instead of `gh` in the run's shell (FIX-2831).

- **harness-manager:** `harnessManager({ replies })` (and the harness kit's `replies` config) takes a poster. Set, a run's brief names its reply folder, `<checkout>/.fsdev/replies/<attempt>-<run>/`, and the run writes one `.md` file per reply: the link to the comment on the first line, the reply after it. When the turn ends, after its push or landing, the manager reads the drafts and hands them to the poster; each ends as a line in the run's session, its reply's link or why it wasn't posted. A draft that is a link, resolves outside the checkout's `.fsdev/`, or is longer than 32 KB is refused unread. A turn that only answers on a merged or closed pull request posts nothing. New exports: `readReplyDrafts`, `replyFolderPath`, `REPLY_DIR`, `REPLY_MAX_BYTES`, `ReviewReplyPoster`. A prompt builder's run context has `replyFolder` when a poster is set.
- **workforce:** `operatorGitHub(…)` now also returns `reviewReplies`, the poster to hand the manager. It posts only in the operator's session, only on the task's own pull request or one the operator linked, only to a comment it reads from that pull request on GitHub, only when the author is a trusted reviewer (a listed bot, or a listed user who can push) or the operator linked the comment, with the body as a JSON field. An inline review comment gets GitHub's reply to that comment; a conversation comment or review summary gets a comment on the same pull request linking it. "The operator linked it" means a GitHub link in the message the user typed to start the filing turn (stamped on the task, `operatorLinks`, which a caller's metadata can't set), or in a steer that user sent the task.

Docs: apps/docs/docs/build/webhooks/github-reviews.md (a section on the coder's replies and what is refused), reference/workforce.md (`reviewReplies` beside `operatorGitHub`), reference/harness-runs.md (the reply folder beside the ask marker).
