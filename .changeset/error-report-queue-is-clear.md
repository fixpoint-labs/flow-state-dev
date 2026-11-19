---
"@flow-state-dev/workforce": minor
"@flow-state-dev/shift-manager": minor
---

The Error Reporter says plainly where a report is, and the operator can open it in one click; no reply names a report by its fingerprint (FIX-2791).

- **workforce (breaking for a reader of the tool's answer):** `reportProblem` no longer answers `{ decision, reportId }`. It answers the report's `status` in words (`drafting`, `waiting in Inbox`, `filed`, …). A new report adds `waitsIn` and a `note`; for the operator, a report that already exists adds its `title`, its `inbox` link while it waits and its `issue` once filed. Anyone else gets the status alone (`waiting in the operator's Inbox`).
- **workforce:** a new reporter option, `inboxLink: ({ sessionId }) => string`, builds the link to a report's Inbox item from the report's own session (`error-report~<id>`). When a report starts waiting in Inbox, the reporter's conversation gets a line with its title, where it came from, how often it was seen and, for the operator, that link. A Lab with no `inboxLink` gets the words with no link; a report the Lab files without asking (`preview.autoFile`) gets no line.
- **workforce:** an `error-history` record gains `inbox`: the operator's link to the report's Inbox item while it waits, as a Markdown link; `null` for anyone else and once it stops waiting.
- **workforce:** the preview's ask says where the report came from and how often it was seen (`From a failed task (Tidy checkout) · seen 3 times. File it?`), and its `data` carries `source`. A *Filed* line for a report with no draft names its error's first line, never its id.
- **shift-manager:** `/inbox/<sessionId>` opens the ask no task holds that waits in that session, found only among the user's own Inbox items; any other id opens nothing, as an unknown one does. The devteam Lab sets `inboxLink` to `./inbox/<sessionId>`, relative to the page's base, and chat resolves a relative link against the page's base (`<base href>`) rather than the origin's root, so the link opens under a proxy's sub-route too.
- **shift-manager:** Inbox groups every ask no task holds under the worker that raised it, with a count (`error-reporter · 3 waiting`), each showing its heading and, when it differs, its message's first line. A task's item stands on its own.

Docs: apps/docs/docs/workforce/error-reporter.md ("From failure to filed issue": what the reporter says at each step; "Options": `inboxLink`), packages/workforce/README.md (the reporter's options), Shift Manager's Inbox grouping in its release notes.
