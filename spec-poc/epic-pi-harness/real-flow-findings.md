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
2. **Two dispatches on one shared session produce distinct request ids** while sharing store
   state — exactly the pairing PI-2 must keep straight when resuming a flow across pi
   sessions and forks. Session continuity is not hypothetical; the substrate already has it.
3. **A pure `handler` flow needs no LLM and no network**, so the epic's transport and routing
   claims can be tested in CI without keys.

## What it corrected in the epic

**Theme 8's item routing was invented.** The spec split items into "progress · status" versus
"outputs · gaps" — a four-way vocabulary that does not exist. The real `RuntimeItem` union in
`@flow-state-dev/contracts` has **24 types**:

```text
block_trace · component · container · continuation · debug · error · file
generator_step · message · output_audio · output_text · ping · reasoning
reasoning_text · refusal · resource_change · router_decision · source
state_change · state_snapshot · status · suspension · suspension_resume · tool_output
```

Two of these matter beyond routing:

- **`suspension` / `suspension_resume`** — FSD *already has* a first-class suspend/resume item
  pair, and `testFlow` already reports a `"suspended"` terminal status. The epic's §5 open
  question ("where does a mid-run question live?") was written as if this had to be invented.
  It may not: the durable mid-run question mechanism may already exist in the item vocabulary.
  **This is the single most useful thing this probe found**, and it should be checked before
  that question is answered.
- **`ping`** — a keepalive, which is a routing decision the spec never made (it must never
  reach the LLM, and probably never the operator either).

A simple `handler` emitted exactly one `block_trace` item. So the routing policy cannot be
stated as a two-bucket rule; it needs a default for 24 types, and the safe default is
*TUI-only unless explicitly promoted*, not the reverse.

## What it does NOT establish

- Nothing about **HTTP or SSE**. `testFlow` is in-process; the epic's transport choice
  (theme 2) is still untested. A follow-up should boot `fsdev dev` and drive the real
  `/api/flows/{kind}/actions/{action}` route.
- Nothing about a **generator** (LLM) flow, tool loops, or streaming deltas.
- Nothing about the **pi side**. This probe and the pi probe still do not touch each other;
  no end-to-end path has run.
