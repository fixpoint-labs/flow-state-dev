/**
 * `hireWorkforce` — the seat factory: one worker record becomes one addressable,
 * configured copy of a flow the app already defined.
 *
 * A pure, synchronous map. It reads no files, opens no connections, registers
 * nothing, and builds no flow graph: the record says WHICH flow kind a worker
 * runs and HOW it is configured, never what it does step by step. The caller
 * registers what comes back, so a workforce read from disk and one written by
 * hand reach the registry by the same door.
 *
 * The factory reads two keys — `flow` and `description`. Everything else the
 * record declared is handed to the flow verbatim, and the flow's own
 * `configSchema` (closed before parsing) decides what is allowed. That is also
 * how a worker's instructions are carried: a non-empty body becomes one
 * setting, `persona`, so a flow that never declared one refuses the body by
 * name at the hire rather than each worker flow having to check for it.
 */

import type { FlowInstance } from "@flow-state-dev/core/types";
import type { WorkerManifest } from "./manifest";

/** The two keys the factory itself reads. Everything else is the worker's settings. */
const RESERVED_KEYS = ["flow", "description"] as const;

/** The single setting name the factory imposes: where a worker's body arrives. */
const PERSONA_KEY = "persona";

export interface HireOptions {
  /**
   * Flow factories by kind, as the app defined them — what `defineFlow(...)`
   * returns, called once per worker to mint that worker's copy. A record's
   * `flow` names one.
   */
  kinds: Record<string, (options: { id: string; config?: Record<string, unknown> }) => FlowInstance>;
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

    try {
      // The settings parse happens inside: the flow's own `configSchema` is
      // closed before parsing, so an undeclared key refuses by name (`persona`
      // included), a missing required one refuses, and the bag comes back
      // frozen. No validation of our own — naming the worker is the whole
      // contribution. A record that declared nothing passes no bag at all, so
      // a flow kind that declares no `configSchema` still hires a thin seat.
      seats.push(
        factory(
          Object.keys(settings).length > 0
            ? { id: manifest.id, config: settings }
            : { id: manifest.id }
        )
      );
    } catch (error) {
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
