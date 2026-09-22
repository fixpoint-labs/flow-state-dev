---
"@flow-state-dev/devtool": minor
---

The DevTool's Tasks tab now shows the note a task carries about itself in a `Reason` column, so a row parked for review says why without opening its JSON expander (FIX-1481). The column appears only on a board where something carries a note, and it is keyed on the note rather than on the `parked` status — a failed attempt heading for a retry writes one too, on a row that has gone back to `pending`. The per-row expander is unchanged and still the complete record.
