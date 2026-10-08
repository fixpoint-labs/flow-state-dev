/**
 * What both of this lab's kinds accept in their settings bag, and the one block
 * that reads a seat's own view of itself.
 *
 * Shared between `em` and `coder` on purpose. What separates the two kinds is
 * the only thing this lab's claims are about — one declares a task entry with a
 * harness slot in it, the other declares no harness at all — and duplicating a
 * zod schema twice would put that difference next to noise. **This is not a
 * kind barrel**: nothing here defines a flow, and each kind still lives in its
 * own file under `workforce/flows/workers/`, which is W3's authoring path.
 *
 * `workerConfigSchema()` is composed rather than hand-declared, so a key added
 * to the admission contract arrives here for free instead of refusing at boot.
 * `document:` is optional in the schema, because each kind runs as one copy
 * shared by every worker on it, and that copy carries no worker's settings.
 * The lab refuses a worker of either kind that names none when it opens
 * (`openLab`), so a seat with nothing to read never boots.
 *
 * A worker's own settings are read per turn, from the worker the session
 * names ({@link seatOf}), never from `ctx.flow.config`.
 */

import { handler } from "@flow-state-dev/core";
import type { BlockContext } from "@flow-state-dev/core/types";
import { workerConfigSchema, type WorkerInstallation } from "@flow-state-dev/workforce";
import { z } from "zod";

/** Where a seat's resolved skill union arrives, spelled exactly as the factory imposes it. */
export const SEAT_SKILLS_KEY = "seatSkills";

/** The lab's own setting: which file-declared document this seat reads, by its minted ref. */
export const DOCUMENT_KEY = "document";

/** The public entry a check reads a seat's own configuration through. */
export const INSPECT_ENTRY = "inspect";

/**
 * The EM seat's asking door: pause on a person's approval, then file and run
 * the board. Here rather than in `em.mts` so the raise step (`ask.mts`) can
 * name it without depending on the worker flow module.
 */
export const ASK_ENTRY = "askToFile";

/** The component item that entry puts its facts on, for a caller reading the stream. */
export const SEAT_FACTS_COMPONENT = "devforce-seat-facts";

/**
 * What a seat of either kind configures.
 *
 * `.min(1)`: the ref is what a seat reads its brief by, and a seat with
 * nothing to read passes every isolation check trivially. Optional only so
 * the shared copy, which carries no worker's settings, can be built.
 */
export function seatSettingsSchema() {
  return workerConfigSchema().extend({
    [DOCUMENT_KEY]: z.string().min(1).optional(),
  });
}

/** The parts of the bag this lab reads where the bag's type is erased. */
export interface SeatConfig {
  /** The seat's own id, imposed by the hire and never authored. */
  seatId?: string;
  instructions?: string;
  document?: string;
  seatSkills: Array<{ name: string; skillMd: string }>;
}

/** The worker a turn runs as: its id and its own settings. */
export interface Seat {
  id: string;
  config: SeatConfig;
}

/** How a block finds the worker its turn runs as. */
export type SeatOf = (ctx: BlockContext) => Promise<Seat>;

/**
 * The worker a turn on `kind` runs as, loaded through the installation: the
 * one the session names, checked, with its settings as its own file declared
 * them.
 */
export function seatOf(installation: WorkerInstallation, kind: string): SeatOf {
  return async (ctx) => {
    const worker = await installation.resolveWorker(ctx as never, kind);
    return { id: worker.id, config: worker.config as unknown as SeatConfig };
  };
}

/**
 * What a seat can see of itself, read from inside a running block.
 *
 * Every field came off the worker the session names, loaded on this turn, or
 * through the resource surface at run time — never off what the lab handed
 * the installation, which would only prove the lab agrees with itself.
 */
export const seatFactsSchema = z.object({
  /** The worker the session names, as the turn loaded it. */
  seat: z.string(),
  /** Its own `WORKER.md` body, as `instructions`. */
  instructions: z.string(),
  /** The ref its own frontmatter named. */
  documentRef: z.string(),
  /** That document's body, read through `ctx.resources`. */
  document: z.string(),
  /** Its exact skill union, by name. */
  skillNames: z.array(z.string()),
  /** Each skill's whole `SKILL.md`, so two same-named folders could be told apart. */
  skillBodies: z.record(z.string()),
});

export type SeatFacts = z.infer<typeof seatFactsSchema>;

/**
 * Build the block that reads what this seat can see of itself.
 *
 * **The org-less read being refused is the whole of BR-17.** Every
 * file-declared document is org-scoped (`resourcesFromDocs` sets
 * `scope: "org"`), and organization identity is unconditional — nothing
 * declares it and nothing can opt out — so an org-less request is refused
 * before it runs rather than running and resolving every document as
 * unregistered. That older failure read as "the document was empty", which is
 * exactly the silent pass this lab exists to refuse.
 *
 * It is a DIRECT read: it writes nothing anywhere, which is what lets the
 * never-woken `reviewer` seat be both silent and evidenced.
 *
 * The facts are also put on the request's stream as a **stream-only**
 * `component` item. An HTTP caller has no other way to read them: the engine
 * carries a handler's return value only on trace items, which a client never
 * sees and which are not captured at all when trace observability is off.
 * `transient: true` means the item is never persisted, so the paragraph above
 * still holds.
 */
export function defineReadOwnFacts(seatOfTurn: SeatOf) {
  return handler({
    name: "devforce-seat-facts",
    inputSchema: z.object({}).optional(),
    outputSchema: seatFactsSchema,
    execute: async (_input: unknown, ctx: BlockContext): Promise<SeatFacts> => {
      const { id: seat, config } = await seatOfTurn(ctx);
      if (config.document === undefined) {
        throw new Error(`seat "${seat}" names no document, so it has nothing to read.`);
      }

      const ref = ctx.resources[config.document];
      if (ref === undefined) {
        throw new Error(
          `seat "${seat}" names document "${config.document}", which is not installed on this ` +
            `flow. Installed: ${Object.keys(ctx.resources).join(", ")}`,
        );
      }
      const document = await (ref as { readContent(): Promise<string | null> }).readContent();
      const skills = config.seatSkills ?? [];

      const facts: SeatFacts = {
        seat,
        instructions: config.instructions ?? "",
        documentRef: config.document,
        document: document ?? "",
        skillNames: skills.map((skill) => skill.name),
        skillBodies: Object.fromEntries(skills.map((skill) => [skill.name, skill.skillMd])),
      };
      ctx.emit.component(SEAT_FACTS_COMPONENT, facts, { transient: true });
      return facts;
    },
  });
}
