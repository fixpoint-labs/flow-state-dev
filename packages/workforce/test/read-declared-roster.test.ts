/**
 * The declared roster — one call over the readers, one list of problems.
 *
 * What is pinned here is that this is a JOIN and not a fourth walk: every
 * record each reader returns arrives unchanged and in walk order, every
 * reader's errors arrive flattened into one list in a stated order and tagged
 * with the layer they came from, each entry carrying the reader's own `Error` OBJECT
 * rather than a copy of its text, and a tree with problems still hands back
 * everything that loaded. The one throw is the root, because that is the one
 * condition with no record to collect against.
 *
 * **No assertion here sorts what it is checking.** Order is part of this
 * composer's contract — the error channels arrive in one stated sequence, and
 * records arrive in their readers' walk order — so a sorted comparison would
 * pass against an implementation that had lost it.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readDeclaredRoster } from "../src/loader/read-declared-roster";
import { readWorkforce } from "../src/loader/read-workforce";

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "declared-roster-"));
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

async function writeWorker(
  team: string,
  worker: string,
  frontmatter = "description: A worker",
): Promise<void> {
  const dir = path.join(root, "teams", team, "workers", worker);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "WORKER.md"), `---\n${frontmatter}\n---\n\nDo the thing.\n`);
}

async function writeTeamFile(team: string, frontmatter: string): Promise<void> {
  const dir = path.join(root, "teams", team);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "TEAM.md"), `---\n${frontmatter}\n---\n\nHow we work.\n`);
}

async function writeDocument(slot: string, name: string): Promise<void> {
  const dir = path.join(root, ...slot.split("/"));
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, `${name}.md`),
    `---\ndescription: Something written down\n---\n\n# ${name}\n\nThe body.\n`,
  );
}

describe("readDeclaredRoster", () => {
  it("returns every record the readers found, and no problems", async () => {
    await writeTeamFile("qa", "description: The quality team");
    await writeWorker("qa", "tester");
    await writeDocument("org/resources", "handbook");

    const roster = await readDeclaredRoster(root);

    expect(roster.problems).toEqual([]);
    expect(roster.workers.map((w) => w.id)).toEqual(["qa.tester"]);
    expect(roster.teams.map((t) => t.id)).toEqual(["qa"]);
    expect(roster.documents.map((d) => d.ref)).toEqual(["handbook"]);
  });

  it("flattens all four error channels in one stated order (BR-2)", async () => {
    // One failure per layer, so the ordering claim is made against every
    // layer rather than the three that happened to be easiest to break.
    await writeWorker("qa", "tester"); // loads — what the skill error attaches to
    await fs.mkdir(path.join(root, "teams", "qa", "workers", "broken"), { recursive: true });
    await fs.mkdir(path.join(root, "org", "skills", "house-style"), { recursive: true });
    await fs.mkdir(path.join(root, "teams", "qa", "TEAM.md"), { recursive: true });
    await fs.mkdir(path.join(root, "org", "resources"), { recursive: true });
    await fs.writeFile(path.join(root, "org", "resources", "loose.md"), "no frontmatter here\n");

    const roster = await readDeclaredRoster(root);

    // Unsorted, deliberately. The sequence IS the contract: worker slots, then
    // each worker's skills, then team files, then documents.
    expect(roster.problems.map((p) => p.layer)).toEqual([
      "worker",
      "skill",
      "team",
      "document",
    ]);
  });

  it("keeps every record that loaded when other records did not (BR-4)", async () => {
    await writeWorker("qa", "tester");
    await writeDocument("org/resources", "handbook");
    await fs.mkdir(path.join(root, "teams", "qa", "workers", "broken"), { recursive: true });
    await fs.writeFile(path.join(root, "org", "resources", "loose.md"), "no frontmatter here\n");

    const roster = await readDeclaredRoster(root);

    expect(roster.problems.map((p) => p.layer)).toEqual(["worker", "document"]);
    // The point of BR-4: the good records survived the bad ones, in walk order.
    expect(roster.workers.map((w) => w.id)).toEqual(["qa.tester"]);
    expect(roster.documents.map((d) => d.ref)).toEqual(["handbook"]);
  });

  it("tags each problem with its layer and the path the reader named (BR-2)", async () => {
    await writeWorker("qa", "tester");
    await fs.mkdir(path.join(root, "teams", "qa", "workers", "broken"), { recursive: true });

    const roster = await readDeclaredRoster(root);
    const direct = await readWorkforce(root);

    expect(roster.problems).toHaveLength(1);
    expect(roster.problems[0].layer).toBe("worker");
    expect(roster.problems[0].path).toBe(direct.errors[0].path);
    expect(roster.problems[0].error.message).toBe(direct.errors[0].error.message);
  });

  it("hands back the reader's own Error OBJECT, not one rebuilt from its text (BR-2)", async () => {
    // Comparing `.message` cannot tell passing the reader's error through from
    // rebuilding `new Error(e.message)` — which reads identically and silently
    // drops the `cause` chain the reader attached. Identity is the only
    // assertion that can see the difference.
    const cause = new Error("the syscall underneath");
    const sentinel = new Error("a wording only the reader owns", { cause });

    vi.resetModules();
    vi.doMock("../src/loader/read-resources-directory", async (importOriginal) => ({
      ...(await importOriginal<typeof import("../src/loader/read-resources-directory")>()),
      readResourcesDirectory: async () => ({
        documents: [],
        errors: [{ path: "org/resources/x.md", error: sentinel, kind: "document-load-failed" }],
      }),
    }));
    try {
      const fresh = await import("../src/loader/read-declared-roster");
      const roster = await fresh.readDeclaredRoster(root);

      const document = roster.problems.find((p) => p.layer === "document");
      expect(document?.error).toBe(sentinel);
      expect(document?.error.cause).toBe(cause);
    } finally {
      vi.doUnmock("../src/loader/read-resources-directory");
      vi.resetModules();
    }
  });

  it("reports a shared skills level once per affected worker, not once for the level (BR-3)", async () => {
    await writeWorker("qa", "reviewer");
    await writeWorker("qa", "tester");
    // A broken skill at the ORG level — a level both workers read.
    await fs.mkdir(path.join(root, "org", "skills", "house-style"), { recursive: true });

    const roster = await readDeclaredRoster(root);
    const skills = roster.problems.filter((p) => p.layer === "skill");

    // One entry per worker that lost a skill. Flattening to one would say the
    // level failed; what actually happened is two workers running short.
    // Unsorted: the entries follow the workers' walk order, so each entry's
    // `worker` has to be the worker it was attached to rather than either name.
    expect(skills).toHaveLength(2);
    expect(skills.map((p) => p.worker)).toEqual(["qa.reviewer", "qa.tester"]);
    expect(new Set(skills.map((p) => p.path)).size).toBe(1);
  });

  it("surfaces a team that declared a TEAM.md, and omits one that did not (BR-7)", async () => {
    await writeTeamFile("qa", "description: The quality team");
    await writeWorker("ops", "oncall");
    await writeWorker("qa", "tester");

    const roster = await readDeclaredRoster(root);

    expect(roster.problems).toEqual([]);
    expect(roster.teams.map((t) => t.id)).toEqual(["qa"]);
    // Walk order, not sorted: two teams, and the reader's order is the contract.
    expect(roster.workers.map((w) => w.id)).toEqual(["ops.oncall", "qa.tester"]);
  });

  it("throws on a symlinked root, naming it — the only throw (BR-5)", async () => {
    const real = await fs.mkdtemp(path.join(os.tmpdir(), "declared-roster-real-"));
    const link = path.join(root, "linked-tree");
    await fs.symlink(real, link, "dir");

    await expect(readDeclaredRoster(link)).rejects.toThrow(link);

    await fs.rm(real, { recursive: true, force: true });
  });

  it("throws when the root is absent, rather than collecting it (BR-5)", async () => {
    await expect(readDeclaredRoster(path.join(root, "nope"))).rejects.toThrow(/nope/);
  });
});
