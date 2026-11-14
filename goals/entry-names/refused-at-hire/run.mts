/**
 * Goal check — an entry the framework calls is named by its documented
 * string, and a piece an entry factory built, under any other name, is
 * refused when the flow is defined or hired, naming the string.
 *
 * Real path, no model: for each entry factory, a worker flow an app could
 * write is built on the installation the workforce kit hires (or, for
 * a board's `onTaskSettled`, defined with `defineFlow`), once under the
 * documented name and once under each typo the fixture holds. Graded on what
 * the hire or the definition does: the twin under the right name is hired,
 * and each typo is refused with a message naming the typo and the right name.
 *
 * See goal.md for the contract and the source-revert control.
 *
 * Run: pnpm tsx goals/entry-names/refused-at-hire/run.mts
 */
import { defineFlow, handler } from "@flow-state-dev/core";
import {
  defineSessionBoard,
  messageReceivedEntry,
  steerTurnEntry,
  workerConfigSchema,
  workerMessagesResources,
  workerTaskEntry,
  workerFlow,
  workstreamOpenedEntry,
  type WorkerInstallation,
  type WorkerRole,
} from "@flow-state-dev/workforce";
import { z } from "zod";
import { hearsMessages, installWorkers, loadFixture, runGoal, workerDoor, workforceTree } from "../../lib/index.mts";

type Fixture = { typos: Record<string, string>[] };

const fixture = loadFixture<Fixture>(import.meta.url);

const message = z.object({ message: z.string() });
const turn = handler({ name: "entry-names-turn", inputSchema: message, outputSchema: z.object({}), execute: () => ({}) });

/** One entry factory's leg: how a worker flow an app writes declares the entry under `key`. */
type Leg = {
  /** The documented name. */
  readonly entry: string;
  readonly factory: string;
  /** The flow's definition, with the factory's piece under `key`. */
  readonly define: (installation: WorkerInstallation, kind: string, key: string) => unknown;
  readonly roles?: readonly WorkerRole[];
};

const base = (installation: WorkerInstallation, kind: string) => ({
  kind,
  cardinality: "collection",
  configSchema: workerConfigSchema(),
  session: installation.session(),
  resources: { ...installation.resources, ...workerMessagesResources },
  actions: { ...workerDoor },
});

const LEGS: readonly Leg[] = [
  {
    entry: "work",
    factory: "workerTaskEntry",
    roles: ["contributor"],
    define: (installation, kind, key) =>
      defineFlow({
        ...base(installation, kind),
        internal: { actions: hearsMessages(installation, kind) },
        task: { actions: { [key]: workerTaskEntry({ name: `${kind}-work`, turn }) } },
      } as never),
  },
  {
    entry: "onTaskSteered",
    factory: "steerTurnEntry",
    define: (installation, kind, key) =>
      defineFlow({
        ...base(installation, kind),
        internal: { actions: { ...hearsMessages(installation, kind), [key]: steerTurnEntry({ name: `${kind}-steer`, turn }) } },
      } as never),
  },
  {
    entry: "onMessageReceived",
    factory: "messageReceivedEntry",
    define: (installation, kind, key) =>
      defineFlow({
        ...base(installation, kind),
        internal: { actions: { [key]: messageReceivedEntry({ installation, flowKind: kind }) } },
      } as never),
  },
  {
    entry: "onWorkstreamOpened",
    factory: "workstreamOpenedEntry",
    define: (installation, kind, key) =>
      defineFlow({
        ...base(installation, kind),
        internal: { actions: { ...hearsMessages(installation, kind), [key]: workstreamOpenedEntry() } },
      } as never),
  },
  {
    // A worker flow that holds a board: the session board's pieces spread
    // into their slots, its `onTaskSettled` (orchestration's
    // `taskSettledEntry`) under `key`.
    entry: "onTaskSettled",
    factory: "taskSettledEntry",
    roles: ["manager"],
    define: (installation, kind, key) => {
      const board = defineSessionBoard({ installation, flowKind: kind });
      const { onTaskSettled, ...entries } = board.entries(turn) as Record<string, unknown>;
      return defineFlow({
        ...base(installation, kind),
        session: { ...installation.session(board.sessionStateShape), serverOwned: [...board.serverOwned] },
        resources: { ...installation.resources, ...board.resources },
        actions: { ...workerDoor, ...board.actions },
        internal: { actions: { ...entries, [key]: onTaskSettled } },
      } as never);
    },
  },
];

/** Define and hire one leg's flow with its piece under `key`, through the workforce kit: the refusal's message, or `null` when it was hired. */
async function hireUnder(leg: Leg, key: string): Promise<string | null> {
  const kind = `entry-${leg.entry.toLowerCase()}`;
  const build = (installation: WorkerInstallation) => leg.define(installation, kind, key);
  try {
    await installWorkers(workforceTree([]), { [kind]: workerFlow(build, leg.roles === undefined ? {} : { roles: leg.roles }) });
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

await runGoal(async (failures, tell) => {
  const evidence: string[] = [];
  const typoSets = tell.over("fixture typo sets", fixture.typos);
  for (const leg of LEGS) {
    // The twin under the documented name is hired, so a refusal below is the name's, not the flow's.
    const twin = await hireUnder(leg, leg.entry);
    if (twin !== null) {
      failures.push(`[${leg.entry}] the flow with \`${leg.factory}\` under "${leg.entry}" was refused: ${twin}`);
      continue;
    }
    for (const typos of typoSets) {
      const typo = typos[leg.entry];
      if (typo === undefined || typo === leg.entry) {
        failures.push(`[${leg.entry}] the fixture holds no typo for "${leg.entry}"`);
        continue;
      }
      const refusal = await hireUnder(leg, typo);
      if (refusal === null) {
        failures.push(`[${leg.entry}] \`${leg.factory}\` under "${typo}" was hired`);
        continue;
      }
      if (!refusal.includes(`"${leg.entry}"`) && !refusal.includes(`\`${leg.entry}\``)) {
        failures.push(`[${leg.entry}] the refusal of "${typo}" doesn't name "${leg.entry}": ${refusal}`);
        continue;
      }
      evidence.push(`${leg.entry}: "${typo}" refused`);
    }
  }
  return { failures, evidence: `${evidence.length} misnamed pieces refused, each naming its entry; every twin under its documented name hired (${evidence.join("; ")})` };
});
