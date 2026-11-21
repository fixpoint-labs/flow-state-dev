/**
 * POC app (FIX-2836): memory shared with another kit's flows, with no
 * `provides`. Throwaway design evidence, not production code.
 *
 * The memory system is built once, at module scope, by the memory package's
 * own `system(config)`. Its capability then goes where any capability goes:
 *
 * - into workforce's real `uses` slot, through the app's `fill` (leg a);
 * - into a stand-in kit's `uses` slot, declared the way workforce declares
 *   its own, whose flow runs a block that calls `ctx.cap` (leg b).
 *
 * `POC_CONTROL=no-fill` drops both fills: memory never reaches either kit.
 */
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { defineFlow, defineKit, handler, slot, type UsesEntry } from "../../../../../packages/core/src/index.ts";
import { createFlowState, inMemoryStores } from "../../../../../packages/engine/src/index.ts";
import { system } from "../../../../../packages/memory/src/index.ts";
import { workforce } from "../../../../../packages/workforce/src/kit/index.ts";

/** Built once, from config, before any kit installs. */
export const mem = system({ model: "openai/gpt-6-luna", working: true });

/** A consuming kit that knows nothing about memory: a `uses` slot, as workforce declares one. */
export const team = defineKit({
  name: "team",
  slots: { uses: slot.list(z.custom<UsesEntry>((value) => typeof value === "object" && value !== null)) },
  install: ({ slots }) => ({
    flows: [
      defineFlow({
        kind: "team",
        actions: {
          remember: handler({
            name: "team-remember",
            inputSchema: z.object({}),
            uses: [...slots.uses] as never,
            execute: async (_input: unknown, ctx: any) => {
              const working = ctx.cap?.workingMemory;
              if (working === undefined) throw new Error("ctx.cap.workingMemory is absent: memory never reached this flow");
              await working.add({ content: "the user prefers short answers", importance: 0.9 });
              await working.add({ content: "the deploy is on Friday", importance: 0.6 });
              const entries = await working.items();
              return { capabilities: Object.keys(ctx.cap), entries: entries.map((entry: { content: string }) => entry.content) };
            },
          }),
        },
      })(),
    ],
  }),
});

const control = process.env.POC_CONTROL;
const root = mkdtempSync(join(tmpdir(), "fix-2836-poc-"));
mkdirSync(join(root, "workforce"));

export default createFlowState({
  kits: [team(), workforce({ agent: { model: "openai/gpt-6-luna" } })],
  fill:
    control === "no-fill"
      ? {}
      : { [workforce.slots.uses]: [mem.capability], [team.slots.uses]: [mem.capability.with({ working: false, digest: false, recall: false })] },
  root,
  stores: { default: { primary: inMemoryStores() } },
});
