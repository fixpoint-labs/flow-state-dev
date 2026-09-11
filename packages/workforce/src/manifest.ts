/**
 * The on-disk records — the shapes the halves of a file convention agree on,
 * and the wordings they refuse a file with.
 *
 * Declared once here, node-free, so the loaders (which read folders) and the
 * consumers that turn a record into something runnable (which read nothing)
 * never hold two spellings of one record — and, for the same reason, so a
 * refusal reads the same whichever door a file arrives at. A worker is a
 * `WorkerManifest`; a file-declared document is a `ResourceDoc`.
 */

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
}

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
 * One file-declared document, as read off disk or hand-built. The resources
 * convention's record, mirroring {@link WorkerManifest}'s three fields.
 *
 * Named a document rather than a manifest deliberately: `ResourceManifest` is
 * already the framework's name for the client-facing list of a session's public
 * resources over HTTP, and one term cannot carry both meanings.
 */
export interface ResourceDoc {
  /**
   * Storage-key namespace and accessor key — a bare `<name>` at the org level,
   * `teams/<teamId>/<name>` for a team's. Path-joined, not dot-joined: this is
   * the key the atlas fixes for a team document, and unlike a worker id it
   * never routes, so a `/` in it is safe. Minted by the loader, in one helper.
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
