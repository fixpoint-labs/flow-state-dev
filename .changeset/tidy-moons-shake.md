---
"@flow-state-dev/workforce": minor
---

Ship a built-in worker kind, so a worker file that names no `flow:` hires instead of being refused (FIX-1363).

`defineWorkerKind()` called with no arguments is that built-in; the same call with a tool catalog, skills or a default model builds the flow you register under `agent` to replace it for every seat. Its settings are `instructions`, `model`, `tools` and a switch for up-front skill matching (off by default). Tool names are resolved against the catalog your app supplies and refused at the hire, by name, when it carries no such key.

Two behaviour changes on `hireWorkforce`: `kinds` is now optional, and a record with no `flow:` resolves to the built-in rather than refusing. A `flow:` that is present but empty or whitespace-only still refuses — only an absent key means the default — and every other refusal stands unchanged, with the unknown-kind message now listing `agent` among the kinds available.
