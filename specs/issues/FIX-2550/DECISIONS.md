# FIX-2550 · Decisions

[Spec](SPEC.md) · **Decisions**

FIX-2370's decisions hold: one registry component with plain props and an `onRetry` callback
([its D1](../FIX-2370/DECISIONS.md#d1)), sharing `error.tsx`'s body ([its D2](../FIX-2370/DECISIONS.md#d2)).
The two below are what the labs' code had to add.

<a name="d1"></a>
## D1 · Retry is a new adapter verb

| | `adapter.retry(sessionId, requestId)` (chosen) | The screen calls the client | Retry through `send` with the old line |
|---|---|---|---|
| Keeps the lab rule "nothing in `src/` but the adapter touches a package" | yes | no | yes |
| Runs the same request again (same input, `retryOf` recorded) | yes | yes | no: a new turn with a copied line |
| The fakes can stand in for it | yes, one more verb | no | yes |

- **Instead of** the screen reaching the client: both labs route every package call through
  their adapter, and the screen tests run on a fake of it.
- **Instead of** re-sending the user's line: that is a new turn, not a retry, and loses the
  link the engine keeps between the two requests.
- **Locks in:** one more verb on each `LabAdapter`, and on each fake.

<a name="d2"></a>
## D2 · "Newest turn" is read from the thread's items

- The adapter marks a failed entry `retryable` when it is the newest turn, the request of the
  last entry the thread draws, and the engine will retry that request: one whose source is
  `http`, `mcp` or `scheduled` (the engine's public re-entry sources; a record with no source
  came in over `http`). The screen passes `onRetry` only for that entry, and only while no turn
  runs.
- **Instead of** reading the newest request alone: the thread's entries already order the
  turns, and a request that drew nothing (a board pass in Teammates) is not a turn the person
  saw. The session's recent requests are read only for their source.
- **Why the source rule:** the engine refuses a retry of a request a task or the flow itself
  started (`internal`, `task`). A worker answering another worker's message runs in its own
  conversation with source `internal`, so without the rule its failed turn would offer a
  Retry that can only fail. Each lab pins its list to the engine's in a test.
- **Who owns what:** `retryable` is the adapter's answer, and the only one; the screen never
  recomputes it. The screen's own rule is only "no Retry while a turn runs". The adapter's
  tests cover `retryable`; the screen's cover that `onRetry` follows it.
- **Not a bug:** Retry can show on the thread's newest turn while the session's newest request
  is a board pass. That is the intended reading, and the retry still succeeds.
- **Locks in:** Retry follows what the person sees as the last turn.

## Decided, not asked

- **E1 · Who the line names.** Claude Code-style: *The main session*, the words the lab already
  uses for it. Teammates: the worker's name.
- **E2 · Incomplete** is a small muted *Incomplete* under the half reply, in each lab's own entry
  markup. It is a mark on an existing entry, not a second failure line.
- **E3 · No startup key warning.** FIX-2370's slice text also asked each lab's host to log one
  when no model key is set. The failed-turn line now carries the provider's own reason at the
  moment it matters (the AI Gateway's says "set the AI_GATEWAY_API_KEY environment variable"),
  and FIX-2406 is moving the Claude Code-style host into `host.mts`. Left out to keep this one PR
  off that file. That gateway message arrives with terminal colour codes in its text, which
  every surface that shows an error would print; that is a package fix, filed on its own.
- **E4 · A task's own run** (the task view in Claude Code-style) shows its failure line too, with
  no Retry: a failed task is retried from its row, which already has the button.
- **E5 · Wording.** The line's words are the component's; neither lab adds copy that names a role.

## Notes from review

Round 1 (2026-11-04): Codex, no findings. Cursor (simplify): the one real point, that the spec
named two owners for "newest", is folded into D2 and the debt line. Recorded, not folded:
*failed* rather than FIX-2370's "error entry" is kept, since it matches the component's
`data-state="failed"` and the engine's request status, and Teammates' task `result.failed` is a
flag on another kind, not a kind; E4 stays, as one branch with no Retry wiring; FIX-2406's
matrix becomes the end-to-end spine when it lands, and these tests stay as the mapping's.

## How it got here

- Drafted 2026-11-04 from FIX-2550, FIX-2370's spec and decisions, both labs' `adapter.ts` and
  `Entry.tsx`, and FIX-2406's spec PR #4719, which found the gap.
