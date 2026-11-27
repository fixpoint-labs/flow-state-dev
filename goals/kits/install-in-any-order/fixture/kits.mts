/**
 * The goal's fixture kits: `b` ← `c` ← `d`.
 *
 * - `b` declares a keyed slot (`entries`) and a list slot (`order`), owns the
 *   folder `b/` and claims `greeting.txt` in it. Its flow answers with what its
 *   slots and folder held.
 * - `c` requires `b`, declares a list slot of its own (`extras`), and fills
 *   `b`'s slots; its keyed entry is built from what landed in `extras`.
 * - `d` requires `c` (and so `b`, through it), fills `c.extras` and `b`'s slots.
 *
 * `GOAL_CASE` turns on one mistake for a refusal leg: `duplicate` has `d`
 * repeat `c`'s key, `unrequired` adds a kit `e` that fills `b.order` without
 * requiring `b`.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { defineFlow, defineKit, handler, slot } from "@flow-state-dev/core";

const ping = (kind: string) =>
  defineFlow({
    kind,
    actions: {
      ping: handler({ name: "ping", inputSchema: z.object({}).passthrough(), execute: () => ({ served: kind }) }),
    },
  })();

export const b = defineKit({
  name: "b",
  slots: { entries: slot.keyed(z.string()), order: slot.list(z.string()) },
  directory: {
    path: "b",
    read: async (folder) => {
      folder.claim("greeting.txt");
      return (await readFile(join(folder.path, "greeting.txt"), "utf8")).trim();
    },
  },
  install: ({ folder, slots }) => ({
    flows: [
      defineFlow({
        kind: "b-flow",
        actions: {
          read: handler({
            name: "read",
            inputSchema: z.object({}).passthrough(),
            execute: () => ({ greeting: folder, entries: { ...slots.entries }, order: [...slots.order] }),
          }),
        },
      })(),
    ],
  }),
});

export const c = defineKit({
  name: "c",
  requires: [b],
  slots: { extras: slot.list(z.string()) },
  contributes: ({ slots }) => ({
    [b.slots.entries]: { c: `c carries [${slots.extras.join(", ")}]` },
    [b.slots.order]: "c",
  }),
  install: () => ({ flows: [ping("c-flow")] }),
});

export const d = defineKit({
  name: "d",
  requires: [c],
  contributes: () => ({
    [c.slots.extras]: ["from d"],
    [b.slots.entries]: process.env.GOAL_CASE === "duplicate" ? { c: "d again" } : { d: "from d" },
    [b.slots.order]: ["d"],
  }),
  install: () => ({ flows: [ping("d-flow")] }),
});

/** Fills `b.order` while requiring nothing: refused, naming both kits. */
export const e = defineKit({
  name: "e",
  contributes: () => ({ [b.slots.order]: "e" }),
  install: () => ({ flows: [] }),
});
