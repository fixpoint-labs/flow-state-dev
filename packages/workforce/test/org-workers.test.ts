/**
 * Org workers — a worker declared at `org/workers/<name>/WORKER.md`.
 *
 * Before this, the roster reader walked `teams/<t>/workers/` only and an org
 * `workers/` folder was passed over in silence, so a worker declared there never
 * existed and its documents' addresses named nothing. What is pinned here:
 *
 * - the reader lists it, with its bare folder name as its id, beside the team
 *   workers, and a team worker of the same folder name is a different worker;
 * - a broken org slot is reported the way a broken team slot is, and costs the
 *   tree nothing else;
 * - it reads the org level and then its own folder — skills, packages,
 *   references — and nothing of any team's;
 * - every reader that needs a worker's team reads the id through one parser.
 *
 * Real temp trees through the real readers: what a symlink or a missing file
 * does is filesystem behaviour.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { handler } from "@flow-state-dev/core";
import { mintWorkers } from "../src/hire";
import { readWorkforce, readWorkforceDirectory } from "../src/loader";
import { WORKER_PACKAGES_KEY, type PackageManifest } from "../src/manifest";
import { resolveHeldPackages } from "../src/worker-packages";
import {
  parseDeclaredWorkerId,
  placeOfReference,
  placeOfWorker,
  referenceReachableByWorker,
} from "../src/index";

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "org-workers-"));
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

async function write(rel: string, contents: string): Promise<void> {
  const full = path.join(root, ...rel.split("/"));
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, contents);
}

const workerMd = (description: string, extra = ""): string =>
  `---\ndescription: ${description}\n${extra}---\n\nYou are ${description}.\n`;

const skillMd = (description: string): string =>
  `---\ndescription: ${description}\n---\n\nDo it.\n`;

const packageMd = (description: string): string => `---\ndescription: ${description}\n---\n`;

describe("the roster reader walks org/workers/ (BR-1, BR-3, BR-6)", () => {
  it("lists an org worker by its bare folder name, beside a team worker of the same name", async () => {
    await write("org/workers/shift-coordinator/WORKER.md", workerMd("the Shift Coordinator"));
    await write("teams/eng/workers/shift-coordinator/WORKER.md", workerMd("eng's own"));

    const { workers, errors } = await readWorkforceDirectory(root);

    expect(errors).toEqual([]);
    // Org workers first, then each team's — and two workers, not one: the dotless
    // id cannot equal a team-qualified one.
    expect(workers.map((w) => w.id)).toEqual(["shift-coordinator", "eng.shift-coordinator"]);
    expect(workers[0]!.declared["description"]).toBe("the Shift Coordinator");
    expect(workers[1]!.declared["description"]).toBe("eng's own");
  });

  it("reports a broken org slot under its path, and keeps every other worker", async () => {
    await write("org/workers/shift-coordinator/WORKER.md", workerMd("the Shift Coordinator"));
    await write("teams/eng/workers/lead/WORKER.md", workerMd("the lead"));
    // No WORKER.md: the slot is a worker that should exist and does not.
    await write("org/workers/build/resources/runbook.md", "---\ndescription: x\n---\nbody");
    // A name the segment rules refuse.
    await write("org/workers/Bad_Name/WORKER.md", workerMd("bad"));
    // A file under workers/ occupies no slot, so it says nothing.
    await write("org/workers/README.md", "Org workers live here.\n");
    // A symlinked worker folder is refused, never followed.
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "org-workers-outside-"));
    try {
      await fs.writeFile(path.join(outside, "WORKER.md"), workerMd("from outside"));
      await fs.symlink(outside, path.join(root, "org", "workers", "linked"), "dir");

      const { workers, errors } = await readWorkforceDirectory(root);

      expect(workers.map((w) => w.id)).toEqual(["shift-coordinator", "eng.lead"]);
      expect(errors.map((e) => `${e.kind} @ ${e.path}`).sort()).toEqual([
        "worker-load-failed @ org/workers/Bad_Name",
        "worker-load-failed @ org/workers/build",
        "worker-load-failed @ org/workers/linked",
      ]);
      const byPath = new Map(errors.map((e) => [e.path, e.error.message]));
      expect(byPath.get("org/workers/build")).toMatch(/has no WORKER\.md/);
      expect(byPath.get("org/workers/linked")).toMatch(/Symlinked worker folder/);
    } finally {
      await fs.rm(outside, { recursive: true, force: true });
    }
  });

  it("refuses a WORKER.md key the framework imposes, by name, as for a team worker (BR-4)", async () => {
    await write("org/workers/shift-coordinator/WORKER.md", workerMd("shift-coordinator", "persona: boss\n"));
    await write("teams/eng/workers/lead/WORKER.md", workerMd("the lead", "persona: boss\n"));

    const { workers, errors } = await readWorkforceDirectory(root);

    expect(workers).toEqual([]);
    expect(errors.map((e) => `${e.kind} @ ${e.path}`)).toEqual([
      "refused-declaration @ org/workers/shift-coordinator",
      "refused-declaration @ teams/eng/workers/lead",
    ]);
    // The same sentence either way, naming the folder.
    expect(errors[0]!.error.message.replace("shift-coordinator", "X")).toBe(
      errors[1]!.error.message.replace("lead", "X"),
    );
  });

  it("reports a symlinked org/ or org/workers/ rather than passing over its workers", async () => {
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "org-workers-outside-"));
    try {
      await fs.mkdir(path.join(outside, "shift-coordinator"), { recursive: true });
      await fs.writeFile(path.join(outside, "shift-coordinator", "WORKER.md"), workerMd("from outside"));
      await fs.mkdir(path.join(root, "org"), { recursive: true });
      await fs.symlink(outside, path.join(root, "org", "workers"), "dir");

      const { workers, errors } = await readWorkforceDirectory(root);
      expect(workers).toEqual([]);
      expect(errors.map((e) => `${e.kind} @ ${e.path}`)).toEqual(["unreadable-slot @ org/workers"]);
    } finally {
      await fs.rm(outside, { recursive: true, force: true });
    }
  });

  it("leaves a tree with no org/workers/ exactly as it was (BR-2)", async () => {
    // An org level holding everything but workers.
    await write("org/skills/house/SKILL.md", skillMd("house style"));
    await write("org/resources/handbook.md", "---\ndescription: h\n---\nbody");
    await write("teams/eng/workers/lead/WORKER.md", workerMd("the lead"));

    const { workers, errors } = await readWorkforceDirectory(root);

    expect(errors).toEqual([]);
    expect(workers.map((w) => w.id)).toEqual(["eng.lead"]);
  });
});

describe("an org worker reads the org level, then its own folder (BR-5)", () => {
  beforeEach(async () => {
    await write("org/workers/shift-coordinator/WORKER.md", workerMd("shift-coordinator", "packages: [house]\n"));
    await write("teams/eng/TEAM.md", "---\ndescription: Engineering\n---\n\nShip carefully.\n");
    await write("teams/eng/workers/lead/WORKER.md", workerMd("the lead"));

    await write("org/skills/house-style/SKILL.md", skillMd("everyone's"));
    await write("teams/eng/skills/review/SKILL.md", skillMd("eng's"));
    await write("org/workers/shift-coordinator/skills/hiring/SKILL.md", skillMd("shiftCoordinator's own"));

    await write("org/packages/house/PACKAGE.md", packageMd("the org library"));
    await write("teams/eng/packages/deploy/PACKAGE.md", packageMd("eng's library"));
    await write("org/workers/shift-coordinator/packages/roster/PACKAGE.md", packageMd("shiftCoordinator's own"));
  });

  it("gets org and own skills, org and own packages, and nothing of a team's", async () => {
    const { workers, errors, skillErrors, packageErrors } = await readWorkforce(root);
    expect(errors).toEqual([]);
    expect(skillErrors).toEqual([]);
    expect(packageErrors).toEqual([]);

    const shiftCoordinator = workers.find((w) => w.id === "shift-coordinator")!;
    expect((shiftCoordinator.skills ?? []).map((s) => s.name).sort()).toEqual(["hiring", "house-style"]);
    expect((shiftCoordinator.packages ?? []).map((p) => p.path)).toEqual([
      "org/packages/house",
      "org/workers/shift-coordinator/packages/roster",
    ]);
    // No team, so no team instructions — the key is absent, not empty.
    expect(Object.hasOwn(shiftCoordinator, "teamInstructions")).toBe(false);

    // Control: the team worker in the same tree still gets its team's levels and
    // none of the org worker's own folder.
    const lead = workers.find((w) => w.id === "eng.lead")!;
    expect((lead.skills ?? []).map((s) => s.name).sort()).toEqual(["house-style", "review"]);
    expect((lead.packages ?? []).map((p) => p.path)).toEqual([
      "org/packages/house",
      "teams/eng/packages/deploy",
    ]);
    expect(lead.teamInstructions).toBe("Ship carefully.\n");
  });

  it("boots beside the team workers, holding its own package and the library it named", async () => {
    const { workers } = await readWorkforce(root);
    const tool = handler({
      name: "add-worker",
      inputSchema: z.object({}),
      outputSchema: z.object({ ok: z.boolean() }),
      execute: () => ({ ok: true }),
    });

    const minted = mintWorkers(workers, {
      packageBlocks: { "org/workers/shift-coordinator/packages/roster": { "add-worker": tool } },
    });

    expect(minted.map((s) => s.id)).toEqual(["shift-coordinator", "eng.lead"]);
    const held = (minted[0]!.config as Record<string, Array<{ path: string }>>)[WORKER_PACKAGES_KEY];
    expect((held ?? []).map((entry) => entry.path)).toEqual([
      "org/workers/shift-coordinator/packages/roster",
      "org/packages/house",
    ]);
  });

  it("refuses to start an org worker whose own package was refused but whose blocks were generated", async () => {
    await fs.rm(path.join(root, "org/workers/shift-coordinator/packages/roster/PACKAGE.md"));
    const { workers, packageErrors } = await readWorkforce(root);
    expect(packageErrors.map((e) => e.path)).toEqual(["org/workers/shift-coordinator/packages/roster"]);

    const tool = handler({
      name: "add-worker",
      inputSchema: z.object({}),
      outputSchema: z.object({ ok: z.boolean() }),
      execute: () => ({ ok: true }),
    });
    expect(() =>
      mintWorkers(workers, {
        packageBlocks: { "org/workers/shift-coordinator/packages/roster": { "add-worker": tool } },
      }),
    ).toThrow(/worker "shift-coordinator"[\s\S]*org\/workers\/shift-coordinator\/packages\/roster/);
  });
});

describe("parseDeclaredWorkerId — the one rule for a declared worker's id (BR-5, S2)", () => {
  it("reads a dotless id as an org worker and a dotted one as a team worker", () => {
    expect(parseDeclaredWorkerId("shift-coordinator")).toEqual({ name: "shift-coordinator" });
    expect(parseDeclaredWorkerId("eng.shift-coordinator")).toEqual({
      team: "eng",
      name: "shift-coordinator",
    });
  });

  it("names no worker for an id with a second dot: a worker folder name is one segment, so the loader never mints one", () => {
    for (const id of ["a.b.c", "eng.lead.x", "eng.shift-coordinator.extra"]) {
      expect(parseDeclaredWorkerId(id), id).toBeUndefined();
      expect(placeOfWorker(id), id).toBeUndefined();
    }
  });

  it("names no worker for an id the loader cannot mint", () => {
    for (const id of ["", ".lead", "eng.", "eng/x.lead", "lead/x"]) {
      expect(parseDeclaredWorkerId(id), id).toBeUndefined();
    }
  });

  it("refuses an id whose segments break the loader's name rule, so it has no place", () => {
    for (const id of ["Bad_Name", "eng.Bad_Name", "Eng.lead", "con", "_meta"]) {
      expect(parseDeclaredWorkerId(id), id).toBeUndefined();
      expect(placeOfWorker(id), id).toBeUndefined();
    }
    // Control: a legal dotless id is still an org worker.
    expect(placeOfWorker("shift-coordinator")).toEqual({ team: undefined, worker: "shift-coordinator" });
  });

  it("places an org worker at org/workers/<name>/, and a team worker where it always was", () => {
    expect(placeOfWorker("shift-coordinator")).toEqual({ team: undefined, worker: "shift-coordinator" });
    expect(placeOfWorker("eng.lead")).toEqual({ team: "eng", worker: "lead" });
    expect(placeOfWorker("")).toBeUndefined();
  });

  it("lets an org worker reach the org level and its own folder's references, and no one else's", () => {
    const shiftCoordinator = placeOfWorker("shift-coordinator")!;
    const lead = placeOfWorker("eng.lead")!;
    const at = (ref: string) => placeOfReference(ref)!;

    expect(referenceReachableByWorker(shiftCoordinator, at("handbook"))).toBe(true);
    expect(referenceReachableByWorker(shiftCoordinator, at("workers/shift-coordinator/runbook"))).toBe(true);
    // Another org worker's folder, any team's, any team worker's: no.
    expect(referenceReachableByWorker(shiftCoordinator, at("workers/build/runbook"))).toBe(false);
    expect(referenceReachableByWorker(shiftCoordinator, at("teams/eng/handbook"))).toBe(false);
    expect(referenceReachableByWorker(shiftCoordinator, at("teams/eng/workers/shift-coordinator/notes"))).toBe(false);
    // And a team worker still reaches no org worker's folder, even one of its name.
    expect(referenceReachableByWorker(lead, at("workers/lead/runbook"))).toBe(false);
  });
});

describe("resolveHeldPackages reads an org worker's id through the parser", () => {
  const pkg = (name: string, level: PackageManifest["level"], where: string, owner = {}) =>
    ({ name, level, path: where, description: name, ...owner }) as PackageManifest;
  const house = pkg("house", "org", "org/packages/house");
  const deploy = pkg("deploy", "team", "teams/eng/packages/deploy", { team: "eng" });
  const own = pkg("roster", "worker", "org/workers/shift-coordinator/packages/roster", { worker: "shift-coordinator" });

  it("holds its own folder's packages and the org library it names", () => {
    const { held, problems } = resolveHeldPackages("shift-coordinator", ["house"], [house, own], {});
    expect(problems).toEqual([]);
    expect(held.map((h) => h.manifest.path)).toEqual([own.path, house.path]);
  });

  it("refuses a team library in its reach: an org worker has no team", () => {
    const { held, problems } = resolveHeldPackages("shift-coordinator", undefined, [house, deploy], {});
    expect(held).toEqual([]);
    expect(problems.join("\n")).toContain(deploy.path);
  });

  it("refuses a team library with no owning team on its record, even when it names that package", () => {
    // A hand-built or widened record can drop the optional `team`. An org
    // worker has no team, so no team-level package is ever its own.
    const ownerless = pkg("deploy", "team", "teams/eng/packages/deploy");
    const { held, problems } = resolveHeldPackages("shift-coordinator", ["deploy"], [house, ownerless], {});
    expect(held).toEqual([]);
    expect(problems.join("\n")).toContain(ownerless.path);
  });

  it("refuses a team library with no owning team on its record for a team worker too", () => {
    const ownerless = pkg("deploy", "team", "teams/eng/packages/deploy");
    const { held, problems } = resolveHeldPackages("eng.lead", ["deploy"], [house, ownerless], {});
    expect(held).toEqual([]);
    expect(problems.join("\n")).toContain("no team at all");
  });

  it("refuses a worker id that matches neither declared shape, rather than reading its last two segments", () => {
    // `a.b.c` is no worker the loader can mint; cut to `b.c` it would read as
    // worker `c` on team `b` and hold team b's library.
    const bLibrary = pkg("deploy", "team", "teams/b/packages/deploy", { team: "b" });
    const { held, problems } = resolveHeldPackages("a.b.c", ["deploy"], [bLibrary], {});
    expect(held).toEqual([]);
    expect(problems).toEqual([expect.stringContaining('"a.b.c"')]);
  });

  it("looks only in the org library for a name it cannot find", () => {
    const { problems } = resolveHeldPackages("shift-coordinator", ["missing"], [house], {});
    expect(problems).toEqual([expect.stringContaining('Looked in "org/packages/missing".')]);
    expect(problems[0]).not.toContain("teams/");
  });
});
