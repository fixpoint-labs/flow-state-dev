---
---

Docs (FIX-1014): give the durable-jobs surface a concept arc and cross-page routing.

Three different mechanisms were all documented as "background work" — sequencer
side chains, queue-backed action runs, and workstreams — each on a page written
in isolation, with nothing routing between them. A reader who declared a
detached worker on a task board had no path to the HTTP or client surface that
reads one, and `guides/board-lifecycle.md` answered "a board is not a background
job queue" without pointing anywhere.

New guide `guides/background-work.md` ("Work that outlives the turn") is the
map: what each mechanism outlives, when you'd reach for it, and which reference
page owns it.

Routing added on the pages that needed it: `orchestration/overview`,
`advanced/sequencer-side-chains`, `server/background-work`, `client/overview`,
`guides/board-lifecycle`, `guides/background-jobs-bullmq`. The guides sidebar's
"Background jobs" category becomes "Background work" and carries both guides.

Also registers `docs/tools/mcp.md` in the sidebar. It was written with a
`sidebar_position` but never listed, so it was reachable only by direct URL.

No published package changes.
