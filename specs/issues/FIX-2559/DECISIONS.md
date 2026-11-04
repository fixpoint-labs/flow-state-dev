# FIX-2559 · Decisions

[Spec](SPEC.md) · **Decisions**

FIX-2370's decisions hold: one registry component with plain props and an `onRetry` callback
([its D1](../FIX-2370/DECISIONS.md#d1)), sharing `error.tsx`'s body ([its D2](../FIX-2370/DECISIONS.md#d2)),
and one failure path in Kitchen Sink ([its E6](../FIX-2370/DECISIONS.md#decided-not-asked)).
The two below are what Kitchen Sink's code had to add.

<a name="d1"></a>
## D1 · Retry reaches the renderer through a context the chat panel fills

An item renderer is handed only its item. Retry needs the session.

| | A context the chat panel fills (chosen) | Change the registry's `chatAssistantRenderers` | Draw the line outside the stream |
|---|---|---|---|
| The line sits where the turn failed, in the stream | yes | yes | no: under the thread, away from its turn |
| Leaves every other app's renderers alone | yes | no: the harness modes and every installer get it | yes |
| The registry copy stays byte-identical | yes | no, unless the registry changes too | yes |

- The chat panel provides one function, `retryFor(requestId)`, that returns the retry for that
  request or nothing. The app renderer reads it and passes the answer as `onRetry`. Kitchen
  Sink already does this for suspensions (`SuspensionResolverProvider`).
- **Instead of** changing the registry's set: that set is drawn by other apps and by Kitchen
  Sink's coding harness modes, which have no `useSession` failure path to wire, and a renderer
  in it still could not reach a session.
- **Locks in:** Flow State mode's `error` entry is the page's, like its `message` entry already is.

<a name="d2"></a>
## D2 · "Newest" is the session's newest request, read from `useSession`

- `retryFor(id)` answers when `session.latestRequest` is that request, its status is `failed`,
  and the session is neither streaming nor finishing. Retry is then `resumeLatestRequest`.
- **Instead of** reading the newest turn from the thread's items, as the labs do
  ([FIX-2550's D2](https://linear.app/fixpoint-labs/issue/FIX-2550)): `resumeLatestRequest`
  retries `latestRequest` and does nothing for any other, so a button keyed to anything else
  could be drawn and do nothing. The labs call the client per request and can key on items;
  Kitchen Sink calls the hook and keys on what the hook will retry.
- **Locks in:** a failed request followed by a request that wrote no items (a background pass)
  loses its Retry. The person sends again; nothing is drawn that would not work.

## Decided, not asked

- **E1 · What the page's box still shows.** Read from `useSession`: a failed run never sets
  `session.error`. The POST answers with the run's stream, and the failure arrives as the
  `error` item. `session.error` is set by a refused send, a failed snapshot read, and a refused
  retry. Only the last is already on the line (*Retry failed: …*), so the box skips that one
  error and shows the rest. FIX-2370's E6 expected a failed run to show twice; read against the
  hook, the overlap is the refused retry.
- **E2 · Who the line names:** *Assistant*, FIX-2370's own example for Kitchen Sink.
- **E3 · No incomplete mark.** FIX-2370 puts that on the labs' adapters. Kitchen Sink's message
  renderer is the registry's, and a mark there is a registry change for every app.
- **E4 · Scope is Flow State mode.** The coding harness modes draw their turn failures as their
  own notice ("This turn failed: …") and keep the registry's set unchanged.
- **E5 · The e2e failure is scripted**, a model that throws on its first call for one scenario
  marker, in the app's test-mode resolver. It fails the run the way a provider error does.

## How it got here

- Drafted 2026-11-04 from FIX-2559, FIX-2370's spec and decisions, FIX-2550's spec,
  `app/flow-state/page.tsx`, `components/flow-state/chat-assistant.tsx`, the drift test, and
  `useSession`'s `error`, `latestRequest` and `resumeLatestRequest`.
