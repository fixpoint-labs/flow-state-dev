---
---

FIX-653: Adopt Changesets workflow. No publishable package source changes — this PR replaces the per-PR root `changelog.md` edit with `.changeset/*.md` fragments, ports the historical log into per-package `CHANGELOG.md` files, and deletes the root file. See `docs/contributing/release-notes-workflow.md` and BP-022.
