/**
 * The goal's module patches, applied to the served install as its process
 * loads each module (`goals/lib/module-patch.mjs`). Nothing is written to the
 * checkout, and every patch is printed in full before the run.
 *
 * Two scratch patches every run carries, because the install has neither:
 *
 * - `second-org`: one more verified bearer on the DevTeam host, naming the
 *   Lab's owner (Alice) in a second organization. Every other principal
 *   resolves as shipped.
 * - `entry-writer`: the host's flow record gains `goal-entry-writer`
 *   (`flows/entry-writer.mts`), flow code writing the workstream entries
 *   directly, so leg b can try Bob's write through a registered flow.
 *
 * Two controls, each the one behaviour it names removed:
 *
 * - `no-owner-rule`: the engine's owner-writes check (`ownerWriteRefusal`)
 *   never refuses, so the store takes a write to an entry from anyone the
 *   scope serves. Leg b must fail on `b:bobs-write-refused`. (Dropping
 *   `ownerWrites` from the entries' declaration instead doesn't isolate it:
 *   an owner-keyed collection without it reads as owner-private, and the
 *   open itself is refused before any write is tried.)
 * - `all-entries-delegate`: a project coordinator takes every open entry in
 *   its project as a delegate, its owner's or not: its seed keeps every
 *   entry, its delivery resolves a workstream under whichever owner holds
 *   that id, and its delegate check takes a worker that isn't on the
 *   conversation's user's roster. Leg c must fail on `c:never-to-bobs`.
 *
 * Each anchor reads the same in the TypeScript source and in tsx's output.
 * A module that has nothing matching fails before the run, and the run fails
 * when a patch never reached the code it served (`assertPatched`).
 */
import { pathToFileURL } from "node:url";
import { describePatches, modulePatchEnv, type ModulePatch } from "../../../lib/module-patch.mts";
import { ENTRY_WRITER_KIND } from "../flows/entry-writer.mts";

export { ENTRY_WRITER_KIND };

/** Alice's second organization: the bearer `second-org` adds names her there. */
export const SECOND_ORG = { orgId: "devforce-lab-second", bearer: "devforce-lab-verified-owner-second-org" } as const;

const HOST = "packages/shift-manager/teams/devteam/host.mts";
const ENTRY_WRITER = new URL("../flows/entry-writer.mts", import.meta.url);

/** The patches every run carries. */
export const SCRATCH: Record<"second-org" | "entry-writer", ModulePatch> = {
  "second-org": {
    module: HOST,
    from: String.raw`const resolveLabPrincipal: PrincipalResolver = async \(context\) => \{`,
    to:
      `labBearers.push(createBearerSecretPrincipalResolver({ secret: ${JSON.stringify(SECOND_ORG.bearer)}, ` +
      `principal: { userId: LAB_USER_ID, orgId: ${JSON.stringify(SECOND_ORG.orgId)} } }));\n` +
      "const resolveLabPrincipal: PrincipalResolver = async (context) => {",
  },
  "entry-writer": {
    module: HOST,
    from: String.raw`\[PROJECTS_FLOW\]: projectsFlow,`,
    to: `[PROJECTS_FLOW]: projectsFlow, ...(await import(${JSON.stringify(pathToFileURL(ENTRY_WRITER.pathname).href)})).goalFlows(),`,
  },
};

/** The controls this goal understands. */
export const CONTROL_NAMES = ["no-owner-rule", "all-entries-delegate"] as const;
export type ControlName = (typeof CONTROL_NAMES)[number];

/** One control: the legs it runs, the one assertion it must fail, and its patches. */
export interface Control {
  name: ControlName;
  legs: readonly ("a" | "b" | "c")[];
  assertion: string;
  does: string;
  patches: readonly ModulePatch[];
}

export const CONTROLS: Record<ControlName, Control> = {
  "no-owner-rule": {
    name: "no-owner-rule",
    // Leg c reads a store this control let Bob write into; it has no claim about the owner rule.
    legs: ["a", "b"],
    assertion: "b:bobs-write-refused",
    does:
      "the engine's owner rule never refuses: a row of an owner-writes collection is written by anyone the scope serves, " +
      "at the store and on the resource routes",
    patches: [
      {
        module: "packages/engine/src/resources/owner-private.ts",
        from: String.raw`\? undefined : OWNER_WRITE_REFUSAL;`,
        to: "? undefined : undefined;",
      },
    ],
  },
  "all-entries-delegate": {
    name: "all-entries-delegate",
    legs: ["a", "b", "c"],
    assertion: "c:never-to-bobs",
    does:
      "a project coordinator seeds every open entry in its project as a delegate, resolves a workstream under " +
      "whichever owner holds its id, and its delegate check takes a worker off the user's roster",
    patches: [
      {
        module: "packages/workforce/src/projects/project-coordinator.ts",
        from: String.raw`entry\.owner === user && `,
        to: "",
      },
      {
        module: "packages/workforce/src/projects/project-coordinator.ts",
        from: String.raw`workstreamEntryKey\(project\.id, userOf\(ctx\), address\.id\)`,
        to: "workstreamEntryKey(project.id, (await projectEntries(ctx, project)).find((e) => e.id === address.id)?.owner ?? userOf(ctx), address.id)",
      },
      {
        module: "packages/workforce/src/delegates/delegate-check.ts",
        from: String.raw`if \(worker === (?:undefined|void 0)\) return \{ ok: false,`,
        to: 'if (worker === undefined) return { ok: true, worker: { id: workerId, flow: "agent", description: null }, takesPost: true,',
      },
    ],
  },
};

/** The patches a run carries: the scratch ones, and the control's when there is one. */
export function patchesFor(control: Control | undefined): ModulePatch[] {
  return [SCRATCH["second-org"], SCRATCH["entry-writer"], ...(control?.patches ?? [])];
}

/** The environment that applies `patches` to the served process, marking each patched file in `mark`. */
export function patchEnv(patches: readonly ModulePatch[], root: string, mark: string): Record<string, string> {
  return modulePatchEnv(patches, root, mark);
}

export { describePatches };
