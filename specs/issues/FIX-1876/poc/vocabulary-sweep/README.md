# Vocabulary sweep (FIX-1876 POC)

**Moved.** The sweep and its rules now live at [`goals/vocabulary/one-word-per-thing/`](../../../../../goals/vocabulary/one-word-per-thing/goal.md), where they are the goal check and run, with `--control`, in CI's Process guards.

**Question it answered:** how big is the rename the epic's D3 asks for, and can a machine tell when it's done?

**Showed (2026-10-12, `main` at `da8f63fd7`):** 3,749 of 4,100 tracked files scanned, 351 excluded
by named rules, none unruled. 2,156 open lines in 289 files: 995 in the wait family, 1,156 in the
dispatch family, 7 stale `post-to-mailbox` mentions. The control failed as it should. After review
round 1 added keep entries for `abortHandoff` and the three internal wire values D2 keeps, the same
tree read 2,135 open lines in 288 files.
