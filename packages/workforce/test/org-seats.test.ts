/**
 * Org seats — a seat declared at `org/workers/<name>/WORKER.md`.
 *
 * Before this, the roster reader walked `teams/<t>/workers/` only and an org
 * `workers/` folder was passed over in silence, so a seat declared there never
 * existed and its documents' addresses named nothing. What is pinned here:
 *
 * - the reader lists it, with its bare folder name as its id, beside the team
 *   seats, and a team seat of the same folder name is a different seat;
 * - a broken org slot is reported the way a broken team slot is, and costs the
 *   tree nothing else;
 * - it reads the org level and then its own folder — skills, packages,
 *   references — and nothing of any team's;
 * - every reader that needs a seat's team reads the id through one parser.
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
import { hireWorkforce } from "../src/hire";
import { readWorkforce, readWorkforceDirectory } from "../src/loader";
import { SEAT_PACKAGES_KEY, type PackageManifest } from "../src/manifest";
import { resolveHeldPackages } from "../src/seat-packages";
import {
  parseDeclaredSeatId,
  placeOfReference,
  placeOfSeat,
  referenceReachableBySeat,
} from "../src/index";

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "org-seats-"));
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
  it("lists an org seat by its bare folder name, beside a team seat of the same name", async () => {
    await write("org/workers/chief-of-staff/WORKER.md", workerMd("the chief of staff"));
    await write("teams/eng/workers/chief-of-staff/WORKER.md", workerMd("eng's own"));

    const { workers, errors } = await readWorkforceDirectory(root);

    expect(errors).toEqual([]);
    // Org seats first, then each team's — and two seats, not one: the dotless
    // id cannot equal a team-qualified one.
    expect(workers.map((w) => w.id)).toEqual(["chief-of-staff", "eng.chief-of-staff"]);
    expect(workers[0]!.declared["description"]).toBe("the chief of staff");
    expect(workers[1]!.declared["description"]).toBe("eng's own");
  });

  it("reports a broken org slot under its path, and keeps every other seat", async () => {
    await write("org/workers/chief-of-staff/WORKER.md", workerMd("the chief of staff"));
    await write("teams/eng/workers/lead/WORKER.md", workerMd("the lead"));
    // No WORKER.md: the slot is a seat that should exist and does not.
    await write("org/workers/build/resources/runbook.md", "---\ndescription: x\n---\nbody");
    // A name the segment rules refuse.
    await write("org/workers/Bad_Name/WORKER.md", workerMd("bad"));
    // A file under workers/ occupies no slot, so it says nothing.
    await write("org/workers/README.md", "Org seats live here.\n");
    // A symlinked worker folder is refused, never followed.
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "org-seats-outside-"));
    try {
      await fs.writeFile(path.join(outside, "WORKER.md"), workerMd("from outside"));
      await fs.symlink(outside, path.join(root, "org", "workers", "linked"), "dir");

      const { workers, errors } = await readWorkforceDirectory(root);

      expect(workers.map((w) => w.id)).toEqual(["chief-of-staff", "eng.lead"]);
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

  it("refuses a WORKER.md key the framework imposes, by name, as for a team seat (BR-4)", async () => {
    await write("org/workers/chief-of-staff/WORKER.md", workerMd("cos", "persona: boss\n"));
    await write("teams/eng/workers/lead/WORKER.md", workerMd("the lead", "persona: boss\n"));

    const { workers, errors } = await readWorkforceDirectory(root);

    expect(workers).toEqual([]);
    expect(errors.map((e) => `${e.kind} @ ${e.path}`)).toEqual([
      "refused-declaration @ org/workers/chief-of-staff",
      "refused-declaration @ teams/eng/workers/lead",
    ]);
    // The same sentence either way, naming the folder.
    expect(errors[0]!.error.message.replace("chief-of-staff", "X")).toBe(
      errors[1]!.error.message.replace("lead", "X"),
    );
  });

  it("reports a symlinked org/ or org/workers/ rather than passing over its seats", async () => {
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "org-seats-outside-"));
    try {
      await fs.mkdir(path.join(outside, "cos"), { recursive: true });
      await fs.writeFile(path.join(outside, "cos", "WORKER.md"), workerMd("from outside"));
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
    // An org level holding everything but seats.
    await write("org/skills/house/SKILL.md", skillMd("house style"));
    await write("org/resources/handbook.md", "---\ndescription: h\n---\nbody");
    await write("teams/eng/workers/lead/WORKER.md", workerMd("the lead"));

    const { workers, errors } = await readWorkforceDirectory(root);

    expect(errors).toEqual([]);
    expect(workers.map((w) => w.id)).toEqual(["eng.lead"]);
  });
});

describe("an org seat reads the org level, then its own folder (BR-5)", () => {
  beforeEach(async () => {
    await write("org/workers/chief-of-staff/WORKER.md", workerMd("cos", "packages: [house]\n"));
    await write("teams/eng/TEAM.md", "---\ndescription: Engineering\n---\n\nShip carefully.\n");
    await write("teams/eng/workers/lead/WORKER.md", workerMd("the lead"));

    await write("org/skills/house-style/SKILL.md", skillMd("everyone's"));
    await write("teams/eng/skills/review/SKILL.md", skillMd("eng's"));
    await write("org/workers/chief-of-staff/skills/hiring/SKILL.md", skillMd("cos's own"));

    await write("org/packages/house/PACKAGE.md", packageMd("the org library"));
    await write("teams/eng/packages/deploy/PACKAGE.md", packageMd("eng's library"));
    await write("org/workers/chief-of-staff/packages/roster/PACKAGE.md", packageMd("cos's own"));
  });

  it("gets org and own skills, org and own packages, and nothing of a team's", async () => {
    const { workers, errors, skillErrors, packageErrors } = await readWorkforce(root);
    expect(errors).toEqual([]);
    expect(skillErrors).toEqual([]);
    expect(packageErrors).toEqual([]);

    const cos = workers.find((w) => w.id === "chief-of-staff")!;
    expect((cos.skills ?? []).map((s) => s.name).sort()).toEqual(["hiring", "house-style"]);
    expect((cos.packages ?? []).map((p) => p.path)).toEqual([
      "org/packages/house",
      "org/workers/chief-of-staff/packages/roster",
    ]);
    // No team, so no team instructions — the key is absent, not empty.
    expect(Object.hasOwn(cos, "teamInstructions")).toBe(false);

    // Control: the team seat in the same tree still gets its team's levels and
    // none of the org seat's own folder.
    const lead = workers.find((w) => w.id === "eng.lead")!;
    expect((lead.skills ?? []).map((s) => s.name).sort()).toEqual(["house-style", "review"]);
    expect((lead.packages ?? []).map((p) => p.path)).toEqual([
      "org/packages/house",
      "teams/eng/packages/deploy",
    ]);
    expect(lead.teamInstructions).toBe("Ship carefully.\n");
  });

  it("boots beside the team seats, holding its own package and the library it named", async () => {
    const { workers } = await readWorkforce(root);
    const tool = handler({
      name: "add-seat",
      inputSchema: z.object({}),
      outputSchema: z.object({ ok: z.boolean() }),
      execute: () => ({ ok: true }),
    });

    const seats = hireWorkforce(workers, {
      packageBlocks: { "org/workers/chief-of-staff/packages/roster": { "add-seat": tool } },
    });

    expect(seats.map((s) => s.id)).toEqual(["chief-of-staff", "eng.lead"]);
    const held = (seats[0]!.config as Record<string, Array<{ path: string }>>)[SEAT_PACKAGES_KEY];
    expect((held ?? []).map((entry) => entry.path)).toEqual([
      "org/workers/chief-of-staff/packages/roster",
      "org/packages/house",
    ]);
  });

  it("refuses to start an org seat whose own package was refused but whose blocks were generated", async () => {
    await fs.rm(path.join(root, "org/workers/chief-of-staff/packages/roster/PACKAGE.md"));
    const { workers, packageErrors } = await readWorkforce(root);
    expect(packageErrors.map((e) => e.path)).toEqual(["org/workers/chief-of-staff/packages/roster"]);

    const tool = handler({
      name: "add-seat",
      inputSchema: z.object({}),
      outputSchema: z.object({ ok: z.boolean() }),
      execute: () => ({ ok: true }),
    });
    expect(() =>
      hireWorkforce(workers, {
        packageBlocks: { "org/workers/chief-of-staff/packages/roster": { "add-seat": tool } },
      }),
    ).toThrow(/worker "chief-of-staff"[\s\S]*org\/workers\/chief-of-staff\/packages\/roster/);
  });
});

describe("parseDeclaredSeatId — the one rule for a declared seat's id (BR-5, S2)", () => {
  it("reads a dotless id as an org seat and a dotted one as a team seat", () => {
    expect(parseDeclaredSeatId("chief-of-staff")).toEqual({ name: "chief-of-staff" });
    expect(parseDeclaredSeatId("eng.chief-of-staff")).toEqual({
      team: "eng",
      name: "chief-of-staff",
    });
  });

  it("names no seat for an id with a second dot: a worker folder name is one segment, so the loader never mints one", () => {
    for (const id of ["a.b.c", "eng.lead.x", "eng.chief-of-staff.extra"]) {
      expect(parseDeclaredSeatId(id), id).toBeUndefined();
      expect(placeOfSeat(id), id).toBeUndefined();
    }
  });

  it("names no seat for an id the loader cannot mint", () => {
    for (const id of ["", ".lead", "eng.", "eng/x.lead", "lead/x"]) {
      expect(parseDeclaredSeatId(id), id).toBeUndefined();
    }
  });

  it("refuses an id whose segments break the loader's name rule, so it has no place", () => {
    for (const id of ["Bad_Name", "eng.Bad_Name", "Eng.lead", "con", "_meta"]) {
      expect(parseDeclaredSeatId(id), id).toBeUndefined();
      expect(placeOfSeat(id), id).toBeUndefined();
    }
    // Control: a legal dotless id is still an org seat.
    expect(placeOfSeat("chief-of-staff")).toEqual({ team: undefined, worker: "chief-of-staff" });
  });

  it("places an org seat at org/workers/<name>/, and a team seat where it always was", () => {
    expect(placeOfSeat("chief-of-staff")).toEqual({ team: undefined, worker: "chief-of-staff" });
    expect(placeOfSeat("eng.lead")).toEqual({ team: "eng", worker: "lead" });
    expect(placeOfSeat("")).toBeUndefined();
  });

  it("lets an org seat reach the org level and its own folder's references, and no one else's", () => {
    const cos = placeOfSeat("chief-of-staff")!;
    const lead = placeOfSeat("eng.lead")!;
    const at = (ref: string) => placeOfReference(ref)!;

    expect(referenceReachableBySeat(cos, at("handbook"))).toBe(true);
    expect(referenceReachableBySeat(cos, at("workers/chief-of-staff/runbook"))).toBe(true);
    // Another org seat's folder, any team's, any team seat's: no.
    expect(referenceReachableBySeat(cos, at("workers/build/runbook"))).toBe(false);
    expect(referenceReachableBySeat(cos, at("teams/eng/handbook"))).toBe(false);
    expect(referenceReachableBySeat(cos, at("teams/eng/workers/chief-of-staff/notes"))).toBe(false);
    // And a team seat still reaches no org seat's folder, even one of its name.
    expect(referenceReachableBySeat(lead, at("workers/lead/runbook"))).toBe(false);
  });
});

describe("resolveHeldPackages reads an org seat's id through the parser", () => {
  const pkg = (name: string, level: PackageManifest["level"], where: string, owner = {}) =>
    ({ name, level, path: where, description: name, ...owner }) as PackageManifest;
  const house = pkg("house", "org", "org/packages/house");
  const deploy = pkg("deploy", "team", "teams/eng/packages/deploy", { team: "eng" });
  const own = pkg("roster", "worker", "org/workers/cos/packages/roster", { worker: "cos" });

  it("holds its own folder's packages and the org library it names", () => {
    const { held, problems } = resolveHeldPackages("cos", ["house"], [house, own], {});
    expect(problems).toEqual([]);
    expect(held.map((h) => h.manifest.path)).toEqual([own.path, house.path]);
  });

  it("refuses a team library in its reach: an org seat has no team", () => {
    const { held, problems } = resolveHeldPackages("cos", undefined, [house, deploy], {});
    expect(held).toEqual([]);
    expect(problems.join("\n")).toContain(deploy.path);
  });

  it("refuses a team library with no owning team on its record, even when it names that package", () => {
    // A hand-built or widened record can drop the optional `team`. An org
    // seat has no team, so no team-level package is ever its own.
    const ownerless = pkg("deploy", "team", "teams/eng/packages/deploy");
    const { held, problems } = resolveHeldPackages("cos", ["deploy"], [house, ownerless], {});
    expect(held).toEqual([]);
    expect(problems.join("\n")).toContain(ownerless.path);
  });

  it("refuses a team library with no owning team on its record for a team seat too", () => {
    const ownerless = pkg("deploy", "team", "teams/eng/packages/deploy");
    const { held, problems } = resolveHeldPackages("eng.lead", ["deploy"], [house, ownerless], {});
    expect(held).toEqual([]);
    expect(problems.join("\n")).toContain("no team at all");
  });

  it("looks only in the org library for a name it cannot find", () => {
    const { problems } = resolveHeldPackages("cos", ["missing"], [house], {});
    expect(problems).toEqual([expect.stringContaining('Looked in "org/packages/missing".')]);
    expect(problems[0]).not.toContain("teams/");
  });
});
