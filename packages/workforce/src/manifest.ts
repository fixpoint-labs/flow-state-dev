/**
 * The worker record — the shape both halves of the on-disk workforce agree on,
 * and the wordings they refuse a file with.
 *
 * Declared once here, node-free, so the loader (which reads folders) and the
 * seat factory (which reads nothing) never hold two spellings of one record —
 * and, for the same reason, so a refusal reads the same whichever door a file
 * arrives at.
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
 * The second setting name the seat factory imposes: where a seat's resolved
 * skill set arrives in its flow's settings bag.
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
