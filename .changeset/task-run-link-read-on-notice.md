---
"@flow-state-dev/shift-manager": patch
---

A task's Session shows its run as soon as the board links it, from any session, instead of checking the board every 2 seconds for up to a minute (FIX-2466). It no longer stops waiting after a minute and offers Retry for a slow link: it waits until the board hands the task to a run. A task the board doesn't hold (a stale link, a deleted task) is still called missing, after about 10 seconds, with Retry. On a host whose bus can miss a change (the SQLite store's), it still checks every 2 seconds. A board read that fails still stops the wait and shows Retry.

Docs: packages/shift-manager/README.md (*A task*: the run shows when the board links it, not by checking every 2 seconds).
