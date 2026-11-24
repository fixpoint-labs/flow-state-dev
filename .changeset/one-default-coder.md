---
"@flow-state-dev/harness-manager": minor
"@flow-state-dev/workforce": minor
---

The harness kit's `defaultHarness` now picks the coder a coordinator's coding task runs on (FIX-2877).

- **The server sets the coder.** With `defaultHarness` set, a coding task a model files from a user's conversation, or from any session no coding run opened, goes to the coding worker whose `harness:` is the default, else to one that names no harness. The worker the model named is ignored there, and so is any text naming a coder. With neither worker on the roster, the filing is refused (`no_default_coder`), saying why. A task a user files or re-files through the board's actions keeps the worker they chose, and a filing made inside a coding run keeps the model's. Without `defaultHarness`, nothing changes.
- **The default in context.** The readiness rows the kit puts in a coordinator's context now name the default coder under them, so the coordinator can say which coder took a task. `harnessReadinessCapability(readiness, defaultHarness?)` takes it as a second argument.
- **Workforce: `noPickAssignee`.** A worker flow registration (`workerFlow(build, { noPickAssignee })`, or the `{ flow, noPickAssignee }` entry) can name who takes a task a model files for one of its workers from outside the flow's work. The harness kit's `coder` flow uses it.
- **Workforce: `retiredSettings`.** A worker flow registration, and the kit's `agent` config, can retire a setting: a worker stored with it reads without it and keeps running, and a hire or an edit that names it is refused by name, with nothing written. An edit of such a worker drops it from what is stored.

Docs: packages/harness-manager/README.md (the harness kit's `defaultHarness`, and the readiness capability's new argument) and packages/workforce/README.md (the two registration options)
