/**
 * The per-seat half of the code walk: `blocks/` folders inside the team tree.
 *
 * Three levels register a block name, and a seat resolves a name through them
 * nearest first — its own folder, then its team's, then the app's catalog
 * (`workforce/blocks/`, which the locked-folder walk beside this one already
 * reads). The walk collapses the first two per seat, because resolution is a
 * build-time property of the tree and nothing scans a folder while an app runs.
 *
 * What it refuses is as load-bearing as what it reads: a `blocks/` folder
 * anywhere no seat can see it, and a `tools/` folder anywhere at all, are the
 * two shapes an author is most likely to write by guessing. Silence there is
 * what produced this convention's confusion in the first place.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WorkforceCodeError, discoverWorkforceCode } from "../src/codegen/discover";
import { renderWorkforceCode } from "../src/codegen/render";

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "fsd-seat-blocks-"));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

async function write(at: string, contents = "export default {};\n"): Promise<void> {
  const target = path.join(root, ...at.split("/"));
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, contents);
}

/** Every refusal one walk produced, or `[]` when it produced none. */
async function problemsOf(): Promise<string[]> {
  try {
    await discoverWorkforceCode(root);
    return [];
  } catch (error) {
    if (error instanceof WorkforceCodeError) return error.problems;
    throw error;
  }
}

describe("what a seat's blocks folder registers", () => {
  it("registers a worker's own block for that seat alone", async () => {
    await write("teams/support/workers/clerk/blocks/check-inventory.ts");
    await write("teams/support/workers/desk/WORKER.md", "---\ndescription: Desk.\n---\n");

    const found = await discoverWorkforceCode(root);
    expect(found.seatBlocks).toEqual([
      {
        seat: "support.clerk",
        name: "check-inventory",
        level: "worker",
        path: "teams/support/workers/clerk/blocks/check-inventory.ts",
        importPath: "./teams/support/workers/clerk/blocks/check-inventory",
      },
    ]);
  });

  it("registers a team's block for every seat on that team", async () => {
    await write("teams/support/blocks/desk-note.ts");
    await write("teams/support/workers/clerk/WORKER.md", "---\ndescription: Clerk.\n---\n");
    await write("teams/support/workers/desk/WORKER.md", "---\ndescription: Desk.\n---\n");

    const found = await discoverWorkforceCode(root);
    expect(found.seatBlocks.map((entry) => `${entry.seat}:${entry.name}`)).toEqual([
      "support.clerk:desk-note",
      "support.desk:desk-note",
    ]);
    // One file, one import, whatever the seat count.
    expect(new Set(found.seatBlocks.map((entry) => entry.importPath)).size).toBe(1);
  });

  it("does not register another team's block", async () => {
    await write("teams/support/blocks/desk-note.ts");
    await write("teams/support/workers/clerk/WORKER.md", "---\ndescription: Clerk.\n---\n");
    await write("teams/billing/workers/agent/WORKER.md", "---\ndescription: Agent.\n---\n");

    const found = await discoverWorkforceCode(root);
    expect(found.seatBlocks.map((entry) => entry.seat)).toEqual(["support.clerk"]);
  });

  // The owner's precedence, at the only place the tree can express it: nearest
  // level wins, and the far one is not also registered under the same name.
  it("lets a worker's own block shadow its team's of the same name", async () => {
    await write("teams/support/blocks/summarize.ts");
    await write("teams/support/workers/clerk/blocks/summarize.ts");

    const found = await discoverWorkforceCode(root);
    expect(found.seatBlocks).toHaveLength(1);
    expect(found.seatBlocks[0]).toMatchObject({
      seat: "support.clerk",
      name: "summarize",
      level: "worker",
    });
  });

  it("finds nothing, and refuses nothing, for a tree with no blocks folders", async () => {
    await write("teams/support/workers/clerk/WORKER.md", "---\ndescription: Clerk.\n---\n");
    const found = await discoverWorkforceCode(root);
    expect(found.seatBlocks).toEqual([]);
  });

  // The sibling doors both refuse a basename claimed twice, and this one has to
  // as well — not for symmetry, but because the failure is silent: two files
  // reduce to one name and one extensionless import path, so `fsdev gen` exits
  // 0 and emits a module with a duplicate binding and a duplicate map key that
  // no bundler can compile.
  //
  // Asserted on the EMITTED MODULE, not on the exit code, because the exit code
  // was already 0 when this was broken.
  it("refuses one basename claimed by two files in a blocks folder", async () => {
    await write("teams/support/workers/clerk/blocks/foo.ts");
    await write("teams/support/workers/clerk/blocks/foo.tsx");

    const problems = await problemsOf();
    const message = problems.join("\n");
    expect(message).toContain("foo.ts");
    expect(message).toContain("foo.tsx");
    expect(message).toContain("one basename");
  });

  it("refuses the same duplicate at the team level", async () => {
    await write("teams/support/blocks/foo.ts");
    await write("teams/support/blocks/foo.tsx");
    expect((await problemsOf()).join("\n")).toContain("one basename");
  });

  // Falsifiability: one name per folder must still pass, and the SAME basename
  // in two different folders is the shadow rule rather than a duplicate.
  it("does not refuse one basename per folder, or a shadowed name across levels", async () => {
    await write("teams/support/blocks/foo.ts");
    await write("teams/support/workers/clerk/blocks/foo.ts");
    await write("teams/support/workers/clerk/blocks/bar.tsx");
    expect(await problemsOf()).toEqual([]);
  });

  it("emits a module with no repeated import binding or map key", async () => {
    await write("teams/support/workers/clerk/blocks/only.ts");
    const found = await discoverWorkforceCode(root);
    const module = renderWorkforceCode(found.files, found.resourceModules, found.seatBlocks);

    const bindings = [...module.matchAll(/^import (\w+) from/gm)].map((m) => m[1]!);
    expect(new Set(bindings).size).toBe(bindings.length);
  });

  it("refuses a basename that breaks the segment rules", async () => {
    await write("teams/support/workers/clerk/blocks/CheckInventory.ts");
    const problems = await problemsOf();
    expect(problems.join("\n")).toContain("CheckInventory");
  });

  it("refuses a directory sitting where a block file belongs", async () => {
    await write("teams/support/workers/clerk/blocks/nested/thing.ts");
    const problems = await problemsOf();
    expect(problems.join("\n")).toContain("teams/support/workers/clerk/blocks/nested");
  });

  it("orders deterministically by path", async () => {
    await write("teams/support/workers/clerk/blocks/zebra.ts");
    await write("teams/support/workers/clerk/blocks/apple.ts");
    await write("teams/alpha/workers/one/blocks/mango.ts");

    const found = await discoverWorkforceCode(root);
    expect(found.seatBlocks.map((entry) => entry.path)).toEqual([
      "teams/alpha/workers/one/blocks/mango.ts",
      "teams/support/workers/clerk/blocks/apple.ts",
      "teams/support/workers/clerk/blocks/zebra.ts",
    ]);
  });
});

describe("the folders that are refused rather than passed over", () => {
  it("refuses a `blocks/` folder at the organisation level, naming where one may sit", async () => {
    await write("org/blocks/house.ts");
    const problems = await problemsOf();
    const message = problems.join("\n");
    expect(message).toContain("org/blocks");
    expect(message).toContain("workforce/blocks/");
  });

  it("refuses a `blocks/` folder beside an org-level worker", async () => {
    await write("org/workers/build/blocks/house.ts");
    const problems = await problemsOf();
    expect(problems.join("\n")).toContain("org/workers/build/blocks");
  });

  it("refuses a `tools/` folder wherever it sits", async () => {
    await write("tools/desk.ts");
    await write("org/tools/house.ts");
    await write("teams/support/tools/team.ts");
    await write("teams/support/workers/clerk/tools/own.ts");

    const problems = await problemsOf();
    const message = problems.join("\n");
    for (const at of [
      "tools",
      "org/tools",
      "teams/support/tools",
      "teams/support/workers/clerk/tools",
    ]) {
      expect(message).toContain(`"${at}"`);
    }
    expect(message).toContain("blocks/");
  });


  // `classify` answers for a symlink separately from a directory, which is
  // exactly where a refusal hides: the mistaken layout ships in its symlink
  // form with nothing said. Same lesson as the symlink-containment work earlier
  // in this convention.
  it("refuses a symlinked `tools/` folder rather than passing it over", async () => {
    await write("teams/support/workers/clerk/blocks/real.ts");
    await fs.symlink(
      path.join(root, "teams", "support", "workers", "clerk", "blocks"),
      path.join(root, "teams", "support", "workers", "clerk", "tools"),
    );
    const message = (await problemsOf()).join("\n");
    expect(message).toContain("teams/support/workers/clerk/tools");
  });

  it("refuses a symlinked `blocks/` folder at a level no seat reads", async () => {
    await fs.mkdir(path.join(root, "elsewhere"), { recursive: true });
    await fs.mkdir(path.join(root, "org"), { recursive: true });
    await fs.symlink(path.join(root, "elsewhere"), path.join(root, "org", "blocks"));
    expect((await problemsOf()).join("\n")).toContain("org/blocks");
  });

  // Falsifiability for the pair above: the supported folders must NOT be
  // refused, or the two checks would pass over any tree at all.
  it("refuses neither of the two supported places", async () => {
    await write("blocks/desk-note.ts");
    await write("teams/support/blocks/team-note.ts");
    await write("teams/support/workers/clerk/blocks/own-note.ts");
    expect(await problemsOf()).toEqual([]);
  });

  // A refusal anywhere writes no file, so a registry is never left quietly
  // short — the bargain the locked-folder walk already makes.
  it("generates nothing when any of them is present", async () => {
    await write("blocks/desk-note.ts");
    await write("teams/support/tools/team.ts");
    await expect(discoverWorkforceCode(root)).rejects.toThrow(WorkforceCodeError);
  });
});

describe("the rendered seatBlocks map", () => {
  it("renders one entry per seat, keyed by seat id then block name", async () => {
    await write("teams/support/blocks/desk-note.ts");
    await write("teams/support/workers/clerk/blocks/check-inventory.ts");

    const found = await discoverWorkforceCode(root);
    const module = renderWorkforceCode(found.files, found.resourceModules, found.seatBlocks);

    expect(module).toContain('"support.clerk": {');
    expect(module).toContain('"check-inventory":');
    expect(module).toContain('"desk-note":');
    expect(module).toContain("export const seatBlocks");
    // Typed, so the app's own typecheck reads every discovered file.
    expect(module).toContain("Record<string, Record<string, BlockDefinition>>");
  });

  it("renders an empty map for a tree with none, and imports no type for it", async () => {
    await write("teams/support/workers/clerk/WORKER.md", "---\ndescription: Clerk.\n---\n");
    const found = await discoverWorkforceCode(root);
    const module = renderWorkforceCode(found.files, found.resourceModules, found.seatBlocks);

    expect(module).toContain("export const seatBlocks = {};");
  });

  it("imports a team-level file once, however many seats register it", async () => {
    await write("teams/support/blocks/desk-note.ts");
    await write("teams/support/workers/clerk/WORKER.md", "---\ndescription: Clerk.\n---\n");
    await write("teams/support/workers/desk/WORKER.md", "---\ndescription: Desk.\n---\n");

    const found = await discoverWorkforceCode(root);
    const module = renderWorkforceCode(found.files, found.resourceModules, found.seatBlocks);

    const imports = module
      .split("\n")
      .filter((line) => line.includes("./teams/support/blocks/desk-note"));
    expect(imports).toHaveLength(1);
  });

  it("renders the same bytes for the same tree", async () => {
    await write("teams/support/workers/clerk/blocks/check-inventory.ts");
    const first = await discoverWorkforceCode(root);
    const second = await discoverWorkforceCode(root);
    expect(renderWorkforceCode(first.files, first.resourceModules, first.seatBlocks)).toBe(
      renderWorkforceCode(second.files, second.resourceModules, second.seatBlocks),
    );
  });
});
