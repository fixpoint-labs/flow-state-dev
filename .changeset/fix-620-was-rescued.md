---
"@flow-state-dev/core": minor
"@flow-state-dev/server": patch
"@flow-state-dev/patterns": patch
---

Add `ctx.wasRescued(name | block)`: a downstream block can now ask whether a prior block in the current sequencer scope threw and was recovered by a `.rescue()` handler, without the recovered value having to carry a marker. Resolution mirrors `getBlockResult` — prior siblings only, most-recent match under loops — and it returns `false` for a clean run, a skipped or unknown block, or a call outside a sequencer, and never throws. `routedSpecialists` now uses it to detect a rescued specialist dispatch instead of threading a sentinel value through the pipeline.
