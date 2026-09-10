---
"@flow-state-dev/fsdev": patch
---

`fsdev run --format text` prints readable progress — streamed assistant text, one line per tool call, status, or tool failure, and a final `✓ flow completed` / `✗ flow failed` line — instead of NDJSON, written as events arrive so a long run shows activity while it is still running (FIX-1340). The default stays `ndjson`, and `--capture` still writes the full structured events and result whichever format is displayed.
