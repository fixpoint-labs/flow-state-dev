---
"@flow-state-dev/workforce": minor
---

A worker file can now name which of its kind's capabilities that seat wants, and which of their presets (FIX-1388).

```md
---
description: Fields questions about how the desk is running this week.
capabilities:
  research: [briefing]
---
```

Read by the built-in `agent` kind. Selecting **adds** to what the kind installed; a seat that names nothing carries every installed capability's own defaults, exactly as before. The whole selection is validated when the roster is hired, so a typo is a refusal at boot rather than a failed turn — including a capability the kind does not carry, a preset the capability does not declare, a preset the app turned off at install, a preset on a capability with open config, and a preset whose surface has to exist before a request runs.

`SeatCapabilitySelection` is exported as the parsed shape of that key.
