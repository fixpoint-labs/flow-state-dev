---
"@flow-state-dev/workforce": minor
---

Workers on the built-in `agent` flow and the `coordinator` flow are told today's date, and a worker that holds a skill is shown its skills and told to load one that fits (FIX-2498).

- **New default:** after its own prompt, every worker gets a `date` block: today's date with its weekday, read from the server's clock each turn, and the server's time zone named.
- **Changed default:** a worker that holds a skill it can load now gets the skill loader and the list of its skills, with one line telling it to load a fitting skill before it answers, with no setting. `skills.activateTool` no longer defaults to `false`: unset, it follows the worker's `defaults`. A value a worker sets still wins, so `activateTool: false` keeps the old behaviour. A worker that holds no skill is unchanged.
- **New contract key `defaults`:** `defaults: false` turns both sections off (the prompt as it was); `defaults: { date: false }` or `{ skillsIndex: false }` turns off one. A worker flow that composes `workerConfigSchema()` accepts it with no change. One that hand-declares the contract's keys must declare `defaults` too, or it is refused at boot naming the key.
- **New export `workerDate`:** the same date block, for a generator that isn't a worker: `context: { date: workerDate }`. An app adds its own line to a worker's date block by writing under the `date` context key from a capability it composes.

Docs: packages/workforce/README.md (the `defaults` contract row, the skill loader control, "What every worker is told", the `workerDate` export).
