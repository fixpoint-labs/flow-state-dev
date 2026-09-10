/**
 * The app's own flow kinds. Two of them, and the split is the point.
 *
 * `worker-agent` is the document-shaped kind: every setting it declares is
 * something YAML can write, so its seats come off disk.
 *
 * `router` is the code-shaped kind: it declares a setting (`route`) whose value
 * is a function. No `WORKER.md` can supply one. A worker of this kind therefore
 * has to be written in code — which is exactly the "second door" case.
 *
 * Both are ordinary `defineFlow` results. The framework learns nothing new.
 */
import { z } from "zod";
import { defineFlow, handler } from "../../packages/core/src/index";

const inputSchema = z.object({ subject: z.string() });

const work = handler({
  name: "work",
  inputSchema,
  outputSchema: z.object({ subject: z.string() }),
  execute: (input) => input,
});

/** Document-shaped: instructions arrive as `persona` (FIX-1344 renames this to `instructions`). */
export const workerAgentFlow = defineFlow({
  kind: "worker-agent",
  cardinality: "collection",
  configSchema: z.object({
    persona: z.string(),
    model: z.string().default("openai/gpt-5.4-mini"),
  }),
  actions: { run: { inputSchema, block: work } },
});

/** Code-shaped: `route` is a live function, so this kind's seats cannot come from YAML. */
export const routerFlow = defineFlow({
  kind: "router",
  cardinality: "collection",
  configSchema: z.object({
    persona: z.string(),
    route: z.custom<(subject: string) => string>(
      (value) => typeof value === "function",
      { message: "route must be a function" },
    ),
  }),
  actions: { run: { inputSchema, block: work } },
});
