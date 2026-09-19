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
  DeclaredResourceEntry,
  FlowInstance,
  FlowType,
  OrgConfig,
  RequestConfig,
  SessionConfig,
  UserConfig
} from "@flow-state-dev/core/types";
import type { ZodTypeAny } from "zod";
import {
  INSTRUCTIONS_KEY,
  REFUSED_PERSONA_KEY,
  REFUSED_PERSONA_KEY_MESSAGE,
  REFUSED_SEAT_SKILLS_KEY_MESSAGE,
  REFUSED_TEAM_INSTRUCTIONS_KEY_MESSAGE,
  SEAT_SKILLS_KEY,
  TEAM_INSTRUCTIONS_KEY,
  type WorkerManifest
} from "./manifest";
import { AGENT_KIND, defineAgentWorkerFlow } from "./agent-worker-flow";

/** The two keys the factory itself reads. Everything else is the worker's settings. */
const RESERVED_KEYS = ["flow", "description"] as const;

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
function minter(flow: AnyFlowType): (options: { id: string; config?: Record<string, unknown> }) => FlowInstance {
  return flow as unknown as (options: { id: string; config?: Record<string, unknown> }) => FlowInstance;
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

/** The keys the contract declares, in the order an author reads them. */
const CONTRACT_KEYS = [INSTRUCTIONS_KEY, TEAM_INSTRUCTIONS_KEY, SEAT_SKILLS_KEY] as const;

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
      `A hireable kind must declare somewhere for a seat's instructions and resolved skills to ` +
      `arrive: \`configSchema: workerConfigSchema()\`, extended with this kind's own settings.`
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
    `admits ${named} by composing \`workerConfigSchema()\`, which is where a seat's instructions and ` +
    `its resolved skills arrive. Wrap this kind's settings: ` +
    `\`configSchema: workerConfigSchema().extend({ ...its own settings })\`.`
  );
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

  const kindNames = Object.keys(kinds);
  const available = kindNames.length > 0 ? kindNames.map((k) => `"${k}"`).join(", ") : "(none)";

  const ordered = [...manifests].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const seats: FlowInstance[] = [];
  const problems: string[] = [];
  const seen = new Set<string>();

  for (const manifest of ordered) {
    const refuse = (reason: string): void => {
      problems.push(`worker "${manifest.id}" — ${reason}`);
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

    try {
      // Always a bag, so always admitted. The branch that stood here passed no
      // bag at all for a record that declared nothing — which is admission
      // SKIPPED, not admission passed: a thin seat minted without its kind's
      // schema ever seeing it. Every record meets the schema now, including the
      // thinnest one there is.
      seats.push(minter(factory)({ id: manifest.id, config: settings }));
    } catch (error) {
      // The flow's own refusal, with the worker's id in front of it, and — when
      // the kind's shape says what most likely went wrong — one sentence naming
      // the fix. Still no check of our own: `admissionHint` cannot refuse.
      const message = messageOf(error);
      const hint = admissionHint(message);
      refuse(hint === undefined ? message : `${message} ${hint}`);
    }
  }

  if (problems.length > 0) {
    throw new Error(
      `hireWorkforce refused ${problems.length} of ${ordered.length} worker${ordered.length === 1 ? "" : "s"}; ` +
        `nothing was hired:\n  - ${problems.join("\n  - ")}`
    );
  }

  return seats;
}
