# FIX-1661 · Documentation draft

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs** · [Evolution](EVOLUTION.md)

Drafted by the spec author; this session could not dispatch `docs-writer`. The implementer runs
`docs-writer` then `docs-editor` over these drafts against what shipped, before publishing.
Quoted text is the proposed prose. No new page: the result is a field on a read people already
make.

Voice rules most at risk here: don't open sentences with "This"; no internal issue numbers; say
plainly that the value is stored (the retention consequence is the part a reader needs).

## CREATE · `apps/docs/docs/api/client.md` · new `### sessions.listSessionRequests(sessionId, options?)`, after `sessions.listChildSessions`

> ### `sessions.listSessionRequests(sessionId, options?)`
>
> List the requests a session has run. Each entry is a summary of one request:
> its action, its status, its timings, and what the action came to.
>
> ```ts
> const requests = await sessions.listSessionRequests("sess_1", { includeResultOutput: true });
>
> for (const req of requests) {
>   if (req.result == null) continue;          // still running, or no result recorded
>   if (req.result.error) console.log(req.actionName, "failed:", req.result.error.message);
>   else console.log(req.actionName, "returned", req.result.output);
> }
> ```
>
> `result` is filled in once the request ends:
>
> | Request ended | `result` |
> |---|---|
> | `completed` or `incomplete` | `{ output }`, the value the action returned. `{}` when it returned nothing |
> | `failed` | `{ error: { code, message } }`. If the action had already answered when a completion hook failed the request, `output` is there too |
> | `aborted`, `interrupted`, or still running or suspended | absent |
>
> A request recorded by a server version that didn't store results has no `result` either, so
> check it with `== null` rather than reading `status` alone.
>
> The summaries leave out each request's item log and the action's return value. Pass
> `includeItems: true` for the log and `includeResultOutput: true` for `result.output`.
> Without it, `result` still carries `error` and `hasOutput`, so you can tell a failure from a
> success without shipping every output on each call.

## UPDATE · `apps/docs/docs/advanced/manual-flow-execution.md` · "The result, and fire-and-forget", after the first paragraph

> The same `output` and `error` are stored on the request's record, as `result`, when the run
> ends. A client that dispatched the action over HTTP reads them from
> [`listSessionRequests`](/docs/api/client#sessionslistsessionrequestssessionid-options) without
> waiting on the stream (pass `includeResultOutput: true` for the output).
>
> Stored means kept for as long as the request is. That includes the output of an action whose
> block is marked `transient`, which keeps the block's traces out of storage but not the
> action's return value.

## UPDATE · `apps/docs/docs/devtool/overview.md` · "Changing a task from its row", second paragraph (replace)

> If the task can't move that way, say you cancel a task that already finished, the action
> refuses and the row shows why in the action's own words. Nothing is written. The row reads
> the answer from what the server recorded for that request, so it's the same whether you
> watched the request run or started another one meanwhile. When no result was recorded for a
> request (an older server, or history from before an upgrade), the row says so instead of
> guessing.

## UPDATE · `packages/client/README.md` · the `listSessionRequests` example comment

> ```ts
> // List a session's requests. Each summary carries `result` once the request
> // ends: `{ error }` when it failed; the output with `includeResultOutput`.
> // Pass `includeItems` to back-fill each request's item log (e.g. the DevTool).
> ```

## UPDATE · `docs/architecture/server-and-client.md` · "Action Execution Flow", policy list

> - The action's result is stored on the request record as `result` (`output`, or `error`) in the
>   same write as the final status, and `GET /sessions/:id/requests` returns it, with `result.output` only on
>   `include_result_output=true`. A missing
>   `result` means unfinished or legacy (BP-030).

## Publication ownership

FIX-1661 publishes all five after VG passes. The `apps/docs` anchor for the new client section
is whatever Docusaurus generates for its heading; fix the cross-link to match.
