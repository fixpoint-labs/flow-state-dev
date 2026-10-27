---
"@flow-state-dev/cursor": patch
---

`@flow-state-dev/cursor` now runs against `@cursor/sdk` 1.0.40, and refuses any other version as before. Install `@cursor/sdk@1.0.40`. The new SDK keeps a background subagent running after the tool call that launched it returns, so its result comes back to the run instead of being lost.
