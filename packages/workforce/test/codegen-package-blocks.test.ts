/**
 * The package half of the code walk: `packages/<name>/blocks/` at the org,
 * team and worker levels.
 *
 * A package's tools are code, so they are found the way every other block in
 * the tree is — by `fsdev gen`, from the tree's shape, never by opening a
 * module — and rendered onto one map keyed by the package's address. Which
 * worker may call them is decided at the hire, not here: this map registers,
 * it grants nothing.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WorkforceCodeError, discoverWorkforceCode } from "../src/codegen/discover";
import { renderWorkforceCode } from "../src/codegen/render";

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "fsd-package-blocks-"));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

/**
 * Every block file here THROWS when imported. The walk must find it anyway,
 * which is the proof it never opens a module.
 */
const UNOPENABLE = 'throw new Error("a package block was opened by the walk");\n';

async function write(at: string, contents = UNOPENABLE): Promise<void> {
  const target = path.join(root, ...at.split("/"));
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, contents);
}

async function problemsOf(): Promise<string[]> {
  try {
    await discoverWorkforceCode(root);
    return [];
  } catch (error) {
    if (error instanceof WorkforceCodeError) return error.problems;
    throw error;
  }
}

describe("what a package's blocks folder registers", () => {
  it("finds a package's blocks at all three levels, keyed by the package's address, without opening them", async () => {
    await write("org/packages/house/blocks/cite.ts");
    await write("teams/support/packages/escalation/blocks/page-oncall.ts");
    await write("teams/support/workers/clerk/packages/refunds/blocks/issue-refund.ts");
    await write("teams/support/workers/clerk/packages/refunds/blocks/void-refund.tsx");

    const found = await discoverWorkforceCode(root);
    expect(found.packageBlocks).toEqual([
      {
        package: "org/packages/house",
        name: "cite",
        path: "org/packages/house/blocks/cite.ts",
        importPath: "./org/packages/house/blocks/cite",
      },
      {
        package: "teams/support/packages/escalation",
        name: "page-oncall",
        path: "teams/support/packages/escalation/blocks/page-oncall.ts",
        importPath: "./teams/support/packages/escalation/blocks/page-oncall",
      },
      {
        package: "teams/support/workers/clerk/packages/refunds",
        name: "issue-refund",
        path: "teams/support/workers/clerk/packages/refunds/blocks/issue-refund.ts",
        importPath: "./teams/support/workers/clerk/packages/refunds/blocks/issue-refund",
      },
      {
        package: "teams/support/workers/clerk/packages/refunds",
        name: "void-refund",
        path: "teams/support/workers/clerk/packages/refunds/blocks/void-refund.tsx",
        importPath: "./teams/support/workers/clerk/packages/refunds/blocks/void-refund",
      },
    ]);
  });

  it("registers no package block as a seat block, so no worker can name one by registration", async () => {
    await write("teams/support/workers/clerk/packages/refunds/blocks/issue-refund.ts");
    const found = await discoverWorkforceCode(root);
    expect(found.seatBlocks).toEqual([]);
    expect(found.files).toEqual([]);
  });

  it("finds nothing for a package with no blocks/ folder", async () => {
    await write("teams/support/packages/tone/PACKAGE.md", "---\ndescription: Tone\n---\n");
    expect((await discoverWorkforceCode(root)).packageBlocks).toEqual([]);
  });

  it("refuses a package block whose name breaks the segment rules (BR-22's file half)", async () => {
    await write("teams/support/packages/escalation/blocks/Page_Oncall.ts");
    expect(await problemsOf()).toEqual([
      expect.stringContaining('"teams/support/packages/escalation/blocks/Page_Oncall.ts"'),
    ]);
  });

  it("refuses one basename claimed by two files in one package", async () => {
    await write("teams/support/packages/escalation/blocks/page.ts");
    await write("teams/support/packages/escalation/blocks/page.tsx");
    expect(await problemsOf()).toEqual([expect.stringContaining("one basename, one block")]);
  });

  it("refuses a package folder whose name breaks the segment rules (BR-25)", async () => {
    await write("teams/support/packages/Escalation/blocks/page.ts");
    expect(await problemsOf()).toEqual([expect.stringContaining('"teams/support/packages/Escalation"')]);
  });

  it("refuses a directory where a package block belongs", async () => {
    await write("teams/support/packages/escalation/blocks/nested/page.ts");
    expect(await problemsOf()).toEqual([expect.stringContaining("is a directory")]);
  });

  it("does not look in a package under an org-level worker, which is no seat", async () => {
    // `org/workers/<w>/` holds no hireable seat, so a package there would be
    // held by nobody. The loader does not read it either; neither door
    // pretends it is a level.
    await write("org/workers/build/packages/kit/blocks/tool.ts");
    expect((await discoverWorkforceCode(root)).packageBlocks).toEqual([]);
  });
});

describe("the rendered packageBlocks map", () => {
  it("renders one entry per package, keyed by address then block name", async () => {
    await write("teams/support/workers/clerk/packages/refunds/blocks/issue-refund.ts");
    await write("teams/support/packages/escalation/blocks/page-oncall.ts");

    const found = await discoverWorkforceCode(root);
    const text = renderWorkforceCode(found.files, found.resourceModules, found.seatBlocks, found.packageBlocks);

    expect(text).toContain(
      'import packageblock_teams__support__packages__escalation__page_oncall from "./teams/support/packages/escalation/blocks/page-oncall";',
    );
    expect(text).toContain(
      "export const packageBlocks = {\n" +
        '  "teams/support/packages/escalation": {\n' +
        '    "page-oncall": packageblock_teams__support__packages__escalation__page_oncall,\n' +
        "  },\n" +
        '  "teams/support/workers/clerk/packages/refunds": {\n' +
        '    "issue-refund": packageblock_teams__support__workers__clerk__packages__refunds__issue_refund,\n' +
        "  },\n" +
        "} satisfies Record<string, Record<string, BlockDefinition>>;",
    );
    expect(text).toContain('import type { BlockDefinition } from "@flow-state-dev/core";');
  });

  it("renders an empty map for a tree with none", async () => {
    const found = await discoverWorkforceCode(root);
    const text = renderWorkforceCode(found.files, found.resourceModules, found.seatBlocks, found.packageBlocks);
    expect(text).toContain("export const packageBlocks = {};");
    expect(text).not.toContain("BlockDefinition");
  });
});
