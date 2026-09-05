---
"@flow-state-dev/harness-manager": minor
---

New package: `@flow-state-dev/harness-manager` (LAB-154).

A task-board worker that turns a row into a supervised coding run — its own git
checkout, a verdict read before the row settles, a question it can ask a person
and be answered on, and the coding agent as a slot you fill:

```ts
harnessManager({
  boardCollectionId, boardCollection, tenant, phase, workspace, runTimeoutMs,
  harness: ({ cwd, resume, onSession }) =>
    claudeCodeAgent({ cwd, resume, onSession, detached: true, recordWork: true }),
});
```

The package imports no coding agent and reads no vendor field, so pointing the
same manager at a different harness is that one expression.
