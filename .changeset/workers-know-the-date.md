---
"@flow-state-dev/workforce": minor
---

Workers on the built-in `agent` flow and the `coordinator` flow are told today's date, and a worker that holds a skill is shown its skills and told to load one that fits (FIX-2498).

- **New default, the date block:** after its own prompt (identity, team, its file, its packages), every worker is shown a `date` block: today's date with its weekday and ISO date, read from the server's clock each turn, and the server's time zone named. It is the server's day, not the user's.
- **Changed default, the skills index:** a worker that holds a skill it can load now gets the skill loader and the list of its skills, plus one line telling it to load a skill that fits the request, even in part, before it answers. No setting is needed. `skills.activateTool` no longer defaults to `false`: unset, it follows the worker's `defaults`. A value the worker sets still wins: `activateTool: false` keeps the old behaviour, and `true` keeps the loader on even for a worker with no skill. A worker that holds no skill is unchanged and pays nothing.
- **New worker config key, `defaults`:** in a `WORKER.md`, `defaults: false` turns both sections off (the prompt as it was before), and `defaults: { date: false }` or `defaults: { skillsIndex: false }` turns off one. A section name the layer doesn't know is refused at hire. `defaults` is now part of the worker contract: a worker flow that composes `workerConfigSchema()` accepts it with no change, but one that hand-declares the contract's keys must add `defaults`, or it is refused at boot naming the key.
- **App lines in the date block:** an app adds a fact only it knows, such as the user's time zone, by writing under the `date` context key from a capability it composes, for example `defineAgentWorkerFlow({ uses: [defineCapability({ name: "user-time-zone", presets: { defaults: { context: () => ({ date: "The user's time zone: Europe/Berlin" }) } } })] })`. The line appears inside the worker's date block.
- **New export, `workerDate`:** the same date block for a generator that isn't a worker: `generator({ ..., context: { date: workerDate } })`.

Docs: create "What every worker is told" in apps/docs/docs/workforce/, right after workforce/built-in-worker in the Workforce sidebar. Update apps/docs/docs/workforce/built-in-worker.md ("What a worker is told first"; `activateTool` is no longer off by default) and packages/workforce/README.md (the skill loader, the `defaults` contract key, the `workerDate` export).
