---
sidebar_position: 10
---

# Error handling

Errors thrown inside a block propagate up through its parent sequencer, normalize into a `FlowError` on the wire, and surface in the DevTool's failed-block detail panel. Authors who throw structured errors get better debugging for free: the runtime preserves your `code` and `details` end-to-end, and the DevTool renders them without you wiring anything up.

## Throwing structured errors

`FlowError` is a small `Error` subclass exported from `@flow-state-dev/core`. It carries an optional machine-readable `code`, a `retryable` flag (default `false`), an open `details` payload, and an optional `cause`.

```ts
import { FlowError } from "@flow-state-dev/core";
import { handler } from "@flow-state-dev/core";
import { z } from "zod";

export const bash = handler({
  name: "bash",
  inputSchema: z.object({ command: z.string(), cwd: z.string().optional() }),
  outputSchema: z.object({ stdout: z.string(), exitCode: z.number() }),
  execute: async ({ command, cwd }) => {
    if (cwd && !cwd.startsWith(WORKSPACE_ROOT)) {
      throw new FlowError(
        `Command rejected: references path "${cwd}" outside the workspace root`,
        {
          code: "PATH_OUTSIDE_WORKSPACE",
          details: { command, cwd, workspaceRoot: WORKSPACE_ROOT }
        }
      );
    }
    // ...
  }
});
```

The thrown `details` survive normalization and reach the trace verbatim. A developer inspecting the failed block sees the message, the code, and the full `details` payload — no re-run.

## What the runtime adds for you

When a generator's output fails `outputSchema` validation, the runtime throws `OutputValidationError` (also exported from `@flow-state-dev/core`) with structured details:

- `rawOutput` — the text or JSON the model returned, exactly as it arrived.
- `issues` — the Zod issues produced by the failing parse.
- `phase` — `"stream"` if the failure was detected mid-stream, `"final"` if it was caught after the model finished.

The DevTool renders these as dedicated sections: a "Raw output" pane with the model's text, a typed list of `path → message` rows for the Zod issues, and the underlying `details` JSON for completeness.

`OutputValidationError` extends `FlowError`, so any `instanceof FlowError` check covers both cases.

### Well-known `details` keys

The runtime auto-populates these. Author-thrown keys are passed through verbatim alongside them:

| Key            | Source                  | Type                                                          |
| -------------- | ----------------------- | ------------------------------------------------------------- |
| `rawOutput`    | `OutputValidationError` | `string`                                                      |
| `issues`       | `OutputValidationError` | `ZodIssue[]`                                                  |
| `phase`        | `OutputValidationError` | `"stream" \| "final"`                                         |
| `cause`        | any thrown error        | `{ name, message, code?, cause? }`                            |
| `errorType`    | `fetch` tool            | `"http" \| "network" \| "timeout" \| "abort" \| "parse" \| "unknown"` |
| `httpStatus`   | `fetch` tool            | `number`                                                      |
| `responseBody` | `fetch` tool            | `string` (truncated)                                          |

Any thrown error that carries a `cause` has the chain serialized into `details.cause`, so an intermediate failure — a buried `ECONNRESET` under a `fetch failed`, say — reaches the DevTool instead of being dropped at the item boundary. The `fetch` tool adds the HTTP and classification keys; see [the fetch tool](/docs/tools/fetch#error-handling).

## SequencerOutputSchemaError

A sequencer composes blocks into a chain. When it declares an `outputSchema`, the framework validates the value the sequencer actually returns against that schema at runtime. The check covers every exit path: the natural tail, an `exitIf` early return, and a `rescue` recovery. On a mismatch the sequencer throws `SequencerOutputSchemaError` (also exported from `@flow-state-dev/core`), a `FlowError` subclass with `code: "sequencer_output_schema_error"`.

This is distinct from `OutputValidationError`, which a generator throws when the model's output fails the generator's own `outputSchema`. `SequencerOutputSchemaError` is about the composed output of a whole chain, not one block.

Catch it in a parent sequencer's `.rescue()` like any other typed error:

```ts
parent.rescue([
  { when: [SequencerOutputSchemaError], block: recover },
]);
```

To catch drift before the flow runs at all, call `.validate()` on the sequencer at build time. It does a conservative structural comparison between the declared schema and the chain's tail and throws `SequencerSchemaMismatchError` on a mismatch. See [Declaring and validating output schemas](../sequencers/overview.md#declaring-and-validating-output-schemas) for the full contract and its limits.

## Recovering with rescue

To handle a failure inline rather than letting it bubble, use the sequencer's `.rescue()` branch. See [Composing blocks](/docs/sequencers/composing-blocks) for the full DSL. The rescue branch receives the thrown error, so you can read `error.code` to route on the failure category and `error.details` to consume the structured payload.

## Querying rescue status

A recovered error is handled: the value continues down the chain with its normal shape, and the rescue is meant to be a side note, not something every later block has to account for. When a later block does need to react to it, ask `ctx.wasRescued(target)` instead of inspecting the value.

`target` is the name or definition of an earlier block in the current sequencer — typically a step that wraps a risky operation in its own `.rescue()`. Resolution matches `getBlockResult`: only prior siblings in the current run are visible, and under a loop the current iteration is read. It returns `true` only when that block recovered an error through its own `.rescue()` during its run, and `false` otherwise — a clean run, a step that never ran, an unknown name, or a call from outside a sequencer. It never throws.

```ts
// priceOrder keeps the pipeline alive when the live-rate lookup fails by
// falling back to a cached rate inside its own rescue.
const priceOrder = sequencer({ name: "price-order", inputSchema: order })
  .step(fetchLiveRate)
  .rescue([{ block: useCachedRate }]);

const enrich = handler({
  name: "enrich",
  inputSchema: pricedOrder,
  outputSchema: enrichedOrder,
  execute: async (input, ctx) => {
    // A sibling of priceOrder, so it can tell whether the cached-rate
    // fallback ran and mark the result instead of trusting it as live.
    const degraded = ctx.wasRescued(priceOrder);
    return { ...input, pricing: degraded ? "estimated" : "live" };
  },
});

sequencer({ name: "order-pipeline", inputSchema: order })
  .step(priceOrder)
  .step(enrich);
```

Reach for this when a decision is transient and tied to one run. If the fact needs to outlive the run, write it to state instead.

## What you'll see in DevTool

The failed-block detail panel surfaces the error message at the top, the `code` as a small mono-text badge, a dedicated "Raw output" section when the runtime captured one, a "Validation issues" list when Zod issues are present, and a "Details" JSON panel that always renders any other keys on `error.details`. For tool-invoked blocks that fail, the panel also shows the originating tool call's arguments — see [DevTool overview](/docs/devtool/overview).
