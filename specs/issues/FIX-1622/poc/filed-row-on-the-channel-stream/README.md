# poc/filed-row-on-the-channel-stream — does a filed case reach an open view with no reload, through what already ships?

Throwaway and retained as evidence. Nothing under `specs/` is built, tested or walked by
`fsdev gen`, and `knip` ignores `specs/issues/*/poc/**`. One script, no new dependencies,
nothing patched.

**The question.** The escalations panel only shows a filed case after a reload. Making it live
honestly depends on one fact: **when a specialist files a case, does some stream that already
ships tell an open page about it?** If the only signal is a `resource_change`, it reaches only
the session that wrote it, and live needs FIX-1506 first. If a kept item names the change on a
session's stream, FIX-1609's stream already carries it. Reading the code gives a plausible
answer. Running the real app gives the actual one.

**What it runs.** kitchen-sink's own `fsdev.config.ts` (the real roster, the routed
`support.help` channel, `escalate`) in test mode, so the model is the app's scripted one and no
key is read. It calls the routes the page calls, in-process, on the in-memory store. It opens
three session streams the way `useSession({ live: true })` does: `support.help` filtered to
components, `support.help` unfiltered, and a new assistant (`chat-agent`) conversation, the
session the panel reads through today. Then it posts one needs-a-person case with a fresh token.

**What would have abandoned the direction:** no `task-change` for the board on the channel's
stream (then live waits for FIX-1506), or one that arrived only on a stream nobody can follow.

## Run it

From `apps/kitchen-sink`:

```bash
KITCHEN_SINK_TEST_MODE=1 STORE_TYPE=memory AI_GATEWAY_API_KEY= \
  pnpm exec tsx ../../specs/issues/FIX-1622/poc/filed-row-on-the-channel-stream/probe.mts

# control: the specialist says it filed and files nothing. F1 and F4 must FAIL, the rest stay green
KITCHEN_SINK_TEST_MODE=1 STORE_TYPE=memory AI_GATEWAY_API_KEY= GOAL_CONTROL=no-filing \
  pnpm exec tsx ../../specs/issues/FIX-1622/poc/filed-row-on-the-channel-stream/probe.mts
```

Exit 0 when every check passes, 1 otherwise. Unset `WORKFORCE_ADMIN_TOKENS` if your shell has
it, so the app runs as its single `devuser` organization.

## What it showed

[evidence.txt](evidence.txt), on `main` at 9a55b79e4:

| Check | Asks | As is | `no-filing` |
|---|---|---|---|
| **F1** | Does the channel's stream carry a `task-change` for `support.help.escalations` with the token? | PASS · `added`, `pending`; readable +0.1 s after the post, on the stream +0.5 s | **FAIL** · nothing filed |
| **F1b** | Which request kept it? | PASS · the channel's own `fileTask`, in `support.help` | PASS · none |
| **F2** | Does the assistant conversation's stream, open and following, carry anything about it? | PASS · nothing | PASS |
| **F3 / F3b** | Does a `resource_change` reach any stream? What did the filing request keep? | PASS · none; it kept `block_trace` and `component` | PASS |
| **F4** | Is the row readable through the channel, and through the assistant? | PASS · once each; only the board's published fields | **FAIL** · nothing to read |
| **F6** | A row written onto the same board from **another** session: where does its change land? | PASS · readable through the channel; its `task-change` is on the writer's stream, and absent from the channel's 4 s later | PASS |
| F5 | Informational: what the `task-change` item carries | `attempts, createdAt, goal, id, incarnationId, metadata, revision, status, updatedAt, writeLogTruncated` | — |

**The premise held.** A filing is kept as a `task-change` item in the channel's own request, and
the channel's session stream delivers it within about half a second. The panel misses it today
because it reads through a different session and watches nothing. The design follows from that:
the list follows the session the board's changes are kept in, and re-reads when one arrives
([D1](../../DECISIONS.md#d1)).

**Two findings the design carries:**

- **F6 is the boundary.** A change written from another session lands on that session's stream,
  not the channel's. Today nothing else writes `escalations`: nobody drains it (FIX-1591 is
  parked). A seat or a person working rows from their own conversation would be live only once
  FIX-1506 fans changes out across sessions. The spec names this rather than hiding it.
- **F5: the item is wider than the board's allowlist.** It carries `metadata` (the author) and
  internals the collection's `expose` withholds from a read. So the list re-reads and renders
  what the read returns, never the item's payload. The width is pre-existing, in the channel's
  item log; [PLAN.md → Follow-ups](../../PLAN.md#follow-ups) flags it.

**What it does not prove:** anything about a browser, a production build or a second tab. It
calls the router in process, on the in-memory store, with one filing. The goal check proves
those ([SPEC.md → The goal](../../SPEC.md#the-goal-and-how-well-know-its-met)). F6's writer is a
throwaway flow registered in this process only, not a real drain.
