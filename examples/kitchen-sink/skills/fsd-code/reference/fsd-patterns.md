# FSD code patterns — canonical shapes

Copy-adapt from these. Don't generate block code from memory.

## Handler — pure function of input

```ts
import { handler } from "@flow-state-dev/core";
import { z } from "zod";

export const uppercase = handler({
  name: "uppercase",
  inputSchema: z.object({ text: z.string() }),
  outputSchema: z.object({ text: z.string() }),
  execute: async ({ text }) => ({ text: text.toUpperCase() }),
});
```

Rules:
- No block-running inside `execute` (BP-011).
- Never `return input` — use `.tap()` for state-only mutations (BP-014).

## Generator — LLM call

```ts
import { generator } from "@flow-state-dev/core";

export const explain = generator({
  name: "explain",
  agentType: "primary",
  model: "preset/fast",
  prompt: "You explain things clearly.",
});
```

Rules:
- Set `agentType` explicitly — no position-inferred default.
- Use `uses: [someCapability]` instead of spreading `tools`, `context`, `sessionResources`.

## Sequencer — ordered composition

```ts
import { sequencer } from "@flow-state-dev/core";

export const plan = sequencer({ name: "plan" })
  .then(analyze)
  .then(draft)
  .then(review);
```

Use a sequencer whenever a handler wants to call another block — compose, don't nest.

## Router — branch-on-condition

```ts
import { router } from "@flow-state-dev/core";

export const route = router({
  name: "route",
  inputSchema: z.object({ mode: z.enum(["fast", "thorough"]) }),
  execute: ({ mode }) => (mode === "fast" ? fastPath : thoroughPath),
});
```

Input/output adaptation goes inside the router via `connectInput()` / `connectOutput()` (BP-013), not at the target block's definition.

## Capability factory — configurable capabilities

```ts
import { defineCapability } from "@flow-state-dev/core";

export function createLoggerCapability(options: { prefix: string }) {
  return defineCapability({
    name: "logger",
    fns: () => ({ log: (msg: string) => console.log(`[${options.prefix}] ${msg}`) }),
  });
}
```

Consumers attach with `uses: [createLoggerCapability({ prefix: "app" })]`.

## Pattern — planAndExecute

```ts
import { planAndExecute } from "@flow-state-dev/patterns";

export const researcher = planAndExecute({
  name: "researcher",
  model: "preset/fast",
  uses: [someCapability],
  // synthesizer is primary, step-executor is sub — the factory sets both
});
```

The factory handles agentType internally: the synthesizer is `"primary"`, the step-executor is `"sub"`. Capabilities that opt into `agentType: "primary"` only attach to the synthesizer.
