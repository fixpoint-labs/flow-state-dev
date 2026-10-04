/**
 * Lists the on-disk tree for a layout. Useful for `fsdev run` without a clock.
 */
import { handler } from "@flow-state-dev/core";
import { z } from "zod";

const fileRow = z.object({
  path: z.string(),
  fires: z.string(),
  runs: z.string(),
  sessionOwner: z.string(),
});

export function inspectLayout(layout: "central" | "per-flow", files: z.infer<typeof fileRow>[]) {
  return handler({
    name: `inspect-${layout}`,
    inputSchema: z.object({}).default({}),
    outputSchema: z.object({
      layout: z.enum(["central", "per-flow"]),
      files: z.array(fileRow),
    }),
    execute: () => ({ layout, files }),
  });
}
