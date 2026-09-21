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
 * `document:` is **required**, which the pentest lab's kind could not do — it
 * predates FIX-1367, whose probe-based admission silently skipped a kind that
 * declared any required setting. Admission is now the flow's own closed schema,
 * so a seat that names no document is refused at the mint rather than at its
 * first read.
 */

import { handler } from "@flow-state-dev/core";
import type { BlockContext } from "@flow-state-dev/core/types";
import { workerConfigSchema } from "@flow-state-dev/workforce";
import { z } from "zod";

/** Where a seat's resolved skill union arrives, spelled exactly as the factory imposes it. */
export const SEAT_SKILLS_KEY = "seatSkills";

/** The lab's own setting: which file-declared document this seat reads, by its minted ref. */
export const DOCUMENT_KEY = "document";

/** The public entry a check reads a seat's own configuration through. */
export const INSPECT_ENTRY = "inspect";

/**
 * What a seat of either kind configures.
 *
 * `.min(1)` and required: the ref is what a seat reads its brief by, and a seat
 * with nothing to read passes every isolation check trivially.
 */
export function seatSettingsSchema() {
  return workerConfigSchema().extend({
    [DOCUMENT_KEY]: z.string().min(1),
  });
}

/** The parts of the bag this module reads where the bag's type is erased. */
export interface SeatConfig {
  instructions?: string;
  document: string;
  seatSkills: Array<{ name: string; skillMd: string }>;
}

/**
 * What a seat can see of itself, read from inside a running block.
 *
 * Every field came off the seat's own config bag or through the resource
 * surface at run time — never off `hireWorkforce`'s return value, which would
 * only prove the mint agrees with itself.
 */
export const seatFactsSchema = z.object({
  /** The seat's own instance id, off `ctx.flow.id`. */
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
 * Read what this seat can see of itself.
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
 */
export const readOwnFacts = handler({
  name: "devforce-seat-facts",
  inputSchema: z.object({}).optional(),
  outputSchema: seatFactsSchema,
  execute: async (_input: unknown, ctx: BlockContext): Promise<SeatFacts> => {
    const config = ctx.flow.config as unknown as SeatConfig;
    const seat = (ctx.flow as { id?: string }).id ?? "<unknown>";

    const ref = ctx.resources[config.document];
    if (ref === undefined) {
      throw new Error(
        `seat "${seat}" names document "${config.document}", which is not installed on this ` +
          `flow. Installed: ${Object.keys(ctx.resources).join(", ")}`,
      );
    }
    const document = await (ref as { readContent(): Promise<string | null> }).readContent();
    const skills = config.seatSkills ?? [];

    return {
      seat,
      instructions: config.instructions ?? "",
      documentRef: config.document,
      document: document ?? "",
      skillNames: skills.map((skill) => skill.name),
      skillBodies: Object.fromEntries(skills.map((skill) => [skill.name, skill.skillMd])),
    };
  },
});
