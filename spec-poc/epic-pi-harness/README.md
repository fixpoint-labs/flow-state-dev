# POC evidence — OMP / pi runtime seams

Throwaway, never merged. The [current epic](../../spec/_epics/pi-harness.md) is
OMP-only and harness-only. Its durable question/approval and same-session continuation
proof remains open. The earlier pi companion investigation below is historical, not
the current design or acceptance claim.

## Current model-free runtime checks

`runtime-check/bridge.mjs` was run unchanged on installed pi 0.85.1 and OMP 18.1.14.
Both emitted `extension_ui_request` with `method: "confirm"`; replying with the same
ID and `confirmed: true` reached the extension callback. Evidence:
`runtime-check/roundtrip-evidence.json`. No model was invoked.

Launch either executable with `--mode rpc`, a scratch `--session-dir`, and
`-e <absolute-path-to-runtime-check/bridge.mjs>`. The captured runs disabled discovered
extensions, skills, tools, and project rules/context using each runtime's own flags;
they did not share a launcher configuration. Send newline-terminated JSON over stdin:

```json
{"id":"ask","type":"prompt","message":"/fsd-probe"}
```

Read the emitted confirmation ID, then send `extension_ui_response` with that ID and
`confirmed: true`. After `FSD_PROBE_ANSWER:true`, send a prompt with
`message: "/fsd-probe-history"`; the callback reports `[{"answer":true}]`.
That history is in-memory evidence only. The probe commands did not persist session
files on either runtime; reported session IDs/paths are not a resume proof.

A separate `omp --mode rpc-ui --tools ask --no-extensions --no-skills --no-rules
--no-lsp --no-title --session-dir <scratch>` run, with an isolated
`PI_CODING_AGENT_DIR`, returned `ask` in `get_state.data.dumpTools`.
`runtime-check/omp-native-ask-evidence.json` records the selected response fields.
This checks native tool registration, not an actual model-driven ask.

These checks remove the need to assume a bespoke HTTP/file-mailbox live-answer
transport. They do **not** prove tool interception, authorization, safe stop, durable
parking, restart-resume, or the full FSD manager loop. Pinned source and the runtime
comparison are in the epic's §3; LAB-164 owns the remaining full-path proof.

## Original question (superseded)

The original pi proposal assumed a spawned `pi` run could block on a companion
question and receive an answer from FSD. Its console fallback and live-held worker
wait have since been removed. The retained files and findings below record that
earlier investigation; they do not establish the revised OMP objective.

## What was built

| File | What it is |
| --- | --- |
| `host.mjs` | Stand-in for the FSD host. Receives a request, waits 2s (an operator deciding), answers. |
| `companion.ts` | The companion extension: a `tool_call` handler that blocks `bash` on a remote verdict, and a `flow_ask` tool the run can call. |
| `probe.ts` | Mechanics probe that needs no LLM — checks tool registration and the blocking round trip directly. |

**Transport is a file mailbox, not a socket.** The authoring sandbox forbids `listen(2)`
(`EPERM` on both TCP and a Unix socket). The transport is not what was under test — the
*blocking semantics* are — so the rendezvous was swapped and the question preserved. A real
implementation was then assumed to need socket/HTTP; the native RPC findings above supersede that assumption.

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
