---
"@flow-state-dev/harness-manager": minor
---

The harness kit's `coder` flow takes an app's modes, tool approval, and the app's own worker settings, documents and actions (FIX-2877). An app that sets none of them runs as before: the same one mode, the same manager names, the same run keys.

- **`modes`.** A map from a name to `{ instructions, doneWhen, workspace?, requires? }`: how a run is told what to do, when it counts as done, where it works (absent: the kit's `workspace`), and the task-input fields a task in that mode needs (`"issue"`, `"project"`). `doneWhen` takes the full `{ check, timeoutMs?, validate? }` or a bare check function. Absent, the kit has its one mode, `default`. A `default` entry is completed from the kit's own, so `modes: { default: { instructions } }` keeps the kit's done check and workspace; any other entry needs `instructions` and `doneWhen`. The kit's `checks` wrap every mode. A mode other than `default` names its managers `coder-<harness>-<mode>`.
- **`defaultMode`.** The mode a task that names none runs. Default `default`. Until a task names its mode itself, a task carrying the `harnessFeature` marker runs the `implement` mode when the app registers one, and the default mode otherwise.
- **Refused at start, naming the mode:** a `defaultMode` that isn't registered (with the modes there are), a mode name that can't key a run, a mode other than `default` with no `instructions` or `doneWhen`, and a `requires` field a task doesn't carry.
- **`approveTools`.** Forwarded to every run's manager: a run asks the user before its tool calls.
- **`worker: { settings?, resources?, actions? }`.** The app's own part of the flow, which the flow carries and never reads: settings a worker's file may set beside `harness` and `review` (a schema shape by key), documents installed at flow level, and actions built on the installation (`(installation) => ({ … })`). A setting or action the flow already declares (`harness`, `review`, `respond`) is refused.
- `codingDrainBudgetMs` takes `modes` and waits for the longest done check of any mode.

Docs: packages/harness-manager/README.md (the kit's options)
