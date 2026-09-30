/**
 * Lists the on-disk tree for a subscribe style. Useful for `fsdev run`
 * without GitHub.
 */
import { handler } from "@flow-state-dev/core";
import { z } from "zod";

const fileRow = z.object({
  path: z.string(),
  fires: z.string(),
  runs: z.string(),
  sessionOwner: z.string(),
});

export type SubscribeLayout = "per-session" | "fan-in-route";

export function inspectLayout(layout: SubscribeLayout, files: z.infer<typeof fileRow>[]) {
  return handler({
    name: `inspect-${layout}`,
    inputSchema: z.object({}).default({}),
    outputSchema: z.object({
      layout: z.enum(["per-session", "fan-in-route"]),
      files: z.array(fileRow),
    }),
    execute: () => ({ layout, files }),
  });
}
