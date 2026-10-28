# POC · what Cursor's SDK reports of its to-do list

An experiment, not a supported API. Nothing here is imported by production code, and it is
outside default test, lint and knip discovery (`knip.json` ignores `specs/issues/*/poc/**`).

## The question

The issue asked whether Cursor reports a plan at all, and guessed its `task` messages might be
one. The design rests on the answer: what reaches the stream when Cursor changes its to-do list,
and whether it is enough to rebuild the list.

## What it does

`check.mjs` downloads `@cursor/sdk` at the version `@flow-state-dev/cursor` pins
(`TESTED_SDK_VERSION`), and checks seven facts against the shipped code that turns Cursor's runtime
events into stream messages. A fact is a pattern in that code; there is no Cursor run and no key.

| Fact | What it shows |
|---|---|
| F1 | The runtime's to-do call reaches the SDK as `updateTodos`, with args of `{content, status}` pairs only. The SDK keeps no item id and no merge flag |
| F1b | The runtime itself has both: an id on every to-do item, and a merge flag on the update. So the args can be a partial list with no way to place it |
| F1c | The call's result carries the whole list after the update, plus a count |
| F2 | Statuses are `pending`, `inProgress`, `completed`, `cancelled` |
| F3 | A stream tool call takes its name from the converted call's type, so it is named `updateTodos` |
| F4 | A `task` message is the runtime's `summary` event: text that summarizes the run |
| F5 | Plan mode's document (`createPlan`) is a separate call carrying one string |

## How to run it

```bash
node specs/issues/FIX-1917/poc/sdk-wire/check.mjs              # expect PASS, exit 0
node specs/issues/FIX-1917/poc/sdk-wire/check.mjs --control    # plants "to-do items carry an id": expect FAIL, exit 1
node specs/issues/FIX-1917/poc/sdk-wire/check.mjs --sdk <dir>  # an unpacked package/ directory instead of downloading
```

Needs `npm` and network access unless `--sdk` is given.

## What it showed (2026-10-12, `@cursor/sdk` 1.0.31)

All seven pass; the control fails. Cursor does report a to-do list, so the panel never says
"reports no plan" ([D1](../../DECISIONS.md#d1)). The sent update can be partial and has no ids,
so the record takes the whole list from the result ([D1](../../DECISIONS.md#d1)) and knows an
item by its place ([D2](../../DECISIONS.md#d2)). `task` messages stay status notes.

It reads code, not a run. Whether Cursor calls `updateTodos` on a given job is the goal check's
**p** leg. Re-run this on every SDK pin bump; a pattern that stops matching is the signal to
re-read the wire.

## Re-run (2026-10-27, `@cursor/sdk` 1.0.40)

Five patterns stopped matching on the bump from 1.0.31. Re-reading the wire showed every fact
still holds: the minifier renamed variables, and from 1.0.32 protobuf descriptors are a compact
`"Name|n field type"` string instead of field objects. The patterns now accept any identifier
and both descriptor spellings. All seven pass on 1.0.31, 1.0.32, 1.0.37, 1.0.38 and 1.0.40, and
the control still fails.
