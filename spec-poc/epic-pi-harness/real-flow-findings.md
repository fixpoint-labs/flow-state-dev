# Probe — a REAL flow through the REAL engine

The first probe in this directory tested pi's half against a **mock FSD host**, which left
the actual integration untested at both ends and let the spec invent FSD shapes that do not
exist. This runs a genuine flow through `runAction` — the same engine the server uses.

Run (from `packages/testing`, which resolves the workspace deps; `spec-poc/` is not a
workspace member):

```bash
cp real-flow.test.ts ../../packages/testing/test/tmp/ && cd ../../packages/testing
npx vitest run test/tmp/real-flow.test.ts
```

## Result — 2 passed

```text
STATUS: completed
OUTPUT: {"verdict":"reviewed packages/pi","target":"packages/pi"}
ITEM COUNT: 1
ITEM SHAPES: ["block_trace"]
REQUEST IDS: test_flow_req_...ea00df985007d  test_flow_req_...2e5a4444de6c
```

## What this establishes

1. **A real flow action dispatches and returns a real terminal status** (`completed`) and a
   real typed output. This is the shape a pi extension renders.
2. **Two sequential dispatches against one in-process engine each reach terminal
   `completed`, each with a distinct request id.** That is the whole of it. The handler under
   test touches no state, and `testFlow` mints a fresh request id on every call
   (`packages/testing/src/test-utilities/testFlow.ts:159` — `generateId("test_flow_req")`,
   which is timestamp + random and reads neither `sessionId` nor `stores`), so the same
   inequality would hold for two unrelated sessions, or if the shared session and stores were
   ignored outright. **Same-session continuity across a runtime restart remains unproven** —
   one process, in-memory stores, no teardown — which is the position the epic-spec already
   holds. An earlier version of this file concluded the opposite from this test.
3. **A pure `handler` flow needs no LLM and no network**, so the epic's transport and routing
   claims can be tested in CI without keys.

## What it corrected in the epic

**Theme 8's item routing was invented.** The spec split items into "progress · status" versus
"outputs · gaps" — a four-way vocabulary that does not exist. The real `RuntimeItem` union in
`@flow-state-dev/contracts` has **17 types**:

```text
block_trace · component · container · continuation · error · generator_step
message · reasoning · resource_change · router_decision · source
state_change · state_snapshot · status · suspension · suspension_resume · tool_output
```

`RuntimeItem` is `OutputItem` — 13 members in `packages/contracts/src/items/types.ts` — plus
the four trace types `block_trace`, `router_decision`, `state_snapshot` and `generator_step`
(`packages/contracts/src/items/internal.ts`). 13 + 4 = 17, and `types.ts` carries exactly 17
`type: "…"` discriminator literals.

**An earlier version of this file said 24.** It reached that number by taking every type name
in the items tree, which sweeps in seven names that are not item discriminators at all:
`output_text`, `reasoning_text`, `refusal`, `file` and `output_audio` are ContentPart types
living *inside* an item, in a `message`'s `content` array or a `reasoning`'s `summary`
(`items/content.ts`); `debug` and `ping` are SSE event types on the transport envelope
(`items/events.ts`). That distinction is the finding worth keeping: **a renderer allowlist
built from "every type name in the items tree" over-counts by pulling in content parts and
transport events.** Route on an item's own `type`; a content part is reached by walking into
the item that holds it, and a transport event never reaches a renderer at all.

One of these matters beyond routing:

- **`suspension` / `suspension_resume`** — FSD *already has* a first-class suspend/resume item
  pair, and `testFlow` already reports a `"suspended"` terminal status. The epic's §5 open
  question ("where does a mid-run question live?") was written as if this had to be invented.
  It may not: the durable mid-run question mechanism may already exist in the item vocabulary.
  **This is the single most useful thing this probe found**, and it should be checked before
  that question is answered.

And one thing outside the item vocabulary still needs a decision the spec never made: the
`ping` **SSE event** is a keepalive that must never reach the LLM, and probably never the
operator either. It is a transport-layer filter, not an item-routing rule.

A simple `handler` emitted exactly one `block_trace` item. So the routing policy cannot be
stated as a two-bucket rule; it needs a default for 17 types, and the safe default is
*TUI-only unless explicitly promoted*, not the reverse.

## What it does NOT establish

- Nothing about **HTTP or SSE**. `testFlow` is in-process; the epic's transport choice
  (theme 2) is still untested. A follow-up should boot `fsdev dev` and drive the real
  `/api/flows/{kind}/actions/{action}` route.
- Nothing about a **generator** (LLM) flow, tool loops, or streaming deltas.
- Nothing about **same-session continuity across a runtime restart**. Both dispatches run in
  one process against in-memory stores that are never torn down.
- Nothing about the **pi side**. This probe and the pi probe still do not touch each other;
  no end-to-end path has run.
