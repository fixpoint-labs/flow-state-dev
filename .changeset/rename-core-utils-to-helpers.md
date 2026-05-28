---
"@flow-state-dev/core": minor
"@flow-state-dev/server": patch
---

Rename the `@flow-state-dev/core/utils` subpath export to `@flow-state-dev/core/helpers`. The directory `packages/core/src/utils/` held shared helper functions (`deepEqual`, `deepMerge`, `sanitizeToolName`, client-projection helpers, etc.) and sat next to the unrelated `utility/` directory of utility *blocks* (`summarizer`, `analyzer`, `intentClassifier`, …). The near-identical names were a navigation trap. Helper functions now live under `helpers/` and import as `@flow-state-dev/core/helpers`; the utility *blocks* are unchanged. Update any `import { … } from "@flow-state-dev/core/utils"` to `"@flow-state-dev/core/helpers"`.
