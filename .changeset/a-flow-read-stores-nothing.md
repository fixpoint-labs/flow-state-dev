---
"@flow-state-dev/core": minor
"@flow-state-dev/engine": minor
"@flow-state-dev/client": minor
"@flow-state-dev/orchestration": minor
"@flow-state-dev/workforce": patch
---

A flow can declare `reads`: blocks an app runs on a session to look at something the flow computes, stored nowhere. The engine serves them at `POST /:flowKind/:sessionId/reads/:readName`, answering `200 { output }` with no request record and no concurrency slot; any write a read's block tries is refused with `read_only`, and another user's session answers 404 as the action route does. The client calls one with `flow(kind).read(name, input, { sessionId })`. Orchestration adds `taskToolReads(collectionId, resolve)`, the `listTasks_<suffix>` listing as a read, and Workforce's coordinator and agent-worker flows now serve `listTasks_tasks` as a read, so an app polling a conversation's task board no longer stores a request per poll. The action of the same name is unchanged (FIX-2286).
