---
"@flow-state-dev/core": patch
---

A generator tool whose `mapModelOutput` throws is now recorded as a failed `tool_output` (code `MODEL_OUTPUT_MAP_FAILED`) and fails the run on resume and recovery too, instead of being stored as completed and replayed to the model as a success (FIX-1719).
