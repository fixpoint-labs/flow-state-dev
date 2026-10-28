---
"@flow-state-dev/cursor": patch
---

`@flow-state-dev/cursor` now runs against `@cursor/sdk` 1.0.40, and refuses any other version as before. Install `@cursor/sdk@1.0.40`. The SDK now lists zod as a peer (`^3.25 || ^4`), so this package needs zod 3.25 or later. The new SDK keeps a background subagent running after the tool call that launched it returns, so its result comes back to the run instead of being lost (FIX-2253).
