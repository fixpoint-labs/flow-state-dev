# FIX-1001 spec POC — result

**Question.** The issue asserts a two-way asymmetry: on **abort** and **disconnect** the
exposure is "largely closed by the signal", leaving **error** as the only open path. Is that
true, and is the request record already terminal while a background task is still able to act?

**Verdict: the asymmetry is three-way, not two-way. The issue is right about error, right
about abort, and wrong about disconnect.**

## Run

```bash
pnpm install
pnpm exec vitest run --root . --config spec-poc/FIX-1001-drain-terminal-paths/vitest.config.ts
```

Verified against `spec/FIX-1001` at merge-base `26664927` (`main`, post-FIX-992 #1035/#1039/#1036).
4 tests, 4 passing.

## Output

| Case | final record | background `ctx.signal` aborted | task acted *after* `runAction` returned | record status the task observed |
|---|---|---|---|---|
| **A · error** (action throws) | `failed` | **false** | **true** | **`failed`** |
| **B · disconnect** (transport signal) | `interrupted` | **false** | **true** | **`interrupted`** |
| **C · abort** (`/abort` endpoint) | `aborted` | **true** | false | `in_progress` |
| **D · success** *(discrimination)* | `completed` | false | false | `in_progress` |

## What it shows

1. **Error and disconnect are the same exposure.** In both, the background task's own signal
   is clean, the task is still parked when the record goes terminal, and when it wakes it
   observes a **terminal** record through the same live stores handle. Nothing stops it.

2. **Only explicit `/abort` is closed by the signal.** Case C is the one path where the
   background signal fires, which is why the task short-circuits and never observes a
   terminal record.

3. **Why disconnect behaves like error.** Read directly off `packages/engine/src/execution/runAction.ts`:

   ```
   :852  abortController      = registerAbortController(requestId)          // the /abort endpoint
   :853  composedSignal       = AbortSignal.any([options.signal, abortController.signal])
   :889  backgroundController = new AbortController()
   :902  abortController.signal.addEventListener("abort", fireBackground)
   ```

   `backgroundController` — the signal substituted for `ctx.signal` inside a `.work()` task —
   listens **only** on `abortController`. The transport half of `composedSignal` never reaches
   it. This is deliberate (FIX-663: a client disconnect must not kill legitimate fire-and-forget
   work), and it is exactly why disconnect leaves the task running.

   The signal half of this is already pinned by a passing test on `main`:
   `packages/integration-tests/src/scenarios/work-pool-signal-isolation.test.ts` —
   *"transport-level abort (`options.signal`) does NOT abort background `.work()`"*.
   This POC adds the half that test does not cover: that the **request record is already
   terminal** while the task is still pending.

4. **A fourth, rarer variant the table does not show.** `wasIntentionalAbort` is read from the
   record flag `abortRequested`, not from which controller fired. `handleAbortRequest` sets that
   flag and returns 202 when the request is running on a **different instance** (no local
   controller — `abort-routes`, exercised by `abort.test.ts:137`). On that path the record takes
   the `aborted` branch while `abortController` never fired locally, so the background signal
   stays clean. Multi-instance abort therefore behaves like disconnect, not like case C.

## Discrimination check

Case D runs the identical flow with the throw removed. It must — and does — report
`<runAction had NOT returned>` (still blocked on the drain at `runAction.ts:1409`) and a
**non-terminal** observed status. If D agreed with A, the harness would be measuring nothing
and the verdict would have to be discarded.

A first cut of this POC **failed this discipline in the other direction** and is worth recording:
cases B and C originally fired their signal from a `.tap()` and then ended the chain. Firing a
signal does not enter `runAction`'s catch block — something must *throw* — so both ran to
completion and reported `completed`, while their assertions (which only checked the signal)
still passed green. The terminators now fire the signal and then block on the main chain's
`ctx.signal` and reject, and each case asserts the terminal status it was named for. **A case
that passes without reaching the path it claims to test is the same failure as a grep that
silently matches nothing.**

## Throwaway

`spec-poc/` is ignored by CI and this directory is never merged. The regression coverage that
should survive is specified in the spec's §10, not here.
