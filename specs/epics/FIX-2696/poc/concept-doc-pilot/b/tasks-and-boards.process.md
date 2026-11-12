# tasks-and-boards: process

**Method.** Read the skill, exemplar, style docs, the kit specs and the orchestration code. Cold readers ran as `claude -p --tools ""` with doc and questions piped in, from a scratchpad directory (`/tmp/coldread-*` needed approval).

**Round 1** asked for parts with owner, store and count, a dead worker, a cancel cascade, a cross-user dependency, an unanswered question, a forged field. Gaps:
- "Three recoveries" against "a fourth lapse ends it" read as a contradiction. Reworded.
- The status of a task waiting on a question was missing. Added.
- Framework words were undefined (flow, session, scope, slot, harness, topic). Added a paragraph in Base terms.
- "Eight tools" was unclear. Dropped the count.

**Round 2** asked for a retry, partition id collisions, a judge on a delegation board, view permissions, the kit question, and what is unbuilt. Gaps:
- The status figure contradicted the three-recovery rule. Fixed the label.
- Vocabulary said "claim, lease: server-only" but the text said the deadline is visible. Fixed.
- "No" to a board kit against "open" in Decisions. Reworded.
- Leaked terms (recorder, tenant, stable id). Removed or defined.
- My own error, found while fixing a retry answer: I wrote that final statuses never change, but a person's retry reopens errored and cancelled tasks (`tasks/collection/internal.ts:466`). Fixed rule 1, parts 1, 2 and 7, and the figure.

**Round 3** asked for an unanswered question's stop, a cross-scope assignee, a late goal edit, a retry with a spent budget, how a screen learns of a change, and held versus hold. Gaps:
- Hold owner and count were missing. Added.
- "Held" listed as a form of hold confused the reader. Split the held status from the hold list.
- A late goal edit was unstated. Checked `field-rules.ts` and added it.

I stopped at three runs. Left over: "ticket" is used once undefined, and the half-built board view shows only in the gap table.

**Bar check.** Parts 1, 3, 4, 5 and 8 answer owner, visibility, storage and count. Parts 2, 6, 7, 9 and 10 store nothing of their own and point at the row. Part 11 has "what this replaces" with costs. Every other section of the shape is present, and the gap table cites files.

**Not done.** The mermaid figures follow the quoting rules but were not rendered; no renderer is installed.
