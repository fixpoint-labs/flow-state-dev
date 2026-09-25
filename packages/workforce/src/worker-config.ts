/**
 * The admission contract: the five settings every hireable worker kind
 * accepts.
 *
 * Declared and imposed are different sets, and this file is where they are
 * easiest to confuse. The contract DECLARES five keys, and the seat factory
 * IMPOSES each on its own condition: `instructions` when the record has a
 * body, `teamInstructions` when the record's team wrote a `TEAM.md`,
 * `seatPackages` when the seat holds a package, and `seatSkills` and
 * `seatTools` on every record. Those last two are the
 * unconditional ones — present and empty is a real answer for a seat's skills
 * and for what its own folders register, and there is no equivalent answer for
 * a team layer, so a seat whose team wrote none carries no such key at all
 * rather than an empty string.
 *
 * A worker kind is an ordinary flow. What makes it *hireable* is that its
 * `configSchema` accepts what the factory imposes, and composing this contract
 * — `workerConfigSchema().extend({ ... })` — is how a kind does that. A kind
 * whose schema cannot take the bag refuses at the mint, by name, rather than
 * hiring and quietly running short of what its author's files declared.
 *
 * **Admission is what the schema accepts, not which function built it.** There
 * is no marker to check and deliberately so: the closed schema every mint
 * already passes is the single enforcement point, and a second "did you call
 * us" gate would be a second authority over one rule. A kind that hand-declares
 * these keys therefore hires exactly as a composed one does, which is a
 * feature. What it gives up is staying current: when a key is added here, a
 * composed kind gets it for free, and a hand-rolled one refuses — loudly, at
 * boot, naming the key — until its author adds it too.
 *
 * **Five keys, and that is the whole bag.** A kind's own settings sit at the
 * TOP LEVEL beside them, where the framework closes the set and an undeclared
 * key refuses by name. There is no nested bag for a kind's own settings: known
 * keys belong in the closed set, and genuinely open-ended data gets one
 * declared key whose own schema is a record, which is what `closeConfigSchema`
 * already tells an author to do.
 *
 * Declared beside `WorkerManifest` and imported by both halves of the package
 * for the reason the record is: the factory imposes these keys, the loaders
 * refuse the spellings that are not theirs to accept, and two spellings of one
 * key is the bug.
 */

import { z } from "zod";
import type { BlockDefinition } from "@flow-state-dev/core";
import {
  INSTRUCTIONS_KEY,
  SEAT_PACKAGES_KEY,
  SEAT_SKILLS_KEY,
  SEAT_TOOLS_KEY,
  TEAM_INSTRUCTIONS_KEY
} from "./manifest";

/**
 * One skill as it rides into the bag.
 *
 * Structural, not a second parser: the loader has already parsed every
 * `SKILL.md` that reaches here, so this checks the SHAPE arrived intact (a
 * hand-built roster is the case it catches) and leaves the contents to the
 * seeder, which parses them again where a parse failure can be reported per
 * skill.
 *
 * Declared here rather than privately inside the built-in `agent` kind, which
 * is where it used to sit: every hireable kind now receives this shape, so a
 * copy per kind would be the two-spellings bug again.
 */
export const seatSkillSchema = z
  .object({
    name: z.string().min(1),
    skillMd: z.string(),
    files: z
      .array(z.object({ path: z.string().min(1), content: z.string() }).strict())
      .optional()
  })
  .strict();

/**
 * The settings every hireable worker kind admits.
 *
 * Compose it into a kind's own schema and add that kind's settings at the top
 * level:
 *
 * ```ts
 * defineFlow({
 *   kind: "request-triage",
 *   configSchema: workerConfigSchema().extend({ desk: z.string().default("front") }),
 *   actions: { ... }
 * })
 * ```
 *
 * A fresh schema per call, not a shared constant: `.extend()` returns a new
 * object schema either way, but a kind that overrides one of these keys (the
 * built-in `agent` kind refines `seatSkills` against the app's own skill names)
 * must not be editing a value other kinds hold.
 *
 * **Reading any of it is optional.** A kind that composes the contract and
 * never looks at `seatSkills` mints and runs exactly as before; ignoring the
 * bag is not an error. The door is what is mandatory.
 */
export function workerConfigSchema() {
  return z.object({
    /**
     * The worker's own instructions — its file body, or the frontmatter key.
     *
     * Optional: a bodyless worker is a weak seat, not a failed hire. Imposed by
     * the factory only when the record's body is non-whitespace, so "no
     * instructions" is an ABSENT key rather than an empty string.
     */
    [INSTRUCTIONS_KEY]: z.string().optional(),

    /**
     * The instructions every seat on this worker's team carries — its team's,
     * not its own.
     *
     * Optional, and absent rather than empty when the team wrote none: an empty
     * layer would be a different value for every team that has no file. Two
     * values, never merged — a seat's own instructions stay at
     * {@link INSTRUCTIONS_KEY}.
     *
     * Never authored. A worker file that declares this key is refused by name
     * at every door, the same way `seatSkills` is.
     */
    [TEAM_INSTRUCTIONS_KEY]: z.string().optional(),

    /**
     * The skills this seat can see — the org ∪ team ∪ own-folder union the
     * loader resolved for it, in level order.
     *
     * **Imposed by the factory on every record, never authored**, and present
     * even when it is empty: present-and-empty is the answer for *nothing to
     * give*, and the bag is handed over all the same. A worker file that
     * declares `seatSkills:` is refused by name at both doors; see
     * `manifest.ts`.
     *
     * Spelled `seatSkills` rather than `skills` because the built-in kind's bag
     * already carries an author-written `skills` switch object, and one key
     * that is sometimes authored and sometimes imposed is the collision this
     * package refuses rather than resolves.
     */
    [SEAT_SKILLS_KEY]: z.array(seatSkillSchema).default([]),

    /**
     * The blocks this seat's `tools:` resolved to **from its own levels** — its
     * own `blocks/` folder, then its team's — already resolved, in the order
     * the file named them.
     *
     * **Imposed by the factory on every record, never authored**, and present
     * even when empty, exactly as {@link SEAT_SKILLS_KEY} is. A worker file
     * that declares `seatTools:` is refused by name.
     *
     * The one contract key that carries live blocks rather than strings. It is
     * NOT the seat's registry: a folder REGISTERS a name, and the file's
     * `tools:` is what grants its use, so what rides here is the intersection
     * — the subset of the registry the seat actually declared. Names that fell
     * through to the app's catalog stay in the kind's own `tools` setting.
     */
    [SEAT_TOOLS_KEY]: z.array(seatToolSchema).default([]),

    /**
     * The packages this seat holds — the ones in its own `packages/` folder,
     * then the ones its `packages:` line took from its team's or the org's
     * library — each with its instructions and its blocks.
     *
     * **Imposed only when the seat holds at least one**, and absent otherwise,
     * the way {@link TEAM_INSTRUCTIONS_KEY} is. Never authored: a worker file
     * that declares `seatPackages:` is refused by name.
     *
     * What to do with it is the kind's. The built-in `agent` kind renders each
     * package's instructions after the team's and the seat's own, and offers
     * its blocks as tools when the seat wrote no `tools:` line. A kind that
     * composes the contract and never reads it hires and runs; its seats'
     * packages then simply do nothing.
     */
    [SEAT_PACKAGES_KEY]: z.array(seatPackageSchema).optional()
  });
}

/**
 * One already-resolved block as it rides into the bag.
 *
 * Structural and shallow, like {@link seatSkillSchema} and for its reason: the
 * value is a live `BlockDefinition` the hire step took off a map the app
 * imported, so this checks the shape arrived intact rather than re-deriving
 * what a block is. Anything stricter would be a second definition of a block
 * beside `@flow-state-dev/core`'s, and anything that TRANSFORMED would change
 * the bag — which `defineFlow` refuses for a block's `flowConfigSchema`.
 */
export const seatToolSchema = z.custom<BlockDefinition<any, any>>(
  (value) =>
    typeof value === "object" &&
    value !== null &&
    typeof (value as { name?: unknown }).name === "string",
  { message: "must be a block definition" }
);

/**
 * One held package as it rides into the bag. Structural, like
 * {@link seatSkillSchema}: the hire built it from records the loader already
 * validated.
 */
export const seatPackageSchema = z
  .object({
    /** The package's folder name. */
    name: z.string().min(1),
    /** Its address under the workforce root, e.g. `teams/support/packages/escalation`. */
    path: z.string().min(1),
    /** Its `PACKAGE.md` body. Absent when the body is empty. */
    instructions: z.string().optional(),
    /** Its blocks, in name order. Empty for an instructions-only package. */
    tools: z.array(seatToolSchema)
  })
  .strict();

/**
 * What a hireable kind receives, as a type — the parsed shape of
 * {@link workerConfigSchema}.
 *
 * A kind that extends the contract gets its own inferred config; this is the
 * part every kind shares, and what a helper written against any worker's
 * settings should take.
 */
export type WorkerConfig = z.infer<ReturnType<typeof workerConfigSchema>>;
