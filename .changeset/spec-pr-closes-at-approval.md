---
---

Internal (process/skills): a spec PR now closes when the spec is **approved** rather than when implementation starts, its Linear document is reconciled from the branch head before the close, and **the spec branch is no longer deleted** — `spec/<ISSUE-ID>` is retained as a frozen record, matching the epic branch's long-standing rule. A POC worth building after sign-off **re-opens that same PR** on the retained branch instead of opening a second one; a spec PR is still never merged, and a re-open never re-opens the approval gate. Canonical in `docs/contributing/orchestration.md` → "Closing the spec PR"; propagated to BP-037, `issue-lifecycle`, `issue-worker`, `issue-implement`, `issue-spec`, `spec-poc`, and the spec/spec-poc READMEs.
