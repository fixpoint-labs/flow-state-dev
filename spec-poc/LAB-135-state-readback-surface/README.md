# POC — what survives to the reader, on the two routes LAB-135 reconstructs from

**Throwaway. Nothing here ships.** It is on the spec branch so a reviewer can re-run it, and
it never merges.

## The question

LAB-135 proposes deriving a **structured account** of a coding run from FSD state alone and
grading it field by field, rather than by substring over rendered text (FIX-1184). That design
rests on three premises about what a reader on the far side of the HTTP routes actually
receives. None of the three had been measured end to end — and by lesson 1 of this epic, a
check that cannot see what it claims to measure reports *fine*, not *I can't tell*.

## Run it

```
pnpm tsx spec-poc/LAB-135-state-readback-surface/probe.mts
```

Model-free — no credential, no coding run, a few seconds. It stands up a real
`createFlowState`, a real `serve()` host and `@flow-state-dev/store-sqlite` in a temp
directory, drives the **real** translation and emission layers with scripted SDK messages,
then reads everything back over the **shipped** routes. It writes nothing outside the temp
directory and deletes it afterwards.

## Scope of these conclusions

**This probe measures persistence and readback. It measures nothing about what the harness
emits.** The SDK messages are transcribed from the shapes LAB-134's POC measured off four real
`claude` 2.1.234 runs, and are taken as given here. Read every conclusion below as *"given an
SDK message of that shape, the reader receives…"* — the second half of the path, not the
first.

## What it showed

**1. A file path is a FIELD on a persisted item, not a substring of prose. CONFIRMED.**
The `tool_output` item survives the SQLite round-trip and the requests route with its tool
name and its arguments intact, and the arguments parse:

```
blockName     = "Write"                     <- the TOOL name
toolCall.name = "Write"
toolCall.arguments (raw)    = "{\"file_path\":\"/tmp/poc/src/usage.ts\",\"content\":\"…\"}"
toolCall.arguments (parsed) = { file_path: "/tmp/poc/src/usage.ts", content: "…" }
status        = "completed"    /    "failed" on the erroring Edit
provenance    = { blockName: "poc-drive-run", blockInstanceId: "…:root:0", phase: "main" }
```

Two traps worth naming, both visible above. `item.blockName` is the **tool** name while
`item.provenance.blockName` is the **FSD block** — a reader that confuses them filters on the
wrong one and gets an empty set. And `output` is the **prose** shown to the model
(`"File created successfully at: /tmp/poc/src/usage.ts"`), not a structured result: consistent
with LAB-134's finding that the structured Output rides `tool_use_result`, a field the
translation layer does not read. **Nothing in a reconstruction should parse `output`.**

**2. The ordering key on a persisted item is `itemIndex`. `seq` does not exist. CONFIRMED.**

```
ordering: itemIndex values = [0,1,3,4,4,5]
ordering: seq values       = []  (length 0)
VERDICT ordering: itemIndex usable = true; seq usable = false
```

This is FIX-1183's sharpest instance reproduced deliberately: an assertion written as
`seqs.length > 0 && !monotonic` over `seq` is vacuous, and the surrounding evidence string
still says "non-decreasing sequence". `goals/harness-workstream/mirrors-a-coding-run-as-workstream-items/run.mts`
reads `seq` today, and both of its verdict-log PASS rows claim an ordering property no code
established. Already filed as FIX-1183; not re-filed here.

**Assert non-decreasing, never strictly-increasing and never contiguous.** The measured
sequence has a **duplicate** (`4,4`) and a **gap** (no `2`), both legitimate: `itemIndex` is
read from the live item count at emission, and one item's `added` and `done` are stamped
separately. A contiguity assertion would fail a correct stream.

**3. The collection-state route's envelope, and its 403. CONFIRMED.**

```
visibleOps   HTTP 200  {"items":[{"topic":"run1/src/usage.ts",
                                  "storageKey":"poc-visible/run1/src/usage.ts",
                                  "clientData":{"lastKind":"created","ok":true}}]}
hiddenOps    HTTP 403  {"error":"State read not permitted for \"hiddenOps\""}
```

Three specifics a reader has to get right:

- the per-item state arrives as **`clientData`**, not `state`. (LAB-134's §5 example shows
  `state`; a reader that follows it reads `undefined` on every row — and an assertion over
  that empty set is exactly the shape premise 2 just showed failing green.)
- the route addresses a collection by its **accessor key on the flow**, not by its pattern.
  `visibleOps`, not `poc-visible`. A wrong ref is a **404**, which is distinguishable from the
  403 — worth keeping distinguishable in the failure message.
- one page is **50 rows** by default (200 max), with `nextCursor` present when more remain.
  A reconstruction that reads one page and asserts over the result under-reads silently on a
  run that touched more than 50 files. Follow the cursor, or the account is incomplete and
  cannot say so.

## Why this changed the spec

Premise 1 is what makes §6 decision 1 buildable at all: because the path is a field, the
account can be *derived* and then compared, instead of the expected value being *searched for*
in rendered text. Had it come back as prose only, structured grading would have been
impossible on the item stream and the whole design would have had to move onto LAB-134's
collections alone.

Premises 2 and 3 changed §7 and §9 rather than the direction: `itemIndex` with a
non-decreasing (not contiguous) assertion, `clientData` as the state field, the accessor key
as the ref, and cursor-following as a correctness requirement rather than a nicety.
