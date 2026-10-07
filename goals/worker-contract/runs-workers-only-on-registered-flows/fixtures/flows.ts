/**
 * The goal's worker flows: five an app can register, and three that
 * each break one rule of the worker contract. Every one is a flow an author
 * could write; none is shaped to trip the check.
 */
import { z } from "zod";
import { defineFlow, defineResourceCollection, handler } from "@flow-state-dev/core";
import { sharedResource, workerConfigSchema, writeShared } from "@flow-state-dev/workforce";

const message = z.object({ message: z.string() });

/** A door that answers by saying what it heard. */
function hearing(name: string) {
  return {
    inputSchema: message,
    userMessage: (input: { message: string }) => input.message,
    block: handler({
      name: `${name}-hear`,
      inputSchema: message,
      outputSchema: z.object({ heard: z.string() }),
      execute: (input, ctx) => {
        ctx.emit.message(`${name} heard: ${input.message}`);
        return { heard: input.message };
      }
    })
  };
}

/** An app's own worker flow. */
export const triageFlow = defineFlow({
  kind: "triage",
  cardinality: "collection",
  configSchema: workerConfigSchema().extend({ desk: z.string().default("front") }),
  actions: { run: hearing("triage") }
});

/** A coordinator: its delegates live in its session state. */
export const coordinatorFlow = defineFlow({
  kind: "coordinator",
  cardinality: "collection",
  configSchema: workerConfigSchema(),
  session: { stateSchema: z.object({ delegates: z.array(z.string()).default([]) }) },
  actions: {
    run: {
      inputSchema: message,
      userMessage: (input: { message: string }) => input.message,
      block: handler({
        name: "coordinator-route",
        inputSchema: message,
        outputSchema: z.object({ delegates: z.array(z.string()) }),
        execute: (_input, ctx) => {
          const delegates = (ctx.session.state as { delegates?: string[] }).delegates ?? [];
          ctx.emit.message(`delegates: ${delegates.join(", ") || "none"}`);
          return { delegates };
        }
      })
    }
  }
});

const noteInput = z.object({ key: z.string(), text: z.string() });
const notes = sharedResource("team-notes/*", { text: z.string() });

/** A flow that writes a shared resource through the helper. */
export const sharerFlow = defineFlow({
  kind: "sharer",
  cardinality: "collection",
  configSchema: workerConfigSchema(),
  actions: {
    run: hearing("sharer"),
    share: {
      inputSchema: noteInput,
      block: handler({
        name: "sharer-share",
        inputSchema: noteInput,
        outputSchema: z.object({ shared: z.string() }),
        resources: { notes },
        execute: async (input, ctx) => {
          await writeShared(ctx, "notes", input.key, { text: input.text });
          return { shared: input.key };
        }
      })
    }
  }
});

const board = defineResourceCollection({
  pattern: "team-board/*",
  scope: "org",
  stateSchema: z.object({ text: z.string() })
});

/** A flow whose author built it to keep org data of its own: every member reads it. */
export const orgKeeperFlow = defineFlow({
  kind: "org-keeper",
  cardinality: "collection",
  configSchema: workerConfigSchema(),
  actions: {
    run: hearing("org-keeper"),
    keep: {
      inputSchema: noteInput,
      block: handler({
        name: "org-keeper-keep",
        inputSchema: noteInput,
        outputSchema: z.object({ kept: z.string() }),
        resources: { board },
        execute: async (input, ctx) => {
          await (ctx.resources.board as unknown as {
            create: (key: string, state: { text: string }, options?: { replace?: boolean }) => Promise<unknown>;
          }).create(input.key, { text: input.text }, { replace: true });
          return { kept: input.key };
        }
      })
    }
  }
});

const note = z.object({ note: z.string() });

/** Breaks one rule: no action takes a person's message. */
export const doorlessFlow = defineFlow({
  kind: "doorless",
  cardinality: "collection",
  configSchema: workerConfigSchema(),
  actions: {
    work: {
      inputSchema: note,
      block: handler({ name: "doorless-work", inputSchema: note, outputSchema: note, execute: (input) => input })
    }
  }
});

/** Breaks one rule: declares the configuration by hand, with `seatId` as a number. */
export const numberedFlow = defineFlow({
  kind: "numbered",
  cardinality: "collection",
  configSchema: z.object({
    instructions: z.string().optional(),
    teamInstructions: z.string().optional(),
    seatSkills: z.array(z.any()).default([]),
    seatTools: z.array(z.any()).default([]),
    seatPackages: z.array(z.any()).optional(),
    seatId: z.number().optional()
  }),
  actions: { run: hearing("numbered") }
});

/** Breaks one rule: declares `writtenBy` optional, so an entry can name nobody. */
export const looseAttributionFlow = defineFlow({
  kind: "loose-attribution",
  cardinality: "collection",
  configSchema: workerConfigSchema(),
  resources: {
    notes: defineResourceCollection({
      pattern: "loose-notes/*",
      scope: "org",
      stateSchema: z.object({
        text: z.string(),
        writtenBy: z.object({ userId: z.string().min(1), workerId: z.string().min(1).optional() }).optional()
      })
    })
  },
  actions: { run: hearing("loose-attribution") }
});
