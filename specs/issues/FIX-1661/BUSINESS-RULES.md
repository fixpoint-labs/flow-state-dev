# FIX-1661 · Business rules

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md) · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

When → then → proved by. CI = unit or route test in the owning package. VG = the goal check,
by leg.

## What the engine records

| # | When | Then | Proved by |
|---|---|---|---|
| BR-1 | An action completes | The record's final write carries `result.output`: the action block's own return value, not a hook's. An action that returned nothing gets `result: {}` (no `output` key) | CI · VG api |
| BR-2 | A request ends `incomplete` (token budget, `onExceeded: "stop"`) | Same as BR-1 | CI |
| BR-3 | The action throws | Status `failed`, `result.error` = `{ code, message }`, no `output` | CI |
| BR-4 | The action answered, then a completion hook failed the request | Status `failed`, `result.error` is the hook's, `result.output` is the action's answer | CI · VG hook-fails |
| BR-5 | A request fails before the action runs, on any path that writes a `failed` record (setup failure; a request the transport host could not enqueue) | `result.error` carries the cause every such writer already has. A writer with no cause writes `result: {}` | CI, one per writer · totality check (PLAN V2) |
| BR-6 | A request suspends | No `result`. A resume that finishes the same request writes it then, once | CI · VG suspend |
| BR-7 | A request is aborted or interrupted | No `result`, by design; the status says it. Absence here is expected, never read as *no result recorded* | CI |
| BR-8 | The action's block is transient, or traces are off | `result` is written anyway (D1) | CI · VG handover |
| BR-9 | The output can't be stored as JSON (a `BigInt`, a cycle) | The final status still lands with `result: { outputNotRecorded: true }` and no `output`, distinct from BR-1's `{}`. The request is not failed for it | CI |
| BR-10 | An in-process caller awaits `runAction` | Its `output` and `error` equal the record's `result` for the same request, except under BR-9, where the caller keeps the live value and the record carries the marker | CI |

## What a client can read

| # | When | Then | Proved by |
|---|---|---|---|
| BR-11 | A client lists a session's requests, with or without items | Each record carries `result` with `error` as stored and `hasOutput`. Same tenant, flow and owner filters as today | CI (route) · VG api |
| BR-11a | The listing is asked without `include_result_output=true` | No record carries `result.output`. With the flag, each carries it as stored | CI (route) · VG api |
| BR-12 | A record written before this change is listed | It lists as today, `result` absent. Read with `== null` (BP-030) | CI |

## What a row shows

| # | When | Then | Proved by |
|---|---|---|---|
| BR-13 | The row's request is running, suspended, or not listed yet | Pending; the list keeps being re-read until it ends | CI · VG suspend |
| BR-14 | It completed and `result.output` is `{ ok: false }` or a declined write | Refused, in the action's own words | CI · VG handover, hook |
| BR-15 | It completed with any other `result` | Done, showing the output. A value held by reference in the trace makes no difference | CI · VG ref |
| BR-16 | It ended in anything but `completed` | Status decides first. `failed` or `incomplete`: the status with `result.error.message`, and the refusal too when `result.output` is one; with `result` absent, the status and "No result recorded for this request." `aborted` / `interrupted`: the status in a plain sentence (BR-7) | CI · VG hook-fails |
| BR-17 | It completed and `result` is absent | "No result recorded for this request." True for an older server and for history written before the upgrade. Never done, never refused | CI · VG control |
| BR-17a | It completed with `result.outputNotRecorded` | Unknown: "Finished, but its return value couldn't be recorded." Never done, never refused | CI |
| BR-18 | Another dispatch takes the live stream while a row's request is running or after it ended | That row's answer is unchanged. Nothing a row shows comes from the stream or a trace | CI · VG handover |

## What none of this may do

| # | Rule | Proved by |
|---|---|---|
| BR-19 | Add a route, or change the dispatch response. The one Layer 1 addition is the record's `result` field, crossing FIX-1629 BR-22 on purpose | CI (route table unchanged) · diff review |
| BR-20 | Put task-board or Workforce knowledge in engine, core or client. The engine never interprets the output | Diff review |
| BR-21 | Leave the trace reconstruction reachable from the row | CI (PLAN V5) |

## Failure taxonomy

Nothing new is fatal. Writing `result` rides the final write the engine already makes; if the
value can't be stored, the value is dropped, never the status (BR-9). On the row, a missing
result is a sentence, not an error (BR-17).

## Acceptance criteria this issue owns

- The goal check passes all five row legs plus **api**, and `GOAL_CONTROL=no-result` fails every leg as named.
- FIX-1629's `works-a-task-from-its-row` still passes, refuse leg included.
- FIX-1660's regression test still passes, or is replaced by BR-18's.
