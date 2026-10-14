---
"@flow-state-dev/core": patch
"@flow-state-dev/shift-manager": patch
---

An `intent/<name>` model with no intent ladder and no default model now fails with a setup error that names the intent and where to set a model (`models.default`, `models.intents.<name>`, or `FSDEV_DEFAULT_MODEL`). The DevTeam and `fsd` Labs ship a default model (`openai/gpt-5.4-mini`), so a worker that names no `model:` answers instead of failing every turn (FIX-2008).
