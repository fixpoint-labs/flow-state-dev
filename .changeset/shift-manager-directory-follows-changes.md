---
"@flow-state-dev/shift-manager": patch
---

Shift Manager's directory screens follow changes made elsewhere (FIX-2775). Roster, the sidebar's TEAMS, PROJECTS and counts, Jump to, a project, Messages, Routines, Usage and Settings read the Lab's views and collections directly and stay current on their own: a hire, a new project, a paused routine or a new message from another tab or a worker's turn shows when its read hears it, not on the next whole-Lab read. A worker's on-shift status moves in the same update as the Inbox, so the two always agree. Lists show every row past 200, Retry and R read again what the screen shows, and a Lab that refuses Shift Manager or can't be reached gets the same page and words as before.

Docs: packages/shift-manager/README.md (the directory screens read live; R reads what the page holds again)
