/**
 * The on-disk records — the shapes the halves of a file convention agree on,
 * and the wordings they refuse a file with.
 *
 * Declared once here, node-free, so the loaders (which read folders) and the
 * consumers that turn a record into something runnable (which read nothing)
 * never hold two spellings of one record — and, for the same reason, so a
 * refusal reads the same whichever door a file arrives at. A worker is a
 * `WorkerManifest`; a channel is a `ChannelManifest`; a file-declared document
 * is a `ResourceDoc`.
 */

import type { InitialSkill } from "@flow-state-dev/core";

/**
 * One worker, as declared on disk or hand-built. Declared once, in this module; the loader
 * returns this type rather than a second one of its own.
 */
export interface WorkerManifest {
  /**
   * Team-qualified identity, "<teamId>.<name>" — e.g. "engineering.lead". The whole
   * identity and the flow address.
   * Dot-joined, not slash-joined: a "/" here is unroutable (decision 2).
   * Minted once, by the loader, in one helper — and the record's only identity field.
   */
  id: string;
  /** Frontmatter exactly as written — keys as the file spelled them, values uninterpreted. */
  declared: Record<string, unknown>;
  /**
   * The worker's instructions: Markdown body verbatim, frontmatter removed.
   * Empty for a thin seat; reaches a hired flow as `config.instructions`.
   */
  body: string;
  /**
   * The skills this seat can see — the org ∪ team ∪ own-folder union, already
   * resolved, in level order.
   *
   * Filled by the joined loader (`readWorkforce`) and **absent on a hand-built
   * record**, which is the difference between "this seat has no skills" and
   * "nobody read any folders for it". A non-empty set reaches a hired flow as
   * `config.seatSkills` ({@link SEAT_SKILLS_KEY}), the same way a body reaches
   * it as `instructions`.
   *
   * Carried on the record rather than looked up at run time because a running
   * block deliberately cannot see which instance it is: the record is what the
   * mint reads, so the record is where a per-seat set has to ride.
   */
  skills?: InitialSkill[];
}

/**
 * One channel, as declared on disk or hand-built.
 *
 * The same three-field record a worker is made of, and deliberately so: the
 * loader that reads a `CHANNEL.md` returns this type rather than declaring a
 * second one. Declared here, beside {@link WorkerManifest}, for the reason that
 * one is — node-free, so the binder (which reads nothing) and the reader (which
 * reads folders) never hold two spellings of one record.
 */
export interface ChannelManifest {
  /**
   * Team-qualified identity, "<teamId>.<name>" — e.g. "engineering.standup".
   * The channel's whole identity, and literally its session id. A frontmatter
   * `id:` cannot reach it: the record's shape is what carries identity.
   */
  id: string;
  /** Frontmatter exactly as written — keys as the file spelled them, values uninterpreted. */
  declared: Record<string, unknown>;
  /** The channel's charter: Markdown body verbatim, frontmatter removed. */
  body: string;
}

/**
 * A key a `CHANNEL.md` may not declare, refused by name wherever a record is
 * read.
 *
 * `system` is set from the declaration path, never from a file. Refused at this
 * package's binder as well as at the reader, because a hand-built record never
 * passes the reader.
 */
export const REFUSED_SYSTEM_KEY = "system";

/**
 * The one wording for {@link REFUSED_SYSTEM_KEY}. Names no subject — the caller
 * supplies what it can name.
 */
export const REFUSED_SYSTEM_KEY_MESSAGE =
  `declares \`${REFUSED_SYSTEM_KEY}:\`, which is not a setting a channel declares. ` +
  `Where a channel is declared is what decides it.`;

/**
 * The single setting name the seat factory imposes: where a worker's body
 * arrives in its flow's settings bag.
 *
 * Declared here rather than in the factory because both halves of the package
 * check for it — the factory imposes it, and the loader refuses the one key
 * that is not a spelling of it — and the same reason the record shape lives
 * here applies: two spellings of one key is the bug.
 */
export const INSTRUCTIONS_KEY = "instructions";

/**
 * A key a worker may not declare, refused by name wherever a record is read.
 *
 * `persona` is reserved for a separate concept and is deliberately not an alias
 * for {@link INSTRUCTIONS_KEY}. Accepting it as one would leave two spellings of
 * a worker's instructions, and ignoring it would be worse: a flow whose
 * `configSchema` declares `persona` takes the key happily, so a record spelling
 * it that way would hire, carry no `instructions`, and say nothing about it.
 */
export const REFUSED_PERSONA_KEY = "persona";

/**
 * `seatSkills` — imposed by the seat factory on every record, and where a
 * seat's resolved skill set arrives in its flow's settings bag.
 *
 * Spelled `seatSkills` rather than `skills` because the built-in kind's bag
 * already carries an author-written `skills` object (the always-on list and the
 * activate-tool switch). One key that is sometimes authored and sometimes
 * imposed is the `instructions`-versus-body collision again, and that one is
 * refused rather than resolved.
 *
 * Declared here, beside {@link INSTRUCTIONS_KEY}, for the same reason: the
 * loader fills the record, the factory imposes the key, and both doors refuse
 * the one spelling that is not theirs to accept. Two doors refusing two
 * spellings is the bug this constant prevents.
 */
export const SEAT_SKILLS_KEY = "seatSkills";

/**
 * `teamInstructions` — where a seat's TEAM-level instructions will arrive in
 * its flow's settings bag.
 *
 * **Nothing imposes it yet.** The factory imposes `instructions` and
 * `seatSkills`; this key is declared by the contract and reserved, so a kind
 * reading it today gets `undefined` however many instructions a team has
 * written. What fills it is the team-level file, which FIX-1377 reads.
 *
 * Declared here, beside {@link INSTRUCTIONS_KEY} and {@link SEAT_SKILLS_KEY},
 * because it is the same sort of thing as both — a value the framework will
 * derive from where a file sits, never one a file declares — and for
 * the same reason they are here: every door that imposes or refuses it reads
 * one spelling from one place.
 *
 * **Referenced, never re-spelled.** The doors that refuse an authored one must
 * name this constant rather than a literal, so a rename moves every refusal
 * with it instead of leaving a door open with nothing said.
 *
 * The contract declares the key ({@link workerConfigSchema}) and the doors
 * refuse an authored one from today. What FILLS it is a team's own file, which
 * FIX-1377 reads — so until that lands the key is a declared door with nothing
 * coming through it, which is the point: a kind composes the contract once and
 * does not change again when the layer arrives.
 */
export const TEAM_INSTRUCTIONS_KEY = "teamInstructions";

/**
 * The one wording for {@link TEAM_INSTRUCTIONS_KEY}, shared by every door that
 * refuses an authored one. Names no subject — the caller supplies what it can
 * name.
 *
 * Refused for the reason `seatSkills` is, and it is the sharper case of the
 * two: a flow whose `configSchema` composes the contract declares this key and
 * would take an authored one happily, so a seat could run on team instructions
 * its team never wrote — and only that seat, silently. A team's instructions
 * are its team's to write.
 */
export const REFUSED_TEAM_INSTRUCTIONS_KEY_MESSAGE =
  `declares \`${TEAM_INSTRUCTIONS_KEY}:\`, which is not a setting a worker declares. ` +
  `A seat's team-level instructions belong to its team, and reading them is the loader's job.`;

/**
 * The one wording for {@link SEAT_SKILLS_KEY}, shared by the loader and the
 * seat factory. Names no subject — the caller supplies what it can name.
 *
 * Refused for the reason `persona` is: a flow whose `configSchema` declares
 * `seatSkills` would take an authored one happily, and the seat would run with
 * a skill set nobody's folders back — silently, and only for that worker.
 */
export const REFUSED_SEAT_SKILLS_KEY_MESSAGE =
  `declares \`${SEAT_SKILLS_KEY}:\`, which is not a setting a worker declares. ` +
  `A seat's skills are the folders it can see — the org's, its team's, and its own — ` +
  `and reading them is the loader's job.`;

/**
 * The one wording for {@link REFUSED_PERSONA_KEY}, shared by the loader and the
 * seat factory so a record gets the same answer whichever one reads it.
 *
 * Written as the rule rather than as a change to it: a caller reading this has
 * a file to fix, not a history to catch up on. It names no subject, because the
 * caller supplies what it can name — the loader prefixes the file, the factory
 * the worker.
 */
export const REFUSED_PERSONA_KEY_MESSAGE =
  `declares \`${REFUSED_PERSONA_KEY}:\`, which is not a setting a worker declares. ` +
  `A worker's instructions are spelled \`${INSTRUCTIONS_KEY}:\`, and the flow's ` +
  `\`configSchema\` must declare that key too.`;

/**
 * A key a `SKILL.md` may not declare when it is read as part of a seat's set.
 *
 * A skill's scope is derived from where its folder sits — org, a team, or
 * beside a worker — so a file that declares one is contradicting the only thing
 * that actually decides it. Today `scope` is not a key the `SKILL.md` parser
 * knows, so it is preserved verbatim and never read: an author can write it, be
 * wrong about what it does, and never be told.
 *
 * Refused only at this package's door. `readSkillsDirectory` also serves roots
 * with no workforce tree around them, where there is no level and so no derived
 * scope for a file to contradict.
 */
export const REFUSED_SKILL_SCOPE_KEY = "scope";

/**
 * The one wording for {@link REFUSED_SKILL_SCOPE_KEY}. Names no subject — the
 * caller supplies the path of the file it read.
 */
export const REFUSED_SKILL_SCOPE_KEY_MESSAGE =
  `declares \`${REFUSED_SKILL_SCOPE_KEY}:\`, which is not a setting a skill declares. ` +
  `Where a skill folder sits is what decides who can see it.`;

/**
 * The one wording for a skill name that reaches a single seat from more than
 * one of the levels it reads.
 *
 * A function rather than a string because the useful part of this refusal is
 * the paths: the fix is a rename or a deletion, and an author can only make it
 * if they are told which two files are in play. It says there is no precedence
 * rule outright, because the reading most authors arrive with is that the
 * nearer level quietly wins.
 */
export const duplicateSkillNameMessage = (
  name: string,
  seat: string,
  paths: string[],
): string =>
  `Skill "${name}" reaches seat "${seat}" from ${paths.length} levels — ` +
  `${paths.join(" and ")}. Remove one: there is no precedence rule.`;

/**
 * `seatTools` — imposed by the seat factory on every record, and where the
 * blocks a seat's `tools:` resolved to **from its own levels** arrive in its
 * flow's settings bag.
 *
 * The fourth contract key, and the one that carries live blocks rather than
 * strings. A tool name in a `WORKER.md` resolves worker folder → team folder →
 * the app's catalog, first match wins; the first two resolve to a block the
 * hire step already holds, and they ride here, already resolved. The names that
 * fell through to the app's catalog stay in `tools:`, which is what the kind
 * checks its catalog against and what the delegation fence narrows a board
 * worker to.
 *
 * Spelled `seatTools` rather than `seatBlocks` because the two are different
 * things and one name for both is the collision this package refuses rather
 * than resolves: `seatBlocks` is the generated map of what a seat's folders
 * REGISTER, and this is the subset the seat's file DECLARED out of it.
 * Registration makes a name resolvable; declaration grants use.
 *
 * Declared here for the reason {@link SEAT_SKILLS_KEY} is: the factory imposes
 * it, every door refuses an authored one, and two spellings of one key is the
 * bug.
 */
export const SEAT_TOOLS_KEY = "seatTools";

/**
 * The one wording for {@link SEAT_TOOLS_KEY}, shared by every door that refuses
 * an authored one. Names no subject — the caller supplies what it can name.
 *
 * Refused for the reason `seatSkills` is: a kind composing the contract
 * declares this key and would take an authored one happily, so a seat could run
 * carrying tools no folder of its backs — and only that seat, silently.
 */
export const REFUSED_SEAT_TOOLS_KEY_MESSAGE =
  `declares \`${SEAT_TOOLS_KEY}:\`, which is not a setting a worker declares. ` +
  `A seat names its tools in \`tools:\`, and resolving each name against the blocks its ` +
  `folders register is the loader's job.`;

/**
 * The one wording for a block registered under a name its own `name` does not
 * match — the one-name rule, on either map.
 *
 * A function rather than a string because the useful part is the two spellings
 * and which of them the model would have been advertised: a seat authorizes by
 * the map's key and the generator advertises the block's own `name`, so a
 * disagreement is a seat authorizing one tool and a model calling another. The
 * caller names the map, because the two maps are refused at different doors —
 * the app's catalog when the kind is built, a seat's own when it is hired.
 */
export const oneNameMessage = (key: string, blockName: string, whichMap: string): string =>
  `${whichMap} registers "${key}", and the block under that key calls itself "${blockName}". ` +
  `One tool has one name: the file's, the map key's and the block's own must agree. ` +
  `The model would be advertised "${blockName}", so a seat authorizing "${key}" would never ` +
  `reach it. Rename the block to "${key}", or rename the file to "${blockName}".`;

/**
 * The one wording for a block that arrives on a seat's own map and declares its
 * own resources.
 *
 * A seat's folder is ONE seat's and a store is the kind's, so there is nowhere
 * to install it that does not also install it for every sibling seat of that
 * kind. Refused by name at the door, with both fixes, because the alternative
 * is the defect this epic exists to kill: the tool is hired, advertised to the
 * model, called, and its handle is simply not there.
 */
export const colocatedResourceMessage = (key: string, accessors: string[]): string =>
  `registers block "${key}" in its own folder, and that block declares ` +
  `${accessors.map((a) => `"${a}"`).join(", ")}. A seat's own folder is one seat's and a store ` +
  `is the kind's, so there is nowhere to install it that would not also install it for every ` +
  `other seat of this kind. Either declare the store on the kind ` +
  `(\`defineAgentWorkerFlow({ uses })\`), or move the block to \`workforce/blocks/\` and name ` +
  `it in this worker's \`tools:\`.`;

/**
 * One file-declared document, as read off disk or hand-built. The resources
 * convention's record, mirroring {@link WorkerManifest}'s three fields.
 *
 * Named a document rather than a manifest deliberately: `ResourceManifest` is
 * already the framework's name for the client-facing list of a session's public
 * resources over HTTP, and one term cannot carry both meanings.
 */
export interface ResourceDoc {
  /**
   * Storage-key namespace and accessor key.
   *
   * **The rule:** the ref is the document's path under the workforce root with
   * the `resources/` segment removed and a leading `org/` removed. The four
   * forms it currently produces, one per place a `resources/` slot can sit:
   *
   * - `org/resources/<name>.md` → `<name>`
   * - `teams/<teamId>/resources/<name>.md` → `teams/<teamId>/<name>`
   * - `org/workers/<worker>/resources/<name>.md` → `workers/<worker>/<name>`
   * - `teams/<teamId>/workers/<worker>/resources/<name>.md` →
   *   `teams/<teamId>/workers/<worker>/<name>`
   *
   * The rule leads and the list follows it on purpose: a level added later gets
   * its ref from the same rule rather than from a new case, so a stale list
   * costs a reader nothing the rule above it has not already told them.
   *
   * Path-joined, not dot-joined: this is the key the atlas fixes for a team
   * document, and unlike a worker id it never routes, so a `/` in it is safe.
   * Minted by the loader, in one helper.
   */
  ref: string;
  /** Frontmatter exactly as written — keys as the file spelled them, values uninterpreted. */
  declared: Record<string, unknown>;
  /** The document itself: Markdown body verbatim, frontmatter removed. */
  body: string;
}

/**
 * The settings the resources convention derives, and therefore refuses to let a
 * document declare.
 *
 * Every one of these is a field the convention itself supplies: where the
 * document is stored (`scope`), which row it is (`ref`), the shape and starting
 * value of its state, and its body. A derived field that frontmatter can
 * overwrite was never derived — carried verbatim, `ref:` silently redirects a
 * document's storage row, `content:` replaces the Markdown body, and a YAML
 * `stateSchema:` string constructs successfully and fails much later, when the
 * engine calls `safeParse` on a string.
 *
 * This is the rule the whole convention set shares — a status the framework
 * grants is derived from the path, never declared — applied to the full set a
 * convention derives rather than to one key.
 */
export const DERIVED_RESOURCE_KEYS = [
  "scope",
  "ref",
  "stateSchema",
  "default",
  "content",
  "contentFile",
  "contentTemplate",
  "contentTemplateRef",
] as const;

/**
 * The one setting a document may name but not choose freely.
 *
 * `prefetchMode: "lazy"` is not derived — it is rejected downstream. Every
 * file-declared document is installed at flow level, and `defineFlow` refuses a
 * lazy single there because a flow-level declaration has no per-block load
 * trigger. Refused here with the reason, rather than left for an app to
 * discover as a failure to boot.
 */
const REFUSED_PREFETCH_MODE = "lazy";

/**
 * Say why a document's declaration is refused, or `undefined` when nothing is.
 *
 * Checked at both doors — the loader that parses a file, and the function that
 * builds resources from records — because a `ResourceDoc[]` can be hand-built
 * and never pass the loader, the same two-door reason `hireWorkforce` has.
 *
 * Names no subject: the caller supplies what it can name, the loader the file
 * and the install half the ref, exactly as {@link REFUSED_PERSONA_KEY_MESSAGE}
 * does.
 */
export function refusedDeclarationMessage(
  declared: Record<string, unknown>,
): string | undefined {
  for (const key of DERIVED_RESOURCE_KEYS) {
    if (Object.hasOwn(declared, key)) {
      return (
        `declares \`${key}:\`, which is a setting the convention derives from where the ` +
        `file sits, not one a resource declares. Drop it, or declare this resource in ` +
        `code with defineResource() instead.`
      );
    }
  }

  if (declared["prefetchMode"] === REFUSED_PREFETCH_MODE) {
    return (
      `declares \`prefetchMode: "${REFUSED_PREFETCH_MODE}"\`, which a file-declared ` +
      `resource cannot be: it is installed at flow level, and a flow-level declaration ` +
      `has no per-block load trigger to load it on. Drop the key.`
    );
  }

  return undefined;
}
