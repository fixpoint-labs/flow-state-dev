/**
 * The goal's worker flows: five an app can register, and three that
 * each break one rule of the worker contract. Every one is a flow an author
 * could write; none is shaped to trip the check.
 *
 * Each is built on the installation, as every worker flow is (FIX-1788): it
 * declares the installation's session, so a session names its worker, and
 * one copy runs every worker on it.
 */
import { z } from "zod";
import { defineFlow, defineResourceCollection, handler } from "@flow-state-dev/core";
import { sharedResource, workerConfigSchema, writeShared, type WorkerInstallation } from "@flow-state-dev/workforce";

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
      },
    }),
  };
}

/** The flows an app registers, and the three that each break one rule, built on `workers`. */
export function defineFlows(workers: WorkerInstallation) {
  const bound = { session: workers.session(), resources: { ...workers.resources } };

  /** An app's own worker flow. */
  const triageFlow = defineFlow({
    kind: "triage",
    cardinality: "collection",
    configSchema: workerConfigSchema().extend({ desk: z.string().default("front") }),
    ...bound,
    actions: { run: hearing("triage") },
  });

  /** A coordinator: its delegates live in its session state. */
  const coordinatorFlow = defineFlow({
    kind: "coordinator",
    cardinality: "collection",
    configSchema: workerConfigSchema(),
    session: workers.session({ delegates: z.array(z.string()).default([]) }),
    resources: { ...workers.resources },
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
          },
        }),
      },
    },
  });

  /**
   * A flow that writes a shared resource through the helper, as the worker its
   * session was created with: the turn loads the worker, and the helper names
   * the worker the turn loaded (FIX-1788).
   */
  const sharerFlow = defineFlow({
    kind: "sharer",
    cardinality: "collection",
    configSchema: workerConfigSchema(),
    session: workers.session(),
    resources: { ...workers.resources },
    actions: {
      run: hearing("sharer"),
      share: {
        inputSchema: noteInput,
        block: handler({
          name: "sharer-share",
          inputSchema: noteInput,
          outputSchema: z.object({ shared: z.string() }),
          resources: { notes, ...workers.resources },
          execute: async (input, ctx) => {
            await workers.resolveWorker(ctx, "sharer");
            await writeShared(ctx, "notes", input.key, { text: input.text });
            return { shared: input.key };
          },
        }),
      },
    },
  });

  /** A flow whose author built it to keep org data of its own: every member reads it. */
  const orgKeeperFlow = defineFlow({
    kind: "org-keeper",
    cardinality: "collection",
    configSchema: workerConfigSchema(),
    ...bound,
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
            await (
              ctx.resources.board as unknown as {
                create: (key: string, state: { text: string }, options?: { replace?: boolean }) => Promise<unknown>;
              }
            ).create(input.key, { text: input.text }, { replace: true });
            return { kept: input.key };
          },
        }),
      },
    },
  });

  /** Breaks one rule: no action takes a person's message. */
  const doorlessFlow = defineFlow({
    kind: "doorless",
    cardinality: "collection",
    configSchema: workerConfigSchema(),
    ...bound,
    actions: {
      work: {
        inputSchema: note,
        block: handler({ name: "doorless-work", inputSchema: note, outputSchema: note, execute: (input) => input }),
      },
    },
  });

  /** Breaks one rule: declares the configuration by hand, with `seatId` as a number. */
  const numberedFlow = defineFlow({
    kind: "numbered",
    cardinality: "collection",
    configSchema: z.object({
      instructions: z.string().optional(),
      teamInstructions: z.string().optional(),
      seatSkills: z.array(z.any()).default([]),
      seatTools: z.array(z.any()).default([]),
      seatPackages: z.array(z.any()).optional(),
      seatId: z.number().optional(),
    }),
    ...bound,
    actions: { run: hearing("numbered") },
  });

  /** Breaks one rule: declares `writtenBy` optional, so an entry can name nobody. */
  const looseAttributionFlow = defineFlow({
    kind: "loose-attribution",
    cardinality: "collection",
    configSchema: workerConfigSchema(),
    session: workers.session(),
    resources: {
      ...workers.resources,
      notes: defineResourceCollection({
        pattern: "loose-notes/*",
        scope: "org",
        stateSchema: z.object({
          text: z.string(),
          writtenBy: z.object({ userId: z.string().min(1), workerId: z.string().min(1).optional() }).optional(),
        }),
      }),
    },
    actions: { run: hearing("loose-attribution") },
  });

  return {
    registered: { triage: triageFlow, coordinator: coordinatorFlow, sharer: sharerFlow, "org-keeper": orgKeeperFlow },
    broken: { doorless: doorlessFlow, numbered: numberedFlow, "loose-attribution": looseAttributionFlow },
  };
}

const noteInput = z.object({ key: z.string(), text: z.string() });
const notes = sharedResource("team-notes/*", { text: z.string() });
const note = z.object({ note: z.string() });

const board = defineResourceCollection({
  pattern: "team-board/*",
  scope: "org",
  stateSchema: z.object({ text: z.string() }),
});
