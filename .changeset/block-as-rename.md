---
"@flow-state-dev/core": minor
---

Add `block.as({ name?, description? })`: a copy of any block under a new name and/or description, for showing it to a model as a tool or registering it under a catalog key that must match its name. The copy's name is used everywhere, in tool calls, items, traces, errors and resume; the original block is unchanged. No wrapper is added at run time (FIX-1811).
