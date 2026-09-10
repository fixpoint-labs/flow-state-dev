/**
 * The seat factory: a worker record becomes one addressable, configured copy of
 * a flow the app already defined.
 *
 * The design fact the rest of this file follows from: the flow's own closed
 * `configSchema` is the only gatekeeper. This module reads `flow` and
 * `description` and hands over everything else — a worker's instructions
 * included, as one setting, `persona`.
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
import type { WorkerManifest } from "./manifest";

/** The two keys the factory itself reads. Everything else is the worker's settings. */
const RESERVED_KEYS = ["flow", "description"] as const;

/** The single setting name the factory imposes: where a worker's body arrives. */
const PERSONA_KEY = "persona";

export interface HireOptions {
  /**
   * The flows the app defined, by kind — `defineFlow(...)` results, passed
   * directly. A record's `flow` names one, and it is called once per worker to
   * mint that worker's copy.
   */
  kinds: Record<string, AnyFlowType>;
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

/**
 * Turn worker records into one configured flow copy each, ordered by id.
 *
 * Every problem is a startup misconfiguration, so every problem throws — but
 * they are collected first, so one run names all of them and an author fixes
 * them in one pass. Nothing is returned partially: a refusal after a partial
 * hire would not be a refusal.
 *
 * @param manifests The roster — from the loader, or hand-built.
 * @param options   `kinds`: the flow factories the app defined.
 * @returns One `FlowInstance` per record, ordered by id. Register these.
 * @throws If any record cannot be hired; the message names every bad worker.
 */
export function hireWorkforce(
  manifests: WorkerManifest[],
  options: HireOptions
): FlowInstance[] {
  const kindNames = Object.keys(options.kinds);
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

    // A body is instructions; whitespace is not. An empty string handed to a
    // flow that declares `persona` would be a worse lie than omitting it — and
    // it would turn every thin seat into a failed hire.
    if (manifest.body.trim().length > 0) {
      if (Object.hasOwn(settings, PERSONA_KEY)) {
        refuse(
          `declares "${PERSONA_KEY}" in its frontmatter and carries a body — two sources for one ` +
            `setting, and there is no precedence rule. Remove one: a worker's instructions are ` +
            `handed to its flow as "${PERSONA_KEY}".`
        );
        continue;
      }
      // Verbatim: the check is on the trimmed body, the value is the body.
      settings[PERSONA_KEY] = manifest.body;
    }

    const kind = manifest.declared.flow;
    if (typeof kind !== "string" || kind.trim().length === 0) {
      // The code door the loader records but this issue has not wired. Told
      // apart from a malformed record on purpose: the author did not make a
      // mistake, they used a door that is not open yet, and the generic
      // missing-flow message would read as the former.
      refuse(
        manifest.codePath !== undefined
          ? "`worker.ts` is recorded but not yet wired; give this seat a `flow:` or remove the folder"
          : "declares no `flow:`, so there is no flow kind to hire it into"
      );
      continue;
    }

    // `hasOwn` rather than a bare lookup: a record's `flow` is author-supplied,
    // and `kinds["constructor"]` would otherwise resolve off the prototype and
    // hand us something that is not a flow factory at all.
    const factory = Object.hasOwn(options.kinds, kind) ? options.kinds[kind] : undefined;
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

    try {
      // A record that declared nothing passes no bag at all: `{}` is refused by
      // a flow kind that declares no `configSchema`, which would make a thin
      // seat unhireable. For a flow that declares one the two are identical.
      seats.push(
        minter(factory)(
          Object.keys(settings).length > 0
            ? { id: manifest.id, config: settings }
            : { id: manifest.id }
        )
      );
    } catch (error) {
      // The flow's own refusal, with the worker's id in front of it. Adding a
      // check of our own here would be a second gatekeeper.
      refuse(messageOf(error));
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
