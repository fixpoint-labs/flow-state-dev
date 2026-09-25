/**
 * The joined loader — records that arrive carrying their own skills.
 *
 * The gap it closes is the whole point: both halves already existed and neither
 * called the other, so a roster read off disk hired workers holding nothing.
 * What is pinned here is that the join is per SEAT — two seats reading two
 * different sets, never one shared bucket — and that neither half's collected
 * errors are lost on the way through.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { handler } from "@flow-state-dev/core";
import { hireWorkforce } from "../src/hire";
import { readWorkforce } from "../src/loader/read-workforce";

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "read-workforce-"));
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

async function writeWorker(
  team: string,
  worker: string,
  frontmatter = "description: A worker",
  body = "You do the thing.",
): Promise<void> {
  const dir = path.join(root, "teams", team, "workers", worker);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "WORKER.md"), `---\n${frontmatter}\n---\n\n${body}\n`);
}

async function writeSkill(levelPath: string, name: string, description: string): Promise<void> {
  const dir = path.join(root, ...levelPath.split("/"), name);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, "SKILL.md"),
    `---\ndescription: ${description}\n---\n\nDo the ${name} thing.\n`,
  );
}

const skillNames = (skills: { name: string }[] | undefined) =>
  (skills ?? []).map((s) => s.name).sort();

const seat = (workers: Array<{ id: string }>, id: string) => workers.find((w) => w.id === id)!;

describe("readWorkforce", () => {
  it("gives each seat the union of the levels it can see", async () => {
    await writeSkill("org/skills", "house-style", "everyone's");
    await writeWorker("qa", "tester");
    await writeSkill("teams/qa/skills", "regression", "qa's");
    await writeSkill("teams/qa/workers/tester/skills", "write-regression", "the tester's own");

    const { workers, errors, skillErrors } = await readWorkforce(root);

    expect(errors).toEqual([]);
    expect(skillErrors).toEqual([]);
    expect(skillNames(seat(workers, "qa.tester").skills)).toEqual([
      "house-style",
      "regression",
      "write-regression",
    ]);
  });

  // The failure this whole change exists to fix: two seats reading one bucket.
  // Asserted on CONTENTS, not on the presence of a field — two seats each
  // holding every skill would pass a field check and be exactly the bug.
  it("gives two seats on two teams disjoint sets", async () => {
    await writeWorker("qa", "tester");
    await writeWorker("sec", "auditor");
    await writeSkill("teams/qa/workers/tester/skills", "write-regression", "qa's own");
    await writeSkill("teams/sec/workers/auditor/skills", "threat-model", "sec's own");

    const { workers } = await readWorkforce(root);

    expect(skillNames(seat(workers, "qa.tester").skills)).toEqual(["write-regression"]);
    expect(skillNames(seat(workers, "sec.auditor").skills)).toEqual(["threat-model"]);
  });

  // The folder already says whose it is — nothing lists it anywhere.
  it("includes a colocated skill with no `skills:` list on the worker", async () => {
    await writeWorker("qa", "tester", "description: A worker");
    await writeSkill("teams/qa/workers/tester/skills", "write-regression", "the tester's own");

    const { workers } = await readWorkforce(root);

    expect(Object.hasOwn(seat(workers, "qa.tester").declared, "skills")).toBe(false);
    expect(skillNames(seat(workers, "qa.tester").skills)).toEqual(["write-regression"]);
  });

  // An empty set, not an absent field: a loaded seat has been read for, and the
  // hire step tells the two apart.
  it("gives a seat with no skills anywhere an empty set", async () => {
    await writeWorker("qa", "tester");

    const { workers } = await readWorkforce(root);

    expect(seat(workers, "qa.tester").skills).toEqual([]);
  });

  it("carries the body and frontmatter through unchanged", async () => {
    await writeWorker("qa", "tester", "description: A worker\ntools: [board]", "You test.");

    const { workers } = await readWorkforce(root);

    expect(seat(workers, "qa.tester").body.trim()).toBe("You test.");
    expect(seat(workers, "qa.tester").declared).toMatchObject({ tools: ["board"] });
  });

  it("collects a worker-slot failure rather than throwing", async () => {
    await writeWorker("qa", "tester");
    await fs.mkdir(path.join(root, "teams", "qa", "workers", "empty"), { recursive: true });

    const { workers, errors } = await readWorkforce(root);

    expect(workers.map((w) => w.id)).toEqual(["qa.tester"]);
    expect(errors.map((e) => e.path)).toEqual(["teams/qa/workers/empty"]);
  });

  // Attributable: a skill failure names the seat it cost, which is what a
  // flattened list could not say.
  it("collects a skill failure under the seat it cost", async () => {
    await writeWorker("qa", "tester");
    const dir = path.join(root, "teams", "qa", "workers", "tester", "skills", "broken");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "SKILL.md"), "no frontmatter at all");

    const { workers, errors, skillErrors } = await readWorkforce(root);

    expect(errors).toEqual([]);
    expect(workers.map((w) => w.id)).toEqual(["qa.tester"]);
    expect(skillErrors).toHaveLength(1);
    expect(skillErrors[0]!.worker).toBe("qa.tester");
    expect(skillErrors[0]!.errors[0]!.kind).toBe("skill-load-failed");
  });

  it("still throws when the root itself cannot be read", async () => {
    await expect(readWorkforce(path.join(root, "nope"))).rejects.toThrow(
      /Failed to read workforce directory/,
    );
  });
});

describe("readWorkforce then hireWorkforce: a refused package in a worker's own folder", () => {
  // The loader drops a package whose PACKAGE.md it refuses from the record, but
  // `fsdev gen` finds its blocks without opening that file. The worker must not
  // start without a package its own folder holds.
  it("stops start, naming the worker and the package's folder", async () => {
    await writeWorker("support", "clerk");
    const pkgDir = path.join(root, "teams", "support", "workers", "clerk", "packages", "refunds");
    await fs.mkdir(path.join(pkgDir, "blocks"), { recursive: true });
    // No PACKAGE.md: refused by the loader.

    const { workers, packageErrors } = await readWorkforce(root);
    expect(packageErrors.map((e) => e.path)).toContain("teams/support/workers/clerk/packages/refunds");
    expect(seat(workers, "support.clerk").packages ?? []).toEqual([]);

    const issueRefund = handler({
      name: "issue-refund",
      inputSchema: z.object({}),
      outputSchema: z.object({ ok: z.boolean() }),
      execute: () => ({ ok: true }),
    });
    expect(() =>
      hireWorkforce(workers, {
        packageBlocks: { "teams/support/workers/clerk/packages/refunds": { "issue-refund": issueRefund } },
      }),
    ).toThrow(/worker "support\.clerk"[\s\S]*teams\/support\/workers\/clerk\/packages\/refunds/);
  });
});
