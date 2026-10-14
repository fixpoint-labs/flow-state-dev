---
"@flow-state-dev/shift-manager": patch
---

Shift Manager's sidebar nests each project's workstreams beneath it again. The project on screen shows them, the arrow beside any project shows or hides them, and a click opens the workstream's own view. A workstream opened elsewhere appears without a reload. Only a shown project's workstreams are read, by that project's one prefix (FIX-1961).
