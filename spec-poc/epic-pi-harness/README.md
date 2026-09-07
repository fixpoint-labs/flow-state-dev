# POC — the pi companion channel

Throwaway. Never merges. Built to falsify the epic's Kill line **before** the objective
gate, because the whole set rests on one unverified pi behaviour.

## The question

The epic's Proof and Kill line both assume: **a spawned `pi` run, loaded with a companion
extension via `-e`, can block on a question and get an answer back from the FSD host.**
If that does not hold, a pi harness is a *substitution* for Claude Code rather than an
improvement, and the epic should ship the console (PI-1..3) and stop.

## What was built

| File | What it is |
| --- | --- |
| `host.mjs` | Stand-in for the FSD host. Receives a request, waits 2s (an operator deciding), answers. |
| `companion.ts` | The companion extension: a `tool_call` handler that blocks `bash` on a remote verdict, and a `flow_ask` tool the run can call. |
| `probe.ts` | Mechanics probe that needs no LLM — checks tool registration and the blocking round trip directly. |

**Transport is a file mailbox, not a socket.** The authoring sandbox forbids `listen(2)`
(`EPERM` on both TCP and a Unix socket). The transport is not what was under test — the
*blocking semantics* are — so the rendezvous was swapped and the question preserved. A real
implementation uses a socket or HTTP.

## Run it

```bash
node host.mjs &                                    # the fake FSD host
pi --mode json -e ./probe.ts -p "hi"               # the mechanics probe
cat probe-result.json
```

## What it showed

```json
{
  "mode": "json",
  "hasUI": false,
  "toolRegistered": true,
  "toolCount": 57,
  "blockingRoundTrip": { "ok": true, "elapsedMs": 2136,
                         "answer": { "answer": "Use the staging database, never prod." } }
}
```

1. **A `-e` extension loads in a headless `--mode json` run and registers a tool.** `flow_ask`
   was present among the run's 57 tools.
2. **An awaited extension callback stays pending across a slow cross-process round trip.**
   2136ms — the host's full 2s operator delay — and the answer arrived intact.

### What it did NOT show — read this before citing it

An earlier version of this file claimed the probe proved "blocking a run on a human is
mechanically fine." **It does not.** The gap is specific and worth stating plainly:

`probe.ts` calls `callHost()` **directly from its `session_start` listener**. It never routes
through the registered `flow_ask` tool's `execute()` handler. So:

- **No `tool_call` event is ever raised**, which means `companion.ts`'s `bash` approval
  interceptor — half the channel — **was never exercised at all**.
- The ask tool was never shown to block a *real agent turn*. Tool **registration** is not tool
  **execution**; `pi.getAllTools()` proves visibility only.
- The model-driven path failed entirely: the sandbox has no outbound network, so every LLM
  call errored (`auto_retry_start` ×3, `errorMessage: "fetch failed"` — see `run-ask.jsonl`).

What is genuinely established is narrower and still useful: **a pending promise inside a pi
extension can be settled by another process seconds later.** That is a real mechanism risk
removed. The file-mailbox transport does not weaken it, since `await` semantics do not depend
on whether the bytes arrive over a socket or a file.

pi's own docs state independently that `tool_call` can block (`docs/extensions.md` 778–793) —
but that is documentation, not demonstration by this probe.

Also untested, and owned by PI-6: authentication, run/attempt correlation, cancellation and
liveness, and what happens when either process dies. The probe deliberately has none of them.

**To close the gap**, a follow-up needs network access and should drive `companion.ts` (not
`probe.ts`) with a live model: assert that a `bash` call is denied by the host verdict, and
that a model-invoked `flow_ask` suspends the turn until the host answers.

## What changed because of it

- **A mechanism risk under the Kill line is removed**, though no Kill-line condition is
  discharged. The channel is not resting on an impossible premise; it is still unproven.
- **`ctx.hasUI` is `false` in `--mode json`.** The companion cannot prompt through pi's own UI
  in a spawned run, so a question must travel out to the host.
- **The epic's real hole surfaced from that.** Asking *where* a live question goes exposed that
  `announce` fires only **after** `board.awaitReview` — it is a post-park notification, while
  `flow_ask` blocks mid-run. PI-3 as scoped cannot bridge that. The epic now carries it as a
  blocking open question rather than an assumed dependency, which is the most valuable thing
  this POC produced.

  > **Stale citation, kept for the record.** This probe cited
  > `labs/conductor/src/manager.ts:1244`. That code has since been superseded by the published
  > `@flow-state-dev/harness-manager`, where the same ordering is a *stated invariant* at
  > `manager.ts:1498–1504`. The finding got stronger, not weaker — see the epic-spec's §5.
