# FIX-2259 · Decisions

[Spec](SPEC.md) · **Decisions**

Jake's report decided the direction: the plan belongs to the conversation, a later turn
continues it, and only the harness starts a new one. That reverses FIX-1915 BR-15 and BR-17 for
the plan. What is left is engineering, so this spec carries no decision card.

## Decided, not asked

- **The writer keys the plan by conversation; the reader doesn't merge turns.** Both writers
  already hold the conversation id when they write a plan row: Claude Code from the session id
  its `init` message confirms (the recorder is built before that, so it resolves the plan
  namespace on first plan write, not at construction), Cursor from `agent.agentId` once
  `create` or `resume` returns (its plan writer is opened before that today, and moves after). Keyed that way, Claude Code's item-by-item upserts merge into
  one row per task id, so a later `TaskUpdate` keeps the title its `TaskCreate` wrote, and
  Cursor's `replacePlanList` replaces the conversation's list rather than a turn's.
- **The namespace names the harness and the conversation**, escaped with `planKeySegment`, and
  can't be read as a request id (a leading segment no request id takes). Two conversations,
  including two harnesses in one session, never share rows. A tool that calls the harness twice
  in one request into two conversations gets two plans, as today; into the same conversation,
  one plan, which is the point.
- **A new conversation starts with no plan.** A refused resume confirms a new id, so its rows
  go to a new namespace; the panel follows `binding.confirmed`, so it never shows the lost
  conversation's plan as the current one.
- **The turn label names the turn that last changed the plan.** Rows and markers gain a
  nullable `requestId` (BP-023), added to each collection's `expose` list; the panel maps it to a turn number with the session's turn
  records. A turn that wrote nothing leaves the label alone.
- **One writer per conversation.** `replacePlanList` reads the previous count from the
  marker, so it needs one writer per namespace. A Kitchen Sink session queues its turns
  (`concurrency: "queue"`), and a harness conversation runs one turn at a time, so this holds.
  The implementer checks harness-manager's follow-ups keep it too.
- **A Claude Code marker that went `incomplete` stays incomplete** until a later write of
  the same row succeeds and clears it, or the conversation ends: a lost row may still be
  missing from the plan, and the panel should keep saying so.
- **Legacy rows still read (BP-030); a conversation that straddles the upgrade is not
  migrated.** A session with no conversation-keyed plan, and rows under the per-turn keys,
  shows the latest turn's rows as today. Shift Manager does the same for a run whose rows were
  written per turn. A conversation begun before the change and continued after it starts its
  conversation plan from the first write after the upgrade: for Claude Code that can be one
  untitled row until the agent touches the rest, for Cursor its next full list. We accept that
  once, rather than hydrate: hydrating means listing the session's per-turn rows and merging them
  by harness rules, the reader merge this spec drops. The panel says the plan may be incomplete
  for such a conversation (its earliest turn predates the conversation plan), so it never passes
  the partial plan off as whole.
- **Each run leaves a pointer to its conversation.** Under the run's own namespace
  (`harnessRunNamespace`), the writer stores a marker whose `conversation` field names the
  conversation namespace it wrote the plan to. Shift Manager already reads a run by its request
  prefix, so it reads that pointer and then the conversation's plan, with no listing. It can't
  use harness-manager's run record: that is not client-readable by design and is keyed by
  epic, issue and phase (`run-record.ts`). A follow-up runs in its task's session
  (`per-task` session key, `dispatch.ts`), so the conversation's rows are in the session the
  inspector reads. `readRecordedWork`'s key parsing changes with the shape.
- **File operations and gap rows keep `harnessRunNamespace`.** They answer "what did this run
  do", which is per run.

## Considered and dropped

- **Show the last turn that recorded a plan** (reader only). It fixes Cursor and leaves Claude
  Code showing turn 2's one untitled row, because Claude Code reports its list item by item.
- **Merge turns in the reader.** Group a session's turns by their confirmed conversation and
  merge rows across them: per-item by `lastTouchedAt` for Claude Code, latest complete list for
  Cursor. Every reader would hold harness rules, and each read would list the whole session's
  plan history to discard most of it (BP-033).
- **Copy the plan forward at the start of each turn.** It lists the previous turn's prefix
  (which the lazy collection avoids by design) and doubles every row per turn.
- **Put it in FIX-2092's session phase list.** That list is the flow's phases, written by the
  flow. The agent's to-do list is the harness's, recorded from what it confirmed. FIX-2070 and
  FIX-2071 come first, so this does not wait for it either.

## Open

None.

## Settled

- **A resumed Claude Code session keeps its task list and its ids.** 2026-10-27, on the
  `claude` CLI in a clean session: turn 1 created `alpha step`, `beta step`, `gamma step` and
  completed the first; `--resume <session>` then ran `TaskList`, which returned `1 alpha step
  completed`, `2 beta step pending`, `3 gamma step pending` under the same session id. So the
  agent keeps the plan and task ids continue, which is what keying by conversation relies on.
  The SDK path is the goal leg's to show (`p2:matches`).
- The rest is a read of `main` at `a80b20e`: `harnessRunNamespace` and `replacePlanList`
  (`core/src/types/harness-plan.ts`), the recorder's `runId` (`claude-code/src/sdk/agent.ts`,
  `work-recorder.ts`), `openPlanWriter` (`cursor/src/agent.ts`), `planPanelState`
  (`kitchen-sink/lib/harness-turn.ts`) and `readRecordedWork` (`shift-manager/src/lib/run.ts`).

## Notes for the implementer

- Cursor's `updateTodos` result is its whole list, so a turn with no update leaves the
  conversation's list as it was. If a later Cursor run shows the result can be partial, stop and
  re-gate.
- Claude Code's `previousStatus` derivation uses a per-recorder map; across turns, the stored
  row's status is the prior one. Prefer the harness's own `from`, as today.
- The goal legs' existing **p** checks read "this turn"; update their wording with the panel's.

## Notes from review

- **Architect, coherence check on `92099bb`** (non-blocking): "Key the plan's conversation
  namespace off that same confirmed agent id, not a second derivation, so local and cloud runs
  of one conversation land in one plan. The spec doesn't say whether a cloud run reports
  `updateTodos` the same way. If it doesn't, the panel should say the plan may be incomplete
  rather than quietly showing a stale list." And: FIX-2254's live steer runs inside the turn, so
  it keeps the one-writer assumption; check FIX-2257 (harness manager's cloud half) against it.

- **Cursor review on `b39f040`** (comment, non-blocking): (1) say why the inspector can't
  resolve the conversation from session turn records alone (Shift Manager has no turn ledger on
  its client path, and a quiet run confirms nothing to record), so the dropped reader merge isn't
  rebuilt; (2) the label may need only the rows' `requestId`, so the marker's may be dropped
  from the schema and `expose`; (3) one shared core helper for "conversation prefix, else the
  per-turn prefix", so Kitchen Sink and Shift Manager don't fork the legacy read; (4) list the
  new fields per collection (row `requestId`; run marker `conversation`) where the diff sits;
  (5) the panel lists without a limit and the route's default is 50, which a long conversation
  can pass.

## How it got here

- Same day, an independent review against `main`, folded: Shift Manager can't reach the
  harness's session id (the run record is server-only), so each run now leaves a pointer to its
  conversation under its own namespace; Cursor's plan writer opens after the agent id exists;
  follow-ups confirmed to run in their task's session.
- 2026-10-27, initial draft, after Jake's report (relayed) and a read of `main` that found the
  record keyed per turn by FIX-1915's design. Linear Manager's FIX-2259 is kept; FIX-2258,
  filed the same hour, is its duplicate.
