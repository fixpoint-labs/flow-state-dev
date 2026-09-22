---
"@flow-state-dev/workforce": patch
---

The hired roster and a channel board's ledger can now be read by a browser, so a UI can draw them without an action in between. Both are organization-scoped, so a read returns only the reading session's own organization's rows. Each publishes an explicit allowlist rather than the stored row: a roster row crosses as its seat id, flow kind and instructions, withholding the settings bag, and a board row crosses as `CHANNEL_BOARD_CLIENT_FIELDS`, withholding the claim, lease, retry ledger, write log and the task's own payloads (FIX-1477).
