---
"@flow-state-dev/core": patch
---

`utility.historySummary` keeps everything its summary says inside the `<earlier-conversation>` section the model reads, even a summary that contains the section's own tags; a summary without them reads as before (FIX-2736, part of FIX-2490). A summary is now capped at 8,000 characters, and a longer one ends with `[earlier summary truncated]`.

Docs: apps/docs/docs/advanced/generator-context.md
