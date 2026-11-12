# Process: workers concept doc

## Reader 1

Questions: parts in order (purpose, owner, storage); an edited `researcher` after a deploy; Bob naming Alice's `writer`; standard `launch` naming own `writer`; two tabs racing; authored `workerId`; a flow with no `respond`; hiring `eng.coder`; undefined terms; contradictions.

Got wrong or flagged:
- The cast broke its own rule. Standard `launch` listed Alice's own `writer`.
- `all` seemed to contradict "standard names only standard".
- An edited standard worker looked both standard and own.
- Session id inputs were inconsistent (worker missing).
- "Coordinator" read as both flow and role.
- Undefined terms: org, scope, installation, board, turn, capability, skills and packages, readiness view, topic, checkout.

Changed: `launch`'s file lists researcher and eng.coder, and Alice adds `writer` in her session. Added an "edited standard worker" case and a rule 1 rewrite. The session id now names the worker and the race resolution. Clarified the role/worker double use. Added nine vocabulary rows. Removed "topic" and "checkout".

## Reader 2 (new reader, new edge questions)

Questions: Alice fires or re-hires `researcher`; shared versus separate sessions on one flow; `all` scope; missing door; where own workers live and whether Bob's roster includes them.

All scenario answers correct. Remaining flags:
- The trace asserted that a delegate resolves to Alice's edited copy, which I haven't confirmed in code. It now says "should", pointing at Decisions.
- `agent`'s roles were unstated. I read `agent-worker-flow.ts` and the coordinator flow, and the doc now says it.
- A flow never registered as a worker flow was unaddressed. Now stated.
- Session storage and delegate-list storage were missing. Added.

I did not run a third reader. The remaining flags are code names that appear only in the gap table, and the deliberate open item.

## Bar check against the example

- Each stored part now says owner, visibility, storage and count: worker, roster, session, delegate list, task row.
- Has a "what this replaces" with costs, naming debates, rules, a vocabulary with a counted retired table, decisions with recommendations, and a gap table with paths.
- One cast runs through the figure, the examples and the trace.
- Thinner than the example: no migration table. `WORKER.md` keys don't change under the kit, so none applies.
- The example dropped its model's open question about how many flows. Mine keeps three open decisions, each with a recommendation.
- The mermaid figure was not rendered (no renderer here). The SVG was rendered and checked.
- A reader still can't see which of today's gaps are built. The gap table carries that.
- Cold reads ran with `--tools ""`, from the sandbox directory. Shell restrictions blocked `/tmp` for the input files, but the reader had no repo access.
