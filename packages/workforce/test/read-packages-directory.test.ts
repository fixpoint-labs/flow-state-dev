/**
 * The package walker — every `packages/<name>/` at the org, team and worker
 * levels, read into records, and every shape a package may not take refused
 * with the file named.
 *
 * The premise first: before this reader existed, a `packages/` folder was read
 * by nothing and reported by nothing, so the suite opens by showing the walker
 * now finds one at each level. What follows is the refusal contract, and each
 * refusal is checked in a tree that ALSO holds a good package, so a walker that
 * refused everything could not pass it.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readPackagesDirectory } from "../src/loader/read-packages-directory";
import { readWorkforce } from "../src/loader/read-workforce";
import { readDeclaredRoster } from "../src/loader/read-declared-roster";

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "read-packages-"));
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

async function write(at: string, contents: string): Promise<void> {
  const target = path.join(root, ...at.split("/"));
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, contents);
}

const packageMd = (description: string, body = "Do the thing.\n"): string =>
  `---\ndescription: ${description}\n---\n${body}`;

const workerMd = (extra = ""): string => `---\ndescription: A worker.\n${extra}---\nWork.\n`;

/** One good package at each level, and a worker on the team for the joins. */
async function writeGoodTree(): Promise<void> {
  await write("org/packages/house-style/PACKAGE.md", packageMd("House style", "Write plainly.\n"));
  await write("teams/support/packages/escalation/PACKAGE.md", packageMd("Escalation", "Page on-call.\n"));
  await write("teams/support/packages/escalation/blocks/page-oncall.ts", "export default {};\n");
  await write("teams/support/workers/clerk/WORKER.md", workerMd());
  await write(
    "teams/support/workers/clerk/packages/refunds/PACKAGE.md",
    packageMd("Refunds", "Refund only against a looked-up invoice.\n")
  );
  await write("teams/support/workers/clerk/packages/refunds/blocks/issue-refund.ts", "export default {};\n");
}

describe("readPackagesDirectory finds packages at every level", () => {
  it("reads a package at the org, team and worker level, each with its address and text", async () => {
    await writeGoodTree();
    const { packages, errors } = await readPackagesDirectory(root);

    expect(errors).toEqual([]);
    expect(packages).toEqual([
      {
        name: "house-style",
        path: "org/packages/house-style",
        level: "org",
        description: "House style",
        instructions: "Write plainly.\n"
      },
      {
        name: "escalation",
        path: "teams/support/packages/escalation",
        level: "team",
        team: "support",
        description: "Escalation",
        instructions: "Page on-call.\n"
      },
      {
        name: "refunds",
        path: "teams/support/workers/clerk/packages/refunds",
        level: "worker",
        team: "support",
        worker: "support.clerk",
        description: "Refunds",
        instructions: "Refund only against a looked-up invoice.\n"
      }
    ]);
  });

  it("reads a package with no blocks/ folder: instructions only is valid (BR-19)", async () => {
    await write("teams/support/packages/tone/PACKAGE.md", packageMd("Tone"));
    const { packages, errors } = await readPackagesDirectory(root);
    expect(errors).toEqual([]);
    expect(packages.map((p) => p.path)).toEqual(["teams/support/packages/tone"]);
  });

  it("leaves instructions absent, not empty, for a whitespace body", async () => {
    await write("teams/support/packages/tool-only/PACKAGE.md", packageMd("A tool", "\n  \n"));
    const { packages } = await readPackagesDirectory(root);
    expect(Object.hasOwn(packages[0]!, "instructions")).toBe(false);
  });

  it("is empty and silent for a tree with no packages/ folders", async () => {
    await write("teams/support/workers/clerk/WORKER.md", workerMd());
    expect(await readPackagesDirectory(root)).toEqual({ packages: [], errors: [] });
  });
});

describe("readPackagesDirectory refuses what a package may not be", () => {
  it("refuses a package folder with no PACKAGE.md (BR-18)", async () => {
    await writeGoodTree();
    await write("teams/support/workers/clerk/packages/half/blocks/thing.ts", "export default {};\n");

    const { packages, errors } = await readPackagesDirectory(root);
    expect(errors.map((e) => e.path)).toEqual(["teams/support/workers/clerk/packages/half"]);
    expect(errors[0]!.error.message).toContain("PACKAGE.md");
    // The good packages still load: one bad folder costs nothing else.
    expect(packages.map((p) => p.name)).toEqual(["house-style", "escalation", "refunds"]);
  });

  it("refuses a PACKAGE.md with no frontmatter or an extra key, naming the file (BR-16, BR-17)", async () => {
    await writeGoodTree();
    await write("teams/support/packages/bare/PACKAGE.md", "Just a body.\n");
    await write(
      "teams/support/packages/keyed/PACKAGE.md",
      "---\ndescription: Keyed\ntools: [x]\n---\nBody.\n"
    );

    const { packages, errors } = await readPackagesDirectory(root);
    expect(errors.map((e) => e.path).sort()).toEqual([
      "teams/support/packages/bare/PACKAGE.md",
      "teams/support/packages/keyed/PACKAGE.md"
    ]);
    const keyed = errors.find((e) => e.path.includes("keyed"))!;
    expect(keyed.error.message).toContain("teams/support/packages/keyed");
    expect(keyed.error.message).toContain("`tools:`");
    expect(packages.map((p) => p.name)).not.toContain("bare");
    expect(packages.map((p) => p.name)).not.toContain("keyed");
  });

  it.each(["resources", "references", "skills", "packages"])(
    "refuses a %s/ folder inside a package, by name (BR-20)",
    async (slot) => {
      await writeGoodTree();
      await write(`teams/support/workers/clerk/packages/refunds/${slot}/x.md`, packageMd("x"));

      const { packages, errors } = await readPackagesDirectory(root);
      expect(errors.map((e) => e.path)).toEqual([`teams/support/workers/clerk/packages/refunds/${slot}`]);
      expect(errors[0]!.error.message).toContain(`${slot}/`);
      // The package is refused whole, not loaded short.
      expect(packages.map((p) => p.name)).toEqual(["house-style", "escalation"]);
    }
  );

  it("refuses a package name that breaks the segment rules (BR-25)", async () => {
    await writeGoodTree();
    await write("teams/support/packages/Bad_Name/PACKAGE.md", packageMd("Bad"));

    const { errors } = await readPackagesDirectory(root);
    expect(errors.map((e) => e.path)).toEqual(["teams/support/packages/Bad_Name"]);
    expect(errors[0]!.error.message).toContain("Package folder name");
  });

  it("refuses a file where a package folder belongs", async () => {
    await writeGoodTree();
    await write("org/packages/refunds.md", packageMd("Refunds"));

    const { errors } = await readPackagesDirectory(root);
    expect(errors.map((e) => e.path)).toEqual(["org/packages/refunds.md"]);
  });

  it("reports every refusal in one run, across levels", async () => {
    await writeGoodTree();
    await write("org/packages/no-file/notes.txt", "x");
    await write("teams/support/packages/extra/PACKAGE.md", "---\ndescription: X\nname: extra\n---\n");
    await write("teams/support/workers/clerk/packages/docs/PACKAGE.md", packageMd("Docs"));
    await write("teams/support/workers/clerk/packages/docs/references/a.md", packageMd("a"));

    const { errors } = await readPackagesDirectory(root);
    expect(errors.map((e) => e.path).sort()).toEqual([
      "org/packages/no-file",
      "teams/support/packages/extra/PACKAGE.md",
      "teams/support/workers/clerk/packages/docs/references"
    ]);
  });
});

describe("readPackagesDirectory never follows a symlink (BR-24)", () => {
  let outside: string;
  beforeEach(async () => {
    outside = await fs.mkdtemp(path.join(os.tmpdir(), "read-packages-outside-"));
    await fs.mkdir(path.join(outside, "pkg/blocks"), { recursive: true });
    await fs.writeFile(path.join(outside, "pkg/PACKAGE.md"), packageMd("Outside", "OUTSIDE-CANARY\n"));
  });
  afterEach(async () => {
    await fs.rm(outside, { recursive: true, force: true });
  });

  it.each([
    ["a packages/ slot", "teams/support/packages", "."],
    ["a package folder", "teams/support/packages/linked", "pkg"],
    ["a PACKAGE.md", "teams/support/packages/leaf/PACKAGE.md", "pkg/PACKAGE.md"],
    ["a blocks/ folder", "teams/support/workers/clerk/packages/refunds/blocks", "pkg/blocks"]
  ])("refuses %s that is a symlink, and reads nothing through it", async (_what, at, target) => {
    await writeGoodTree();
    const link = path.join(root, ...at.split("/"));
    await fs.rm(link, { recursive: true, force: true });
    await fs.mkdir(path.dirname(link), { recursive: true });
    await fs.symlink(path.join(outside, target), link);

    const result = await readPackagesDirectory(root);
    expect(JSON.stringify(result, (_k, v) => (v instanceof Error ? v.message : v))).not.toContain(
      "OUTSIDE-CANARY"
    );
    expect(result.errors.map((e) => e.path)).toContain(at);
    expect(result.errors.find((e) => e.path === at)!.error.message).toMatch(/refused for safety/);
  });
});

describe("readWorkforce hands each worker the packages in its reach", () => {
  it("joins the org's, its team's and its own packages onto a worker, and no one else's", async () => {
    await writeGoodTree();
    await write("teams/support/workers/greeter/WORKER.md", workerMd());
    await write("teams/sales/workers/closer/WORKER.md", workerMd());
    await write("teams/sales/packages/pricing/PACKAGE.md", packageMd("Pricing"));

    const { workers, packageErrors } = await readWorkforce(root);
    expect(packageErrors).toEqual([]);
    const reach = (id: string) => workers.find((w) => w.id === id)!.packages?.map((p) => p.path);

    expect(reach("support.clerk")).toEqual([
      "org/packages/house-style",
      "teams/support/packages/escalation",
      "teams/support/workers/clerk/packages/refunds"
    ]);
    // A sibling on the same team reaches the libraries, never the clerk's own.
    expect(reach("support.greeter")).toEqual([
      "org/packages/house-style",
      "teams/support/packages/escalation"
    ]);
    // Another team's library is not in reach.
    expect(reach("sales.closer")).toEqual(["org/packages/house-style", "teams/sales/packages/pricing"]);
  });

  it("leaves `packages` absent on a worker with none in reach", async () => {
    await write("teams/support/workers/clerk/WORKER.md", workerMd());
    const { workers } = await readWorkforce(root);
    expect(Object.hasOwn(workers[0]!, "packages")).toBe(false);
  });

  it("surfaces package refusals through readDeclaredRoster under their own layer", async () => {
    await writeGoodTree();
    await write("teams/support/packages/bare/PACKAGE.md", "No frontmatter.\n");
    const { problems } = await readDeclaredRoster(root);
    expect(problems.map((p) => [p.layer, p.path])).toEqual([
      ["package", "teams/support/packages/bare/PACKAGE.md"]
    ]);
  });
});
