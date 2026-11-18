---
"@flow-state-dev/shift-manager": patch
---

Shift Manager's text reads larger and sizes from one place (FIX-2783).

- The feed's messages and the composer are 16px on a 26px line, everywhere: a task's Session, the Shift Coordinator and a worker's conversation alike. Before, they were 14px except in the Shift Coordinator's summary and composer.
- No text in Shift Manager is below 12px: timestamps, counts, tags, labels and ids that were 9.5–11px are 12px. Lists, tables, buttons and the sidebar stay 14px.
- The sizes are Tailwind's text steps, given their values by the design system's `type.css`, which Shift Manager's stylesheet imports. Shift Manager no longer hard-codes a size.
- The registry components Shift Manager copies change the same way: `message` sets its body at `text-base`, and its meta at `text-xs` at the smallest. An app that installs them with `fsdev ui add` gets a 16px message body and nothing below 12px at Tailwind's default sizes.

Docs: none. No docs page states a size; `labs/design-system/README.md` (private) documents the type file.
