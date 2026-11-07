---
"@flow-state-dev/harness-manager": patch
---

`readSessionPullRequests(client, runSessionId)`, from the package root and from `./browser`, reads the pull requests a run session records, every request's, with each one's `number`, `url`, `title` and `state`, plus the `host` and `repository` that `pullRequestWait(row, records)` matches by. With it, a screen can draw a waiting task's line, *PR open · #7*, linked, without its own read of the record. A session that records none reads as none. A read that fails throws the client's error.

Docs: packages/harness-manager/README.md (the `./browser` list: `readSessionPullRequests` beside `pullRequestWait`).
