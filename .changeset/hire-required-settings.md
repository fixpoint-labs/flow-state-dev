---
"@flow-state-dev/workforce": patch
---

The `hire` tool's description and `settings` field now tell a model that a kind may require settings, and a hire the kind's settings schema refuses now says nothing was written and to call `hire` again with the setting (FIX-1758).
