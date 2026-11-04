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

- The adapter marks a failed entry `latest` when no item of a later request follows it in the
  thread; the screen passes `onRetry` only for that entry, and only while no turn runs.
- **Instead of** reading the session's requests: the thread's items already order the turns,
  and a request that wrote nothing (a board pass in Teammates) is not a turn the person saw.
  If such a request is the session's newest, Retry still shows; the server takes a retry of
  any failed request, so it still works.
- **Locks in:** Retry follows what the person sees as the last turn.

## Decided, not asked

- **E1 · Who the line names.** Claude Code-style: *The main session*, the words the lab already
  uses for it. Teammates: the worker's name.
- **E2 · Incomplete** is a small muted *Incomplete* under the half reply, in each lab's own entry
  markup. It is a mark on an existing entry, not a second failure line.
- **E3 · No startup key warning.** FIX-2370's slice text also asked each lab's host to log one
  when no model key is set. The failed-turn line now names the missing key in the engine's own
  words at the moment it matters, and FIX-2406 is moving the Claude Code-style host into
  `host.mts`. Left out to keep this one PR off that file.
- **E4 · A task's own run** (the task view in Claude Code-style) shows its failure line too, with
  no Retry: a failed task is retried from its row, which already has the button.
- **E5 · Wording.** The line's words are the component's; neither lab adds copy that names a role.

## How it got here

- Drafted 2026-11-04 from FIX-2550, FIX-2370's spec and decisions, both labs' `adapter.ts` and
  `Entry.tsx`, and FIX-2406's spec PR #4719, which found the gap.
