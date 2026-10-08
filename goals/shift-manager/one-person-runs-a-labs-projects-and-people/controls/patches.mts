/**
 * The scratch patches (S3): `extra-flow` (leg c's boot 1), `no-cos` and
 * `no-tool`. `deny-fire` is a click, not a patch.
 *
 * Each is applied to a scratch copy of the commit's DevTeam Lab, never to the
 * Lab itself, and never committed: the DevTeam profile, which holds its tree
 * and host (`packages/shift-manager/teams/devteam/`), is copied beside itself.
 * The copy sits where the original sits, so every package and relative import
 * resolves as it does for the shipped Lab. The whole difference from the commit
 * is printed in the report ({@link ScratchLab.diff}), and the copy is deleted
 * when the run ends.
 */
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "../../../lib/index.mts";

const PROFILE = join(REPO_ROOT, "packages", "shift-manager", "teams", "devteam");

/** One edit to a scratch copy of the Lab: its name, and what it does to the copy at `lab`. */
export type Patch = { name: string; apply(lab: string): void };

/** The door of {@link extraFlow}'s flow: the one action that takes a person's message. */
export const EXTRA_FLOW_DOOR = "run";

/**
 * One more worker flow for leg c's boot 1, registered under `flow` beside the
 * Lab's own, so a person's worker can be hired onto it. Its door answers with
 * the worker its session names, as `resolveWorker` loads it on the turn: a
 * turn that runs proves the worker runs on that flow. No model.
 */
export function extraFlow(flow: string): Patch {
  return {
    name: "extra-flow",
    apply(lab) {
      const host = join(lab, "host.mts");
      let text = readFileSync(host, "utf8");
      const anchor = "  const copies = hireWorkforce(installation, { mailboxBoards: mailboxBoardIds(roster.mailboxes) });";
      if (!text.includes(anchor)) throw new Error("extra-flow: host.mts no longer has the line this patch edits");
      const k = JSON.stringify(flow);
      const door = JSON.stringify(EXTRA_FLOW_DOOR);
      text = text.replace(
        anchor,
        [
          `  // extra-flow: one more worker flow, ${k}, on this installation.`,
          `  kinds[${k}] = defineFlow({`,
          `    kind: ${k},`,
          `    configSchema: scratchWorkerConfigSchema(),`,
          `    session: installation.session(),`,
          `    resources: { ...installation.resources },`,
          `    actions: {`,
          `      [${door}]: {`,
          `        inputSchema: z.object({ message: z.string() }),`,
          `        userMessage: (input: { message: string }) => input.message,`,
          `        block: handler({`,
          `          name: ${JSON.stringify(`${flow}-${EXTRA_FLOW_DOOR}`)},`,
          `          inputSchema: z.object({ message: z.string() }),`,
          `          resources: { ...installation.resources },`,
          `          execute: async (_input: { message: string }, ctx: any) => {`,
          `            const worker = await installation.resolveWorker(ctx, ${k});`,
          `            return { worker: worker.id, flow: worker.flow };`,
          `          },`,
          `        }),`,
          `      },`,
          `    },`,
          `  } as never) as never;`,
          ``,
          anchor,
        ].join("\n"),
      );
      writeFileSync(host, `import { workerConfigSchema as scratchWorkerConfigSchema } from "@flow-state-dev/workforce";\n${text}`);
    },
  };
}

/** The chief of staff's document removed. */
export const noCos: Patch = {
  name: "no-cos",
  apply(lab) {
    // The tree loader refuses a worker folder with no WORKER.md, so removing
    // CoS's WORKER.md means removing its folder: the seat is simply not declared.
    const folder = join(lab, "workforce", "org", "workers", "chief-of-staff");
    if (!existsSync(join(folder, "WORKER.md"))) throw new Error("no-cos: the tree has no chief-of-staff WORKER.md to remove");
    rmSync(folder, { recursive: true, force: true });
  },
};

/** `createProject` removed from the chief of staff's `tools:`. */
export const noTool: Patch = {
  name: "no-tool",
  apply(lab) {
    const doc = join(lab, "workforce", "org", "workers", "chief-of-staff", "WORKER.md");
    const text = readFileSync(doc, "utf8");
    const line = /^tools: \[(.*)\]$/m.exec(text);
    if (line === null || !line[1]!.split(",").map((t) => t.trim()).includes("createProject")) throw new Error("no-tool: CoS's tools: line names no createProject");
    const kept = line[1]!.split(",").map((t) => t.trim()).filter((t) => t !== "createProject");
    writeFileSync(doc, text.replace(line[0], `tools: [${kept.join(", ")}]`));
  },
};

/** A patched copy of the DevTeam Lab, served by its own profile config. */
export interface ScratchLab {
  /** The copy's DevTeam profile config, for `--config`. */
  config: string;
  /** `diff -ruN` from the commit to the copy. */
  diff: string;
  remove(): void;
}

/** Copy the Lab's profile, apply `patches`, and say exactly what differs. */
export function scratchLab(tag: string, patches: Patch[]): ScratchLab {
  const name = `${patches.map((p) => p.name).join("+")}-${tag}`;
  const lab = `${PROFILE}-${name}`;
  cpSync(PROFILE, lab, { recursive: true });
  const remove = () => rmSync(lab, { recursive: true, force: true });
  try {
    const config = join(lab, "fsdev.config.mts");
    for (const patch of patches) patch.apply(lab);
    const diff = spawnSync("diff", ["-ruN", PROFILE, lab], { encoding: "utf8", maxBuffer: 1 << 24 }).stdout.replaceAll(REPO_ROOT + "/", "");
    return { config, diff, remove };
  } catch (error) {
    remove();
    throw error;
  }
}
