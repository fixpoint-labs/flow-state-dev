---
---

Trading desk (FIX-1062): the memo header's "jump to transcript" control now works, and disappears when it can't.

Every analyst, researcher, trader, and risk memo header rendered a clickable
"jump to transcript →" button with no click handler — roughly 15 dead controls
per report. The scroll-to-event follow-on it was placeholding for was deferred
out of FIX-575 and never tracked.

The control now scrolls the transcript pane to the agent's first transcript
event and moves focus there. Below `lg` the transcript is a separate tab, so
the jump reveals it first — the request is owned by `app/page.tsx`, which is
the only component that can see both surfaces.

Whether a jump target exists is derived from the same pure item→row projection
the transcript pane renders from (new `components/transcript/transcript-rows.ts`,
extracted from `transcript-pane.tsx`). No target means no handler, and no
handler means the button is not rendered at all — so a re-opened historical
report, whose transcript items were never persisted, shows a clean header
rather than a control that silently does nothing.

Jumping also stops the transcript from auto-following a live run, so a reader
who navigates to an agent stays there while output keeps streaming in. Scrolling
back to the bottom resumes following, and a new run starts following again on
its own.

Internal lab app; no published package changes.
