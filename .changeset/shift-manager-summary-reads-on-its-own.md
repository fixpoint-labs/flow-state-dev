---
"@flow-state-dev/shift-manager": patch
---

Shift Manager's summary, Inbox, Tasks and sidebar counts change on their own when another session changes what they show: a delegate's ask, a task filed or moved, a project or worker added. A streamed reply doesn't trigger a read; its end does. Where the Lab can't push changes, Shift Manager reads every 30 seconds instead. The summary says when it was last read (*as of 14:02 · refresh*); *refresh* or `R` reads it now, and the counts dim until that read lands.
