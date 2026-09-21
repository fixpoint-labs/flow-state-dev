---
"@flow-state-dev/orchestration": minor
"@flow-state-dev/workforce": minor
---

Skills, seats and channels now answer the agent discovery door, and a seat can narrow what it sees (FIX-817).

`skillsManifestSource()` (orchestration) projects the skills catalog into the door, filtered to exactly what `loadSkill` accepts. The ambient catalog listing in the prompt moves behind a `catalogContext` preset that ships **on**, so an existing app's first turn is unchanged; pass `catalogContext: false` in the same `.with({ ... })` call to take it out.

`createWorkforceCapability({ roster, inventory, sources? })` (workforce) installs the seat and channel sources and contributes the `discover` tool. A worker file's new `discover:` key narrows which domains that seat sees, and can never widen past what the app installed.

**Breaking:** `createWorkforceCapability`'s `agents` option is removed — passing it is now a type error naming the replacement. Pass the declared roster and the inventory collection keys instead.
