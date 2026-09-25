/**
 * The seat factory: a worker record becomes one addressable, configured copy of
 * a flow the app already defined.
 *
 * The design fact the rest of this file follows from: the flow's own closed
 * `configSchema` is the only gatekeeper. This module reads `flow` and
 * `description` and hands over everything else — a worker's instructions
 * included, as one setting, `instructions`.
 *
 * **A bag goes to every record, and every record meets the kind's schema.**
 * There is no probe of what a kind happens to declare and no thin record that
 * mints without being admitted, because the one silent branch a probe has —
 * *this kind did not declare the key, so say nothing* — is exactly the failure
 * this step exists to remove. A kind whose schema cannot take that bag refuses,
 * loudly, for the whole roster, at boot — and composing `workerConfigSchema()`
 * is how a kind makes sure it can.
 *
 * What the kind's probed shape is still read for is the WORDING of that
 * refusal, and nothing else. See {@link admissionHint}.
 */

import type {
  ActionConfig,
  BlockDefinition,
  DeclaredResourceEntry,
  FlowInstance,
  FlowType,
  InstanceOwnerPin,
  OrgConfig,
  RequestConfig,
  SessionConfig,
  UserConfig
} from "@flow-state-dev/core/types";
import type { DeclaredResources } from "@flow-state-dev/core";
import type { ZodTypeAny } from "zod";
import {
  INSTRUCTIONS_KEY,
  PACKAGES_KEY,
  REFUSED_PERSONA_KEY,
  REFUSED_PERSONA_KEY_MESSAGE,
  REFUSED_SEAT_PACKAGES_KEY_MESSAGE,
  REFUSED_SEAT_SKILLS_KEY_MESSAGE,
  REFUSED_SEAT_TOOLS_KEY_MESSAGE,
  REFUSED_TEAM_INSTRUCTIONS_KEY_MESSAGE,
  SEAT_PACKAGES_KEY,
  SEAT_SKILLS_KEY,
  SEAT_TOOLS_KEY,
  TEAM_INSTRUCTIONS_KEY,
  colocatedResourceMessage,
  oneNameMessage,
  type WorkerManifest
} from "./manifest";
import { AGENT_KIND, defineAgentWorkerFlow } from "./agent-worker-flow";
import {
  SEAT_RESOURCES_KEY,
  parseSeatResources,
  resolveSeatResources,
  verifySeatNarrowing,
  type SeatResourceGrant
} from "./seat-resources";
import {
  SEAT_REFERENCES_KEY,
  applyReferenceWall,
  verifySeatReferenceWall
} from "./seat-references";
import { workerConfigSchema } from "./worker-config";
import { heldPackageProblems, resolveHeldPackages } from "./seat-packages";

/**
 * The keys the factory itself reads. Everything else is the worker's settings.
 *
 * `resources`, `references` and `packages` join them rather than travelling to
 * the kind as settings: each is an instruction to THIS step about what to mint
 * the seat with, not a value any kind declares. A kind that happened to declare a
 * setting of either name no longer receives an authored one — both keys are
 * public and pinned here, and a seat file cannot mean two things at once.
 */
const RESERVED_KEYS = [
  "flow",
  "description",
  SEAT_RESOURCES_KEY,
  SEAT_REFERENCES_KEY,
  PACKAGES_KEY
] as const;

/**
 * The stock `agent` kind, built once for the life of the module.
 *
 * Held here rather than exported: an app that wants a different one registers
 * its own under `agent` (`kinds: { agent: defineAgentWorkerFlow({ ... }) }`), which
 * merges over this one. Define once, hire many — never per hire or per request.
 */
const builtInAgentWorkerFlow = defineAgentWorkerFlow() as unknown as AnyFlowType;

export interface HireOptions {
  /**
   * The flows the app defined, by kind — `defineFlow(...)` results, passed
   * directly. A record's `flow` names one, and it is called once per worker to
   * mint that worker's copy.
   *
   * Optional: the built-in `agent` kind is always available underneath, so a
   * roster of records that name no kind needs none of these. Passing a flow
   * under `agent` replaces the built-in for every seat.
   */
  kinds?: Record<string, AnyFlowType>;

  /**
   * The blocks each seat's own folders REGISTER, keyed by worker id and then by
   * block name — `fsdev gen`'s `seatBlocks` export, passed straight through.
   *
   * **Registration, not a grant.** An entry here makes that name resolvable by
   * that seat; the seat's `tools:` is still what decides whether it may call
   * it, and a registered block the file never names is not on the model's
   * toolset. A name resolves worker folder → team folder → the app's catalog,
   * first match wins; the first two arrive here already collapsed by the
   * generated map, and this step is where the last hop happens.
   *
   * Per seat and never installed on the kind: a kind's capabilities and
   * resources are shared by every seat of it, so one worker's folder installed
   * there would change every sibling. That is why a block here may USE a store
   * the kind has and may not DECLARE one — see
   * {@link colocatedResourceMessage}.
   *
   * Optional. Omitted, every seat hires exactly as it did before this existed.
   */
  seatBlocks?: Record<string, Record<string, BlockDefinition<any, any>>>;

  /**
   * The blocks each package carries, keyed by the package's address and then
   * by block name — `fsdev gen`'s `packageBlocks` export, passed straight
   * through.
   *
   * A package's blocks reach only the seats that HOLD the package: the ones
   * with it in their own `packages/` folder, and the ones whose `packages:`
   * line takes it from their team's or the org's library. They are never put
   * in a kind's catalog, so no other seat can name them. A seat holding a
   * package with no `tools:` line can call every block in it; a seat that
   * writes a `tools:` line can call the ones it lists.
   *
   * Optional. Omitted, a held package brings its instructions and no tools.
   */
  packageBlocks?: Record<string, Record<string, BlockDefinition<any, any>>>;

  /**
   * The ledger ids this app's channels declared — `channelBoardIds(channels)`.
   *
   * Handed over so this step can say when a channel holds a board **no flow
   * hired here declares**: the rows would sit `pending` forever with nothing
   * said, which is the one failure a declared board can produce silently. Each
   * unattended id gets a `console.warn` naming the channel and the id.
   *
   * **A warning, never a refusal**, and the reason is in the evidence rather
   * than in a preference: a seat may legitimately live in another process, and
   * this check cannot see it. So a missing declaration is *probably* a mistake
   * and cannot be proved to be one, which is exactly the shape a warning is
   * for.
   *
   * Optional. Omitted, nothing is checked and nothing is said — the check
   * cannot invent a roster's ids, and every caller that predates boards hires
   * exactly as it did.
   */
  channelBoards?: readonly string[];

  /**
   * The documents this app declared, keyed by ref — the map
   * `resourcesFromDocs(documents)` returns, handed over unchanged.
   *
   * **Handed over, never worked out.** A seat's `resources:` grant narrows the
   * DOCUMENTS in the map its kind declares at flow level and leaves the rest of
   * that map — the app's boards, its stores — standing. Telling a document from
   * a board is what this answers, and the app is the only party that knows:
   * inferring it from an entry's shape would make the boundary of a permission
   * feature rest on a heuristic, and a board that happened to look like a
   * document would become grantable.
   *
   * The same list the app already spreads into its own flow-level map, so there
   * is one catalog and not a second table describing the same documents.
   *
   * Optional, and consulted only for a seat that declares `resources:`. A
   * roster where no seat does hires exactly as it did before this existed. A
   * seat that DOES declare one while this is absent refuses, rather than
   * resolving every ref to nothing — a lockout that reads like a typo.
   */
  documents?: DeclaredResources;

  /**
   * The references this app declared, keyed by ref — the map
   * `referencesFromDocs(references)` returns, handed over unchanged.
   *
   * **Handed over for the reason `documents` is, and used for more.** It says
   * which entries on a kind's map are references, which is what the derived
   * tree wall narrows: a seat reaches the references at or above its place in
   * the tree, and no others. That wall applies whether or not the seat declares
   * `references:` — the key narrows within it, and can never widen past it.
   *
   * Optional. Absent, no entry is a reference, no wall applies, and every seat
   * is minted exactly as it was before this existed.
   *
   * A ref may not appear in both this map and {@link HireOptions.documents}:
   * the two behave differently and one accessor cannot be both, so the pair is
   * refused rather than resolved.
   */
  references?: DeclaredResources;
}

/** A flow whose settings schema is `TConfigSchema`, whatever it declares elsewhere. */
type FlowOf<TConfigSchema extends ZodTypeAny | undefined> = FlowType<
  Record<string, ActionConfig>,
  SessionConfig | undefined,
  RequestConfig | undefined,
  UserConfig | undefined,
  OrgConfig | undefined,
  Record<string, DeclaredResourceEntry>,
  TConfigSchema
>;

/**
 * A flow of either shape: one that declares settings, and one that declares
 * none.
 *
 * **Do not collapse this to a single member.** It reads redundant and is not:
 * a flow's settings schema sits in an invariant position (`config` is a
 * deferred conditional on it), so neither half accepts the other's flows, and
 * both kinds are hired here. Each collapse fails a different way, and both were
 * hit while writing this:
 *
 * - bare `FlowType` pins `TConfigSchema` to its own default, `undefined`, so it
 *   means "a flow that declares no settings". A configured kind is rejected —
 *   *Type 'ZodObject<…>' is not assignable to type 'undefined'*.
 * - `FlowOf<ZodTypeAny>` alone flips that failure onto the settings-less kind a
 *   thin seat is hired into — *Type 'undefined' is not assignable to type
 *   'ZodTypeAny'*.
 */
type AnyFlowType = FlowOf<ZodTypeAny> | FlowOf<undefined>;

/**
 * The one unsound spot, and deliberately here rather than at every call site: a
 * flow's bag type belongs to that one definition, while a roster's settings are
 * data whose shape is unknown until run time. The flow's `configSchema` checks
 * it at the mint, per worker, so a type here would only restate a guarantee
 * made somewhere else.
 */
function minter(
  flow: AnyFlowType
): (options: {
  id: string;
  config?: Record<string, unknown>;
  resources?: DeclaredResources;
  ownerPin?: InstanceOwnerPin;
}) => FlowInstance {
  return flow as unknown as (options: {
    id: string;
    config?: Record<string, unknown>;
    resources?: DeclaredResources;
    ownerPin?: InstanceOwnerPin;
  }) => FlowInstance;
}

/** The worker's settings bag: what the record declared, minus the reserved keys. */
function settingsOf(manifest: WorkerManifest): Record<string, unknown> {
  const settings: Record<string, unknown> = { ...manifest.declared };
  for (const key of RESERVED_KEYS) delete settings[key];
  return settings;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The keys the contract declares, in the order an author reads them — **read
 * off the contract rather than listed here.**
 *
 * A hand-maintained copy of this membership is the same defect one level up
 * from the one {@link admissionHint} exists to prevent: the hint's whole job is
 * to name the key an author has to add, and the key it is needed for most is
 * the NEWEST one, which is exactly the one a hand-written list is missing the
 * day it is added. The refusal still fires either way, so the symptom is a
 * diagnostic that goes quiet on the one case nobody has heard of yet — and an
 * author reads that silence as "not that".
 *
 * `workerConfigSchema()` is the one definition of the set, so it is the one
 * thing consulted. Built once at module scope: the schema is a fresh object per
 * call, and its SHAPE is what is read.
 */
const CONTRACT_KEYS: readonly string[] = Object.keys(workerConfigSchema().shape);

/**
 * Why a mint refused, in one added sentence — **or nothing, which is the
 * common case.**
 *
 * A MESSAGE, never a gate. It runs only after the kind's own schema has already
 * refused, and it cannot refuse on its own: the moment it could, admission
 * would have two authorities. What it does is spare an author the guess between
 * *"I misspelt a setting"* and *"my kind never opened the door the framework
 * hands things through."*
 *
 * **It reads the refusal, not the kind.** An earlier version inferred contract
 * absence from the blueprint's PROBED default bag — the shape a kind publishes
 * for an empty config — and that inference was wrong in a case nobody had to
 * contrive: a kind declaring `seatSkills` optional *without a default* probes
 * to a bag with no such key, so a refusal about some other setting's bad value
 * got "this kind has not composed the contract" appended to it. The kind
 * accepted the whole imposed bag. The accusation was false.
 *
 * So the only thing consulted now is whether the refusal that actually happened
 * named one of the contract's keys as undeclared. That is the sole condition
 * under which the door is demonstrably missing; anything else, including a
 * shape this function cannot interpret, gets silence. A hint that cannot know
 * says nothing, because a confident wrong answer costs more than no answer.
 *
 * @param refusal The flow's own refusal message, already stringified.
 * @returns One sentence naming the missing keys and the fix, or `undefined`.
 */
function admissionHint(refusal: string): string | undefined {
  // The blunt case, and the only other one this can be sure of: the kind
  // declares no `configSchema` at all, so core refuses the bag outright rather
  // than reporting a key. No door of any kind, no ambiguity, nothing to infer.
  if (refusal.includes("declares no configSchema")) {
    return (
      `A hireable kind must declare somewhere for what the hire step imposes — ` +
      `${CONTRACT_KEYS.map((key) => `\`${key}\``).join(", ")} — to arrive: ` +
      `\`configSchema: workerConfigSchema()\`, extended with this kind's own settings.`
    );
  }

  // `describeFlowConfigIssues` renders an undeclared TOP-LEVEL key as
  // `"x" is not a declared setting`, and a key inside one of the kind's own
  // nested objects as `… is not a declared setting of "path"`. Only the first
  // is about the contract, so the suffixed form must not match — a nested
  // `seatSkills` of someone else's object is not our door.
  const missing = CONTRACT_KEYS.filter((key) =>
    refusal
      .replace(/\.$/, "")
      .split("; ")
      .some(
        (segment) => segment.endsWith("is not a declared setting") && segment.includes(`"${key}"`)
      )
  );

  if (missing.length === 0) return undefined;

  const named = missing.map((key) => `\`${key}\``).join(", ");
  return (
    `${missing.length === 1 ? "That key is" : "Those keys are"} the framework's: every hireable kind ` +
    `admits ${named} by composing \`workerConfigSchema()\`, which is where everything the hire step ` +
    `imposes on a seat arrives. Wrap this kind's settings: ` +
    `\`configSchema: workerConfigSchema().extend({ ...its own settings })\`.`
  );
}

/**
 * Why one seat's own block registry cannot be used as written — every reason,
 * or an empty list.
 *
 * Checked against the REGISTRY rather than against the names the seat declared,
 * on purpose: registering a name is a promise that the name resolves to
 * something callable, so a registry the framework cannot keep that promise over
 * is broken whether or not this particular seat happens to name it. Waiting
 * until it is named would make the same tree pass or fail depending on one line
 * of a Markdown file.
 *
 * Collected, not thrown, so one run names every problem — the bargain the rest
 * of this step makes.
 */
function seatBlockProblems(registry: Record<string, BlockDefinition<any, any>>): string[] {
  const problems: string[] = [];
  for (const [key, block] of Object.entries(registry)) {
    const blockName = (block as { name?: unknown }).name;
    if (typeof blockName === "string" && blockName !== key) {
      problems.push(oneNameMessage(key, blockName, "This worker's own folder"));
    }
    const declared = (block as { declaredResources?: Record<string, unknown> }).declaredResources;
    const accessors = declared === undefined ? [] : Object.keys(declared);
    if (accessors.length > 0) problems.push(colocatedResourceMessage(key, accessors));
  }
  return problems;
}

/**
 * Split a seat's declared tool names by where each one resolved.
 *
 * The seat's own registry is nearer than the app's catalog, so it answers first
 * — the worker → team → org precedence, with the first two already collapsed
 * onto the registry. What resolved there becomes a live block on
 * {@link SEAT_TOOLS_KEY}; what did not stays a NAME on `tools`, which is what
 * the kind checks its catalog against and what the delegation fence narrows a
 * board worker to. A colocated tool therefore does not travel through a
 * delegation, and that falls out of where the name landed rather than from a
 * second rule.
 *
 * A `tools:` that is not an array of strings is left exactly as the author
 * wrote it: the kind's own schema is what refuses a malformed setting, and
 * guessing here would refuse it twice, differently.
 */
function resolveDeclaredTools(
  declared: unknown,
  registry: Record<string, BlockDefinition<any, any>>
): { catalogNames: unknown; seatTools: Array<BlockDefinition<any, any>> } {
  if (!Array.isArray(declared) || declared.some((name) => typeof name !== "string")) {
    return { catalogNames: declared, seatTools: [] };
  }
  const catalogNames: string[] = [];
  const seatTools: Array<BlockDefinition<any, any>> = [];
  for (const name of declared as string[]) {
    if (Object.hasOwn(registry, name)) seatTools.push(registry[name]!);
    else catalogNames.push(name);
  }
  return { catalogNames, seatTools };
}

/**
 * Turn worker records into one configured flow copy each, ordered by id.
 *
 * Every problem is a startup misconfiguration, so every problem throws — but
 * they are collected first, so one run names all of them and an author fixes
 * them in one pass. Nothing is returned partially: a refusal after a partial
 * hire would not be a refusal.
 *
 * @param manifests The roster — from the loader, or hand-built.
 * @param options   `kinds`: the flow factories the app defined. Optional — the
 *                  built-in `agent` kind is always available underneath, and a
 *                  flow passed under `agent` replaces it for every seat.
 * @returns One `FlowInstance` per record, ordered by id. Register these.
 * @throws If any record cannot be hired; the message names every bad worker.
 */
export function hireWorkforce(
  manifests: WorkerManifest[],
  options: HireOptions = {}
): FlowInstance[] {
  // The built-in sits UNDERNEATH the caller's, so a caller who registers their
  // own `agent` wins — for every seat, not just the ones that name it. This is
  // precedence, not extension: configuring the built-in's tools or skills means
  // replacing the kind (`defineAgentWorkerFlow({ ... })` registered here), never a
  // second option on this function. A roster hired with `kinds: {}` therefore
  // carries an empty tool catalog, because nothing ever merges into ours.
  const kinds: Record<string, AnyFlowType> = { [AGENT_KIND]: builtInAgentWorkerFlow, ...options.kinds };

  // One ref cannot be both a document and a reference. Checked here as well as
  // at the loader, the same two-door reason every other refusal in this file
  // has: a hand-built catalog never passes the loader. Thrown rather than
  // collected — it is the app's wiring, not one worker's file, so there is no
  // worker to report it against and no roster that hires correctly around it.
  const bothKinds = Object.keys(options.references ?? {}).filter((ref) =>
    Object.hasOwn(options.documents ?? {}, ref)
  );
  if (bothKinds.length > 0) {
    throw new Error(
      `hireWorkforce was given ${bothKinds.map((ref) => `"${ref}"`).join(", ")} as both a ` +
        `document and a reference. One ref is one accessor, and the two behave differently — a ` +
        `reference is read from its file and sealed, a document seeds a row and then evolves — ` +
        `so whichever won would be a coin flip. Keep one: leave the file in \`resources/\`, or ` +
        `move it to \`references/\`.`
    );
  }

  const kindNames = Object.keys(kinds);
  const available = kindNames.length > 0 ? kindNames.map((k) => `"${k}"`).join(", ") : "(none)";

  const ordered = [...manifests].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const seats: FlowInstance[] = [];
  const problems: string[] = [];
  // Which WORKERS were refused, which is not `problems.length`: one worker can
  // contribute several reasons — two unresolved grants, two malformed entries —
  // and counting sentences is how `refused 2 of 1 worker` gets printed.
  const refusedWorkers = new Set<string>();
  const seen = new Set<string>();
  const seatBlocks = options.seatBlocks ?? {};
  const packageBlocks = options.packageBlocks ?? {};

  for (const manifest of ordered) {
    const refuse = (reason: string): void => {
      problems.push(`worker "${manifest.id}" — ${reason}`);
      refusedWorkers.add(manifest.id);
    };

    // Caught here as well as at the registry so it reads as a ROSTER problem,
    // reported alongside the others rather than on its own later.
    if (seen.has(manifest.id)) {
      refuse("declared twice in this roster; a worker's id is its address and must be unique");
      continue;
    }
    seen.add(manifest.id);

    const settings = settingsOf(manifest);

    // The refused key, caught before anything else looks at the bag.
    // Checked here as well as in the loader because a hand-built roster never
    // passes the loader, and this is the key the factory itself imposes.
    //
    // Left to fall through, it reaches the flow as an ordinary setting. A flow
    // whose schema has been renamed refuses it, but as `"persona" is not a
    // declared setting` — which reads as a misspelt setting, not as a key the
    // framework refuses. The case that has to be caught here is the other one: a
    // flow whose `configSchema` has NOT been renamed still declares `persona`
    // and so accepts it, and the seat hires configured the old way carrying no
    // `instructions` at all, with nothing said anywhere.
    if (Object.hasOwn(settings, REFUSED_PERSONA_KEY)) {
      refuse(REFUSED_PERSONA_KEY_MESSAGE);
      continue;
    }

    // The other imposed key, refused here for the same reason: a hand-built
    // roster never passes the loader, and a flow whose `configSchema` declares
    // `seatSkills` would accept an authored one and run with a skill set no
    // folder backs.
    if (Object.hasOwn(settings, SEAT_SKILLS_KEY)) {
      refuse(REFUSED_SEAT_SKILLS_KEY_MESSAGE);
      continue;
    }

    // The third contract key, refused for the sharper version of the same
    // reason. Every hireable kind now DECLARES `teamInstructions` by composing
    // the contract, so an authored one would not be caught by the closed
    // schema the way an undeclared key is — it would be accepted, and the seat
    // would run on team instructions its team never wrote. A team's
    // instructions belong to its team.
    if (Object.hasOwn(settings, TEAM_INSTRUCTIONS_KEY)) {
      refuse(REFUSED_TEAM_INSTRUCTIONS_KEY_MESSAGE);
      continue;
    }

    // The fourth contract key, refused for the reason the other two imposed
    // keys are: a kind composing the contract declares it, so an authored one
    // would be accepted and the seat would run carrying tools no folder of its
    // backs — silently, and only for that seat.
    if (Object.hasOwn(settings, SEAT_TOOLS_KEY)) {
      refuse(REFUSED_SEAT_TOOLS_KEY_MESSAGE);
      continue;
    }

    // The fifth, for the same reason: a seat carrying packages no folder of
    // its holds.
    if (Object.hasOwn(settings, SEAT_PACKAGES_KEY)) {
      refuse(REFUSED_SEAT_PACKAGES_KEY_MESSAGE);
      continue;
    }

    // A body is instructions; whitespace is not. An empty string handed to a
    // flow that declares `instructions` would be a worse lie than omitting it —
    // and it would turn every thin seat into a failed hire.
    if (manifest.body.trim().length > 0) {
      if (Object.hasOwn(settings, INSTRUCTIONS_KEY)) {
        refuse(
          `declares "${INSTRUCTIONS_KEY}" in its frontmatter and carries a body — two sources for ` +
            `one setting, and there is no precedence rule. Remove one: a worker's instructions are ` +
            `handed to its flow as "${INSTRUCTIONS_KEY}".`
        );
        continue;
      }
      // Verbatim: the check is on the trimmed body, the value is the body.
      settings[INSTRUCTIONS_KEY] = manifest.body;
    }

    // The refusal that stood here SPLITS; it does not disappear. One condition
    // used to refuse an absent `flow:` and a whitespace-only one alike. Only
    // an ABSENT key now resolves to the built-in.
    //
    // `hasOwn` rather than a bare read of `.flow`: a `flow:` key parsed from a
    // file with no value (or `~`, or `null`) arrives as an own property
    // holding `null` — present, not absent — and reading it as "omitted"
    // would silently hire the built-in for a file that named the key. Only a
    // record with no `flow` key at all gets the default.
    const hasFlowKey = Object.hasOwn(manifest.declared, "flow");
    const declaredKind = manifest.declared.flow;

    if (hasFlowKey && typeof declaredKind === "string" && declaredKind.trim().length === 0) {
      // A whitespace-only value keeps refusing, because whitespace is a typo or a
      // YAML artefact rather than an expression of intent, and reading it as "use
      // the default" would paper over a mistake in the one step whose whole story
      // is loud failure. C2 is explicit that adding an implicit default must not
      // weaken an existing refusal, and this is the one place it could.
      refuse("declares an empty `flow:`, which names no flow kind. Remove the key to hire the built-in `agent` kind, or name a kind you passed");
      continue;
    }

    if (hasFlowKey && typeof declaredKind !== "string") {
      // The same class of refusal as the empty-string case above, for a
      // present `flow:` whose value isn't a string at all — `flow:`/`flow: ~`
      // /`flow: null` from a file, or `{ flow: 42 }` from a hand-built
      // manifest. Silently defaulting here is the weakened refusal C2
      // forbids, worded for what was actually declared instead of a blank.
      refuse(
        `declares \`flow:\` as ${JSON.stringify(declaredKind)}, which names no flow kind. ` +
          "Remove the key to hire the built-in `agent` kind, or name a kind you passed"
      );
      continue;
    }

    // Absent (no `flow` key at all) means the built-in.
    const kind = hasFlowKey ? (declaredKind as string) : AGENT_KIND;

    // `hasOwn` rather than a bare lookup: a record's `flow` is author-supplied,
    // and `kinds["constructor"]` would otherwise resolve off the prototype and
    // hand us something that is not a flow factory at all.
    const factory = Object.hasOwn(kinds, kind) ? kinds[kind] : undefined;
    if (factory === undefined) {
      refuse(`names flow kind "${kind}", which was not passed to hireWorkforce. Kinds passed: ${available}`);
      continue;
    }

    // A flow filed under someone else's name. Nothing downstream would notice:
    // the copy mints, registers under this worker's id, and then runs the other
    // kind's graph whenever its settings happen to validate — a worker doing a
    // different worker's job, which is the one failure this whole epic refuses.
    if (factory.kind !== kind) {
      refuse(
        `declares flow kind "${kind}", but the flow passed under that key is kind "${String(factory.kind)}" — ` +
          `this seat would run a different worker's graph. Pass each flow under its own kind.`
      );
      continue;
    }

    // The seat's own skills, imposed on EVERY record — loaded or hand-built,
    // non-empty or empty, whatever kind this is.
    //
    // No probe of what the kind declares. The probe's other arm was silence:
    // a seat whose folders declared skills minted, ran, and held none, with
    // nothing said anywhere. Handing the bag over unconditionally turns that
    // into one loud refusal at boot, which an author can act on.
    //
    // `?? []` and not a conditional: present-and-empty is the answer for
    // *nothing to give*, and the bag is handed over all the same. The record
    // still distinguishes *never read for* (absent) from *read and empty*, and
    // that distinction stays on the record, where it belongs.
    settings[SEAT_SKILLS_KEY] = manifest.skills ?? [];

    // The seat's TEAM-level instructions — and **only when the record carries
    // them**, which is the opposite of the line above and deliberately so.
    //
    // `seatSkills` is imposed on every record because present-and-empty is a
    // real answer for a seat's skills: the folders were read and held nothing.
    // A team layer has no such answer. A team that wrote no instructions and a
    // team with no file at all both mean *this seat is told nothing extra*, and
    // handing `""` over would make them a value every kind's schema can see —
    // a different bag for every team in every tree that has no file, and the
    // trap the body rule above already names.
    //
    // Whitespace is not instructions here either. The loader will not produce
    // such a record, but a hand-built roster never passes the loader, and this
    // is the same one-line rule its neighbour applies to a body.
    if (
      typeof manifest.teamInstructions === "string" &&
      manifest.teamInstructions.trim().length > 0
    ) {
      // Verbatim: the check is on the trimmed value, the value is the value.
      settings[TEAM_INSTRUCTIONS_KEY] = manifest.teamInstructions;
    }

    // The seat's own block registry, and the names its file resolved out of it.
    // Imposed on EVERY record for the reason `seatSkills` is: present-and-empty
    // is the answer for *nothing registered*, and the bag is handed over all
    // the same.
    const registry = seatBlocks[manifest.id] ?? {};
    const registryProblems = seatBlockProblems(registry);
    if (registryProblems.length > 0) {
      for (const problem of registryProblems) refuse(problem);
      continue;
    }
    // The packages this seat holds: its own folder's, then the ones its
    // `packages:` line takes from its team's or the org's library. Their
    // blocks join the seat's registry for resolving a written `tools:` line —
    // a package's blocks are the seat's own for that purpose — after every
    // name among them has been shown to be one tool. This step cannot see a
    // kind's catalog, so a named package block that is also a catalog key is
    // refused by the kind at its mint (the built-in one does), not here.
    const { held, problems: heldProblems } = resolveHeldPackages(
      manifest.id,
      manifest.declared[PACKAGES_KEY],
      manifest.packages,
      packageBlocks
    );
    const packageProblems = [...heldProblems, ...heldPackageProblems(held, registry)];
    if (packageProblems.length > 0) {
      for (const problem of packageProblems) refuse(problem);
      continue;
    }
    const withPackages = { ...registry };
    for (const { blocks } of held) Object.assign(withPackages, blocks);

    const { catalogNames, seatTools } = resolveDeclaredTools(settings["tools"], withPackages);
    // Only a record that WROTE a `tools:` line carries the key onward, and it
    // keeps carrying it after the split even when every name moved onto
    // `seatTools` and the list emptied. Whether the key is present is what the
    // built-in kind reads to tell "wrote no line" (grant what the file picked)
    // from "wrote a line" (grant exactly that line), so an omitted `tools:`
    // must never be filled in here or anywhere after.
    if (Object.hasOwn(settings, "tools")) settings["tools"] = catalogNames;
    settings[SEAT_TOOLS_KEY] = seatTools;

    // Only for a seat that holds one, like the team's instructions: a seat
    // holding nothing hands its kind exactly the bag it did before packages
    // existed. The kind decides what a held package does; this step decides
    // only which ones are held.
    if (held.length > 0) {
      settings[SEAT_PACKAGES_KEY] = held.map(({ manifest: pkg, blocks }) => ({
        name: pkg.name,
        path: pkg.path,
        ...(pkg.instructions === undefined ? {} : { instructions: pkg.instructions }),
        tools: Object.values(blocks)
      }));
    }

    // The seat's document allowlist, resolved against what the app declared.
    //
    // **Only for a record that DECLARES the key**, and the map is passed only
    // then. A flow instance's `resources` option REPLACES the definition's
    // flow-level map, so a seat that restricted nothing must be minted with no
    // map at all: passing an empty one locks every existing seat out of every
    // document, and reconstructing "everything" diverges the moment the kind's
    // map changes. Absent is not empty here, at either end.
    let seatResources: DeclaredResources | undefined;
    let seatGrants: readonly SeatResourceGrant[] = [];
    // Whether the seat NARROWED its documents, which is no longer the same
    // question as whether it is minted with a map: the reference wall below
    // gives a map to a seat that granted nothing. `verifySeatNarrowing` asks
    // about the grant, so it has to read this and not the map — keyed on the
    // map, a seat that declared no `resources:` would have every document on
    // its kind reported as having escaped a narrowing nobody asked for.
    const narrowedDocuments = Object.hasOwn(manifest.declared, SEAT_RESOURCES_KEY);
    if (narrowedDocuments) {
      const parsed = parseSeatResources(manifest.declared[SEAT_RESOURCES_KEY]);
      if (parsed.problems.length > 0) {
        for (const problem of parsed.problems) refuse(problem);
        continue;
      }
      const kindResources = (factory.resources ?? {}) as DeclaredResources;
      const resolved = resolveSeatResources({
        grants: parsed.grants ?? [],
        catalog: options.documents,
        kindResources,
        // The kind's own flow-level keys, which is the subset a seat's map
        // replaces. Falling back to every key would read the kind's BLOCK
        // resources as flow-level ones and copy them onto the seat's map,
        // where they would override the blocks that declared them.
        kindFlowLevelKeys: factory.flowLevelResourceKeys ?? new Set<string>(),
        kind
      });
      if (resolved.problems.length > 0) {
        for (const problem of resolved.problems) refuse(problem);
        continue;
      }
      seatResources = resolved.resources;
      seatGrants = parsed.grants ?? [];
    }

    // The reference wall: derived from where this seat and each reference sit
    // in the tree, and applied to whatever map the seat would otherwise get.
    //
    // **Unconditional, unlike the block above.** A `resources:` grant is a
    // narrowing a seat asks for, so it runs only when the seat asks; the wall
    // is a boundary, so it runs for every seat whether or not its file says
    // anything. What keeps that from touching an app with no references is the
    // wall itself: a kind holding none hands `base` straight back, including
    // handing back `undefined` so the seat is minted with no map at all.
    const wall = applyReferenceWall({
      seatId: manifest.id,
      declared: manifest.declared[SEAT_REFERENCES_KEY],
      hasDeclared: Object.hasOwn(manifest.declared, SEAT_REFERENCES_KEY),
      catalog: options.references,
      kindResources: (factory.resources ?? {}) as DeclaredResources,
      kindFlowLevelKeys: factory.flowLevelResourceKeys ?? new Set<string>(),
      base: seatResources
    });
    if (wall.problems.length > 0) {
      for (const problem of wall.problems) refuse(problem);
      continue;
    }
    seatResources = wall.resources;

    try {
      // Always a bag, so always admitted. The branch that stood here passed no
      // bag at all for a record that declared nothing — which is admission
      // SKIPPED, not admission passed: a thin seat minted without its kind's
      // schema ever seeing it. Every record meets the schema now, including the
      // thinnest one there is.
      const seat = minter(factory)({
        id: manifest.id,
        config: settings,
        ...(manifest.ownerPin !== undefined ? { ownerPin: manifest.ownerPin } : {}),
        ...(seatResources !== undefined ? { resources: seatResources } : {})
      });

      // The narrowing is checked on the seat that was BUILT, not on the map it
      // was built from. `defineFlow` merges the blocks' own declarations on top
      // of the instance's map, so a document a block also declares comes back
      // after the seat's map has removed it — and nothing readable off the kind
      // distinguishes that document from one no block mentions. Only the
      // instance knows. Skipped when the seat narrowed nothing, which denies
      // nothing.
      if (narrowedDocuments && options.documents !== undefined) {
        const escaped = verifySeatNarrowing({
          minted: seat.resources as DeclaredResources | undefined,
          grants: seatGrants,
          catalog: options.documents,
          kind
        });
        if (escaped.length > 0) {
          for (const problem of escaped) refuse(problem);
          continue;
        }
      }

      // The same check for the wall, and it exists for the same substrate
      // reason: a reference a block ALSO declares comes back after the seat's
      // map removed it, and only the built instance shows that. Read off the
      // minted flow rather than predicted from the kind.
      const crossed = verifySeatReferenceWall({
        minted: seat.resources as DeclaredResources | undefined,
        allowed: wall.reachable,
        catalog: options.references,
        seatId: manifest.id,
        kind
      });
      if (crossed.length > 0) {
        for (const problem of crossed) refuse(problem);
        continue;
      }

      seats.push(seat);
    } catch (error) {
      // The flow's own refusal, with the worker's id in front of it, and — when
      // the kind's shape says what most likely went wrong — one sentence naming
      // the fix. Still no check of our own: `admissionHint` cannot refuse.
      const message = messageOf(error);
      const hint = admissionHint(message);
      refuse(hint === undefined ? message : `${message} ${hint}`);
    }
  }

  // **An entry addressed to a worker this call is not hiring is not a problem.**
  // A short roster is a supported mode — `readWorkforce` reports a folder that
  // produced no worker and loads the rest, and a caller may hire what loaded —
  // while `seatBlocks` is generated from the WHOLE tree. So the two sets
  // legitimately differ, and refusing the difference broke the documented mode:
  // one skipped worker turned every other seat's hire into a refusal, which is
  // how `refused 2 of 1 worker` became a sentence this function could print.
  //
  // Nothing is lost by staying quiet. The generated map cannot address a worker
  // the tree does not hold, because one walk produces both; a hand-built map is
  // the caller's business in the same way a hand-built roster is. What is
  // validated is every registry belonging to a manifest actually being hired,
  // which happens in the loop above.

  if (problems.length > 0) {
    throw new Error(
      `hireWorkforce refused ${refusedWorkers.size} of ${ordered.length} worker${ordered.length === 1 ? "" : "s"}; ` +
        `nothing was hired:\n  - ${problems.join("\n  - ")}`
    );
  }

  // After the refusals, deliberately: a roster that did not hire has nothing
  // to be unattended by, and a warning printed beside a fatal error is noise.
  for (const warning of unattendedBoardWarnings(options.channelBoards ?? [], seats)) {
    console.warn(warning);
  }

  return seats;
}

/**
 * The unattended-board sentences `hireWorkforce` prints, as values.
 *
 * Hire does not attach boards. A caller that surfaces the same warning on a
 * tool result (the seat-hire capability) reads them here rather than
 * re-deriving the text, so the mint and the tool stay one story.
 *
 * Read off the hired instances' merged `resources` rather than off the kinds:
 * a board reaches a flow either as a flow-level declaration or by bubbling up
 * from a capability, and only the minted instance has both.
 */
export function unattendedBoardWarnings(
  boardIds: readonly string[],
  seats: readonly FlowInstance[]
): string[] {
  if (boardIds.length === 0) return [];

  const declared = new Set<string>();
  for (const seat of seats) {
    for (const key of Object.keys(seat.resources ?? {})) declared.add(key);
  }

  const warnings: string[] = [];
  for (const boardId of boardIds) {
    if (declared.has(boardId)) continue;
    // A board id is its channel's id, a dot, and a name carrying no dot.
    const channelId = boardId.slice(0, boardId.lastIndexOf("."));
    // The LOCAL name in the prose, because that is what the `CHANNEL.md` says
    // and what an operator goes looking for. The minted id appears once, in
    // the fix, where it is the thing to copy.
    const boardName = boardId.slice(channelId.length + 1);
    warnings.push(
      `[workforce] channel "${channelId}" holds board "${boardName}" (ledger "${boardId}"), ` +
        `and no flow hired in this ` +
        `call declares it. Rows filed there will sit pending until something drains them — ` +
        `declare the board on the seat that runs the work ` +
        `(\`resources: { [board.id]: board }\` with \`channelBoard("${channelId}", "${boardName}")\`), ` +
        `or ignore this if that seat runs in another process.`
    );
  }
  return warnings;
}
