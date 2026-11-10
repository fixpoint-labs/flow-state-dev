---
"@flow-state-dev/harness-manager": patch
---

With `awaitPullRequests` on, a goal judge's confident `not-done` no longer fails a run that opened a pull request (FIX-2579). The task waits on its pull request as any other run that opened one does, and the judge's reason is said in a status note. A run that opened no pull request still fails on a confident `not-done`, and with the option off nothing changes.

Docs: packages/harness-manager/README.md (the `awaitPullRequests` entry: a judge's `not-done` doesn't fail a run that opened a pull request).
