# FIX-1440 · Business rules

> **Rewritten 2026-09-18** for the owner amendment. The previous rules asserted a total removal of
> the children read surface; that surface now stays and the rules invert.

## A dispatch run is discoverable on its flow

| When | Then | Proved by |
|---|---|---|
| A board dispatches a row, and the flow's sessions are listed **with** the include | The run's session is in the result, with its own id and its `parentSessionId` recorded | Listing test over a real dispatch |
| The same listing **without** the include | The result is byte-identical to today's — the run does not appear | The same test's second assertion. This is the FIX-1009 protection, and it is a rule, not an implementation detail |
| A caller opens a dispatch-run session by id | It serves, exactly as it does today | `handleGetSession` is unchanged; a characterization test pins that |
| A caller streams, reads state from, or aborts a dispatch-run session by id | It serves, exactly as it does today | Unchanged routes; pinned by the same characterization test |
| A dispatch run is listed by a **different** principal, or a different tenant | It is absent, at every setting of the include | Listing test per boundary. The include widens parentage only — never ownership |

## The parent stays recorded, as provenance

| When | Then | Proved by |
|---|---|---|
| `GET /sessions/:id/children` is called after this lands | It answers as it does today | The route is untouched; its existing suite still passes unedited |
| A reader asks what dispatched a run | `parentSessionId` on the record answers it | Unchanged field (D1, and the issue's own ask to keep the provenance edge) |
| A reader treats the children route as the only way to reach the work | The docs no longer support that reading | Docs review; the framing is what S9 changes |

## The dispatch path is untouched

| When | Then | Proved by |
|---|---|---|
| A board seat with `dispatcher({ type: "task" })` drains two rows | Each row runs in its own derived session, distinct from the drain's, settles `completed`, and carries the held-out salt | `goals/task-board/hands-a-row-to-a-worker-in-its-own-session` — the **same** check, unedited, still green |
| A `{ key }` dispatch is retried after the first attempt created the session | The second dispatch adopts the existing record rather than minting a second | The renamed derivation suite, adoption cases unchanged |
| The derivation module is renamed | Every derived session id is byte-identical to the one the old code produced | Determinism cases in the renamed suite |
| A run is in flight across the upgrade and retries | It re-enters the session it started, not a second one beside it | Same — the `dsx_` prefix and hash material are unchanged (D2) |

## The vocabulary stops teaching a nest

| When | Then | Proved by |
|---|---|---|
| A reader greps live code for `childSession` | Matches appear only in the provenance route's own naming, if D2's rename leaves any there | Repointed corpus checker |
| A reader opens the DevTool on a conversation | There is no tab that descends into children, and no breadcrumb that nests | S5; visual check |
| A reader follows the docs to find background work | They are pointed at the flow's session list, with provenance as a secondary fact | Docs review |

## Failure taxonomy

| Failure | Shape | Handling |
|---|---|---|
| The include is spelled as a storage concept on the wire | Callers learn `parentage: "all"`, coupling the HTTP surface to a store enum | Prevented by S2 pinning a caller-facing name and mapping at the route |
| The default listing silently widens | Every existing consumer of `GET /sessions` sees machine sessions appear | Prevented by the second rule in the first table, which is a test, not a convention |
| The descendant walk is dropped without D4 | Liveness widens from "my subtree" to "anything of mine on this flow" | Blocked: S6 does not start until D4 is answered |
| A derived id changes | An in-flight run mints a second session, and its board row waits out a lease | Prevented by D2's constraint that the prefix and hash material do not move |

## Acceptance criteria

1. A dispatched row's session is listable on its flow without descending from its parent.
2. The same listing without the include returns today's result set unchanged.
3. `GET /sessions/:id/children` still answers, and is documented as provenance rather than as the route to the work.
4. The DevTool has no descent: no Children tab, no nesting breadcrumb.
5. `goals/task-board/hands-a-row-to-a-worker-in-its-own-session` passes **unedited**.
6. `pnpm typecheck` and `pnpm test` pass across the workspace; the docs site builds with broken links throwing.
7. **Open, and not yet acceptance:** D4 (liveness authorization) and D3 (cluster re-triage) are answered before this is implementable end to end.
