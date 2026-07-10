---
"@flow-state-dev/cli": minor
"@flow-state-dev/engine": patch
"@flow-state-dev/core": patch
"@flow-state-dev/skills": patch
---

Add `fsdev chat` — an interactive REPL over a flow-state project. Hold a multi-turn conversation with a flow whose replies stream live and whose history persists across turns, route free text to a default flow/action, and use built-in slash commands (`/help`, `/targets`, `/use`, `/status`, `/session`, `/exit`) to switch the driving flow and inspect the session. `createFlowState` gains a `chat.default` option to declare the default chat target, and `@flow-state-dev/core` now exports the shared `SLASH_COMMAND_PATTERN` slash-command grammar.
