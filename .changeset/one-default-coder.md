---
"@flow-state-dev/harness-manager": minor
"@flow-state-dev/workforce": minor
---

The harness kit names its default coder in the coordinator's context, and workforce can retire a worker setting (FIX-2877).

- **The default coder in context.** When the kit has a `defaultHarness`, the readiness rows it puts in a coordinator's context are followed by a line naming the default coder, by its label. The coordinator starts coding work on the coding worker that runs on it unless the user names another. `harnessReadinessCapability(readiness, defaultHarness?)` takes the default as a second argument. With no default, there is no line.
- **Workforce: `retiredSettings`.** A worker flow registration (`workerFlow(build, { retiredSettings })` or the `{ flow, retiredSettings }` entry) and the kit's `agent` config can retire a setting. A worker stored with that setting is read without it and keeps running. A hire or an edit that names it is refused by name, and nothing is written. An edit of such a worker drops the setting from what is stored.

Docs: packages/harness-manager/README.md (the readiness capability's second argument) and packages/workforce/README.md (`retiredSettings`)
