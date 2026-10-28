---
"@flow-state-dev/codex": minor
---

A turn Codex reports as failed (`turn.failed`) now returns an `errored` handle with `outcome: "failed"` even when the Codex CLI then exits non-zero, instead of throwing. The run's one `error` item still carries the failure line and the CLI's output on `details.output`; the closing "Codex run errored" status is no longer emitted after an error item that already says why. A caller that caught the throw to detect a failed turn should read `handle.outcome` instead (FIX-1988).
