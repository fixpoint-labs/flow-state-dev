---
---

Internal only, no release (FIX-1159). The detection scripts a coding assistant runs before adding FSD to an existing project land in the private `plugins/flow-state-dev` workspace, which is distributed as a Claude Code plugin from git rather than published to npm. Verified against the diff: no file under `packages/` or `apps/` changes, so no published package needs a version bump.
