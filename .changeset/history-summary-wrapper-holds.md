---
"@flow-state-dev/core": patch
---

`utility.historySummary` keeps whatever its summary says inside the `<earlier-conversation>` section the model reads (FIX-2736).

- **core:** an `<earlier-conversation>` or `</earlier-conversation>` tag inside the stored summary, in any letter case or spacing, is escaped (`&lt;`) when the section is built, so a summary written from user text can no longer close the section early and have the text after it read as outside the summary. A summary without such a tag reads exactly as before.
- **core:** a summary is capped at 8,000 characters, when it is stored and when it is read. A longer one keeps its start and ends with `[earlier summary truncated]`.
