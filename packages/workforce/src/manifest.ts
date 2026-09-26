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
import type { InstanceOwnerPin } from "@flow-state-dev/core/types";

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
  /**
   * The instructions this seat's TEAM wrote — its team's, never its own.
   *
   * Filled by the joined loader (`readWorkforce`) from the team's
   * {@link TEAM_MD}, and **absent on a hand-built record**, which is the
   * difference between "this seat's team wrote none" and "nobody read a team
   * file for it" — the same shape and the same story as {@link
   * WorkerManifest.skills}.
   *
   * Absent rather than empty when a team wrote nothing, all the way down: it
   * reaches a hired flow as `config.teamInstructions` ({@link
   * TEAM_INSTRUCTIONS_KEY}) only when it is here, so a team with no file
   * changes nothing about the bag its seats receive.
   *
   * Never merged with {@link WorkerManifest.body}. Two layers that cannot be
   * told apart at the seam are one layer, and a kind that wants only the seat's
   * own charter must be able to have it.
   */
  teamInstructions?: string;
  /**
   * The packages this seat can reach — the org's library, its team's library,
   * and the ones in its own folder — in that order.
   *
   * Filled by the joined loader (`readWorkforce`), and **absent when none are
   * in reach**, as on a hand-built record. Reach is not holding: the hire
   * gives the seat every package at the `worker` level and, from the two
   * libraries, only the ones its file names in `packages:`.
   */
  packages?: PackageManifest[];
  /**
   * Set by a hire row, never by a `WORKER.md`. Absent, the minted instance
   * stays shared — a file-declared seat and a shared app flow. Present, the
   * mint copies it onto the instance, and registration stores it as the pin.
   * Not parsed from {@link WorkerManifest.id}.
   */
  ownerPin?: InstanceOwnerPin;
}

/**
 * One team, as read off disk.
 *
 * The record {@link TEAM_MD} produces, and the fourth in this dialect beside
 * {@link WorkerManifest}, {@link ChannelManifest} and {@link ResourceDoc}.
 * Declared here with them for the reason they are: node-free, so the reader
 * (which reads folders) and the join (which reads nothing) never hold two
 * spellings of one record.
 *
 * A team is not a seat. This record declares no flow, reaches no `hireWorkforce`
 * roster, and mints no address — it carries what a team says about itself and
 * what it tells its seats, and nothing else.
 */
export interface TeamManifest {
  /** The team's id, which is its folder's name. Derived, never declared. */
  id: string;
  /**
   * What this team is, in one line — its file's required `description`.
   *
   * Surfaced here rather than parsed and discarded. **Nothing reads it yet**:
   * no roster view exists, and building one is not this convention's job.
   * Required all the same, because the dialect requires it on every file an
   * author writes by hand, and validating a value only to drop it is worse than
   * either reading it or not asking for it.
   */
  description: string;
  /** Frontmatter exactly as written — keys as the file spelled them, values uninterpreted. */
  declared: Record<string, unknown>;
  /**
   * What every seat on this team is told: the file's Markdown body, verbatim.
   *
   * **Absent when the body is empty or whitespace**, never `""`. Whitespace is
   * not instructions — the rule the seat factory already applies one level up,
   * where an empty body handed over as a setting turned every thin seat into a
   * failed hire.
   */
  instructions?: string;
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
 * Filled from the team's own {@link TEAM_MD}: the loader reads that file once
 * per team, joins its body onto every worker record under it, and the factory
 * imposes this key for the records that carry one. A kind reading it for a
 * seat whose team wrote none gets `undefined` — the key is ABSENT, never an
 * empty string, so "this team said nothing" is not a value every team without
 * a file hands its seats.
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
 * The contract declared this key before anything filled it, and that was the
 * point: a kind composes the contract once and did not have to change again
 * when the team-level file arrived to fill it.
 */
export const TEAM_INSTRUCTIONS_KEY = "teamInstructions";

/**
 * The document that describes a team — the one name in this convention an
 * author types, and the architect's locked file contract.
 *
 * Optional, unlike every other file in this dialect: a team folder with no
 * {@link TEAM_MD} is not a problem of any kind, and its seats hire exactly as
 * they do without one.
 */
export const TEAM_MD = "TEAM.md";

/**
 * The file that makes a folder under `packages/` a package — the one name in
 * that convention an author types.
 *
 * Required, unlike {@link TEAM_MD}: a folder in `packages/` is a package or a
 * mistake, and a package with no file is refused rather than read as empty.
 */
export const PACKAGE_MD = "PACKAGE.md";

/**
 * One package, as read off disk: a `packages/<name>/` folder's `PACKAGE.md`.
 *
 * Carries the package's text and where it sits. Its blocks are not here: code
 * is found by `fsdev gen` and arrives at the hire on the generated
 * `packageBlocks` map, keyed by {@link PackageManifest.path}, which is where the
 * two halves meet.
 */
export interface PackageManifest {
  /** The folder's name — what a worker's `packages:` takes it by. */
  name: string;
  /**
   * The folder's slash-separated path under the workforce root — for example
   * `teams/support/packages/escalation`. The package's address, and the key its
   * blocks sit under on `packageBlocks`.
   */
  path: string;
  /** Where the folder sits: the org's library, a team's library, or one worker's own folder. */
  level: "org" | "team" | "worker";
  /** The team whose folder holds it. Set at the `team` and `worker` levels. */
  team?: string;
  /** The worker id (`<team>.<worker>`) whose folder holds it. Set at the `worker` level only. */
  worker?: string;
  /** The file's required `description` — a label for people, never handed to a model. */
  description: string;
  /**
   * The file's body, verbatim. **Absent when it is empty or whitespace**, never
   * `""`, for the reason a team's instructions are: whitespace is not
   * instructions.
   */
  instructions?: string;
}

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
  `declares \`${TEAM_INSTRUCTIONS_KEY}:\`, which is not a setting any file declares. ` +
  `A team's instructions are the body of its ${TEAM_MD}, and reading them is the loader's job.`;

/**
 * The keys a {@link TEAM_MD} may not declare, each with why.
 *
 * Three, and they are refused for three different reasons rather than one:
 *
 * - `id` is the folder's name. A derived field frontmatter can overwrite was
 *   never derived.
 * - `flow` would read this file as a second place a seat can be declared. A
 *   second seat list is the one failure this convention refuses outright — a
 *   team file describes a team, and every seat is a `WORKER.md`.
 * - `instructions` is what the body already is, and two sources for one value
 *   have no precedence rule. The same collision the seat factory refuses rather
 *   than resolves.
 *
 * {@link TEAM_INSTRUCTIONS_KEY} is refused too, and deliberately not from this
 * list: it is refused at three doors from one constant, and its wording is
 * {@link REFUSED_TEAM_INSTRUCTIONS_KEY_MESSAGE}, shared with them.
 */
const REFUSED_TEAM_KEYS: ReadonlyArray<{ key: string; because: string }> = [
  {
    key: "id",
    because: `A team's id is its folder's name.`,
  },
  {
    key: "flow",
    because:
      `A ${TEAM_MD} describes a team, not a seat — every seat is a WORKER.md in ` +
      `this team's \`workers/\` folder.`,
  },
  {
    key: INSTRUCTIONS_KEY,
    because:
      `A team's instructions are this file's body, and there is no precedence rule ` +
      `between the two. Write them below the frontmatter.`,
  },
];

/**
 * Say why a `TEAM.md`'s declaration is refused, or `undefined` when nothing is.
 *
 * Names no subject — the caller supplies the path it read, exactly as
 * {@link REFUSED_PERSONA_KEY_MESSAGE} and {@link refusedDeclarationMessage} do.
 *
 * The imposed key is checked here rather than left to the caller so that one
 * function answers for the whole file, and it reads {@link
 * TEAM_INSTRUCTIONS_KEY} rather than a literal: its spelling is not locked, and
 * a literal here would keep refusing a name the framework had since renamed —
 * leaving this door open with nothing said, in the file that looks most like
 * the right place to write it.
 */
export function refusedTeamDeclarationMessage(
  declared: Record<string, unknown>,
): string | undefined {
  if (Object.hasOwn(declared, TEAM_INSTRUCTIONS_KEY)) {
    return REFUSED_TEAM_INSTRUCTIONS_KEY_MESSAGE;
  }

  for (const { key, because } of REFUSED_TEAM_KEYS) {
    if (Object.hasOwn(declared, key)) {
      return `declares \`${key}:\`, which is not a setting a team declares. ${because}`;
    }
  }

  return undefined;
}

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
 * `packages` — the `WORKER.md` key a worker takes packages from its team's or
 * the org's library with, by name: `packages: [escalation]`.
 *
 * Read by the hire step and never handed to a kind as a setting, like
 * `resources:`. A package in the worker's own folder needs no line here.
 */
export const PACKAGES_KEY = "packages";

/**
 * `seatPackages` — imposed by the seat factory, and where the packages a seat
 * HOLDS arrive in its flow's settings bag: each one's name, address,
 * instructions and blocks.
 *
 * **Imposed only on a seat that holds at least one package**, the way
 * `teamInstructions` is imposed only on a seat whose team wrote some. A seat
 * holding none carries no such key, so every kind that hires today keeps
 * hiring; a hand-rolled kind that has not declared it is refused, by name, the
 * first time a seat of it holds a package, rather than dropping the package.
 *
 * Its own key rather than {@link SEAT_TOOLS_KEY}, whose meaning is what the
 * seat's `tools:` line named. What a kind does with a held package is the
 * kind's: the built-in `agent` kind puts the instructions in the prompt after
 * the team's and the seat's own, and offers the blocks when the seat wrote no
 * `tools:` line.
 */
export const SEAT_PACKAGES_KEY = "seatPackages";

/**
 * The one wording for {@link SEAT_PACKAGES_KEY}, shared by every door that
 * refuses an authored one. Names no subject — the caller supplies what it can
 * name.
 */
export const REFUSED_SEAT_PACKAGES_KEY_MESSAGE =
  `declares \`${SEAT_PACKAGES_KEY}:\`, which is not a setting a worker declares. ` +
  `A seat holds the packages in its own \`${PACKAGES_KEY}/\` folder and the ones its ` +
  `\`${PACKAGES_KEY}:\` line names, and reading them is the loader's job.`;

/**
 * `seatId` — imposed by the seat factory on every record: the seat's own id,
 * the record id a team's `members:` lists.
 *
 * A block cannot see which seat it runs in, because core keeps the flow's id
 * off the block context. The seat's settings are the one per-seat fact a block
 * can read, so this is how a block inside a seat signs what it files or posts
 * (`ctx.flow.config.seatId`).
 *
 * **Imposed on every record, never authored.** Refused by name at every door
 * for the sharpest version of `seatSkills`'s reason: every composed kind
 * declares it, so an authored one would be accepted and the seat could sign as
 * any other seat on the roster.
 */
export const SEAT_ID_KEY = "seatId";

/**
 * The one wording for {@link SEAT_ID_KEY}, shared by every door that refuses
 * an authored one. Names no subject — the caller supplies what it can name.
 */
export const REFUSED_SEAT_ID_KEY_MESSAGE =
  `declares \`${SEAT_ID_KEY}:\`, which is not a setting a worker declares. ` +
  `A seat's id is its record's id, and the hire step hands it to every seat.`;

/**
 * The one wording for a package block that declares its own resources — the
 * package form of {@link colocatedResourceMessage}, refused for its reason: a
 * package is held per seat and a store is the kind's.
 */
export const packageResourceMessage = (packagePath: string, key: string, accessors: string[]): string =>
  `holds package "${packagePath}", whose block "${key}" declares ` +
  `${accessors.map((a) => `"${a}"`).join(", ")}. A package is held by one seat at a time and a ` +
  `store is the kind's, so there is nowhere to install it that would not also install it for ` +
  `every other seat of this kind. Declare the store on the kind ` +
  `(\`defineAgentWorkerFlow({ uses })\`) and let the block use it.`;

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
  /**
   * The absolute path the record was read from.
   *
   * **Absent on a hand-built record**, which is the difference between "read
   * from this file" and "there was no file" — the same shape
   * {@link WorkerManifest.skills} uses, and the reason this is optional rather
   * than `""`.
   *
   * A `references/` document needs it: its content is served FROM the file on
   * every execution context rather than copied into a stored row, so the path
   * is the thing the install half installs. A `resources/` document carries it
   * too — the walk knows where it read, and one walk that records provenance
   * beats two walks that disagree about whether to — but nothing consumes it
   * there, and {@link ResourceDoc.body} stays that document's source.
   */
  filePath?: string;
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
 * Say why a document's `prefetchMode` is refused, or `undefined` when it is not.
 *
 * Shared by both doors' refusals rather than written twice. The two differ in
 * which KEYS they derive — that difference is real and stays two loops — but
 * `prefetchMode` is refused for one reason that has nothing to do with the slot
 * a file sits in: a file-declared resource is installed at flow level either
 * way, so both doors were carrying the same sentence.
 */
function refusedPrefetchModeMessage(
  declared: Record<string, unknown>,
): string | undefined {
  if (declared["prefetchMode"] !== REFUSED_PREFETCH_MODE) return undefined;
  return (
    `declares \`prefetchMode: "${REFUSED_PREFETCH_MODE}"\`, which a file-declared ` +
    `resource cannot be: it is installed at flow level, and a flow-level declaration ` +
    `has no per-block load trigger to load it on. Drop the key.`
  );
}

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

  return refusedPrefetchModeMessage(declared);
}

/**
 * The three settings a REFERENCE derives on top of
 * {@link DERIVED_RESOURCE_KEYS}, and therefore refuses to let a file declare.
 *
 * All three are the seal, and the seal is the folder's rather than the file's.
 * That is the whole difference between this convention and "rename the folder
 * and set `writable: false` in each file": a key an author writes is a key an
 * author forgets, and one forgotten key puts the document back on the
 * seed-then-evolve path where a write shadows the file permanently.
 *
 * - `writable` — gates code. Refused at **either value**: agreeing with the
 *   install half is still a second place the same fact lives, and the next
 *   author to read the file cannot tell a load-bearing key from a decorative
 *   one.
 * - `llmWritable` — gates the model's own write tool. Two doors on one
 *   document; closing one would leave a mode that holds against the
 *   implementer and not against the model.
 * - `render` — the per-read transform that strips the file's frontmatter, so a
 *   reader gets the document and not the YAML above it. A file that supplied
 *   its own would serve its own frontmatter, or throw at read time when a YAML
 *   scalar is called as a function.
 * - `flowIsolation` — a per-instance copy of a document whose content is the
 *   same file for everyone is incoherent: nothing can write the copies, so they
 *   would differ from each other never and from the file always. It also has a
 *   second cost, which is why it is refused rather than ignored — an isolated
 *   resource stores under a flow-qualified bucket, so allowing it would make
 *   "where does this reference's content live" a per-file question, and the
 *   migration in `../clear-shadowed-references` could no longer name one place
 *   to look.
 *
 * **Deliberately NOT added to {@link DERIVED_RESOURCE_KEYS}.** A `resources/`
 * document may legitimately declare `writable:` or `flowIsolation:` — that path
 * is unchanged, and widening the shared list would break it.
 */
export const DERIVED_REFERENCE_KEYS = [
  ...DERIVED_RESOURCE_KEYS,
  "writable",
  "llmWritable",
  "render",
  "flowIsolation",
] as const;

/**
 * Say why a REFERENCE's declaration is refused, or `undefined` when nothing is.
 *
 * {@link refusedDeclarationMessage}'s rule over the wider
 * {@link DERIVED_REFERENCE_KEYS} set, with the same two-door reason for
 * existing and the same "names no subject" contract: the loader supplies the
 * file, the install half supplies the ref.
 *
 * @param declared The file's frontmatter, uninterpreted.
 * @returns The reason, ready to be prefixed with what the caller can name.
 */
export function refusedReferenceDeclarationMessage(
  declared: Record<string, unknown>,
): string | undefined {
  for (const key of DERIVED_REFERENCE_KEYS) {
    if (!Object.hasOwn(declared, key)) continue;
    return (
      `declares \`${key}:\`, which is a setting the \`references/\` convention derives from ` +
      `where the file sits, not one a reference declares. A reference is read from its file ` +
      `and nothing can write it — the folder carries that, so no file has to ask for it and ` +
      `no file can turn it off. Drop the key, or move this document to \`resources/\`, where ` +
      `it seeds a row and can be written.`
    );
  }

  return refusedPrefetchModeMessage(declared);
}
