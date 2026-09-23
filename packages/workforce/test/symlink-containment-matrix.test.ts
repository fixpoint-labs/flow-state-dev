/**
 * The containment guarantee, held across every door at once.
 *
 * Each reader already has its own symlink tests, and each of those checks the
 * level that reader happens to care about. That per-door shape is exactly how
 * this class of hole survived before: `read-resources-directory` grew a root
 * check while `read-workforce-directory` and `read-seat-skills` did not, and
 * nothing in the suite compared them. So this file is deliberately a matrix —
 * one symlinked tree per position, every door run over it — and its job is to
 * fail the moment one door stops agreeing with the others.
 *
 * The assertion is the same everywhere and it is about content, not wording: a
 * complete second workforce tree sits outside the configured root carrying a
 * canary string, and no door may return, throw or report anything holding it. A
 * door that followed a link would load a worker, channel, document, module or
 * skill from the outside tree, and the canary is what makes that visible without
 * pinning any message text.
 *
 * The canary is in the outside tree's **filenames as well as its file contents**,
 * and that is not belt-and-braces. The two codegen doors never open a file —
 * they return basenames and paths read off the tree's shape — so a canary that
 * lived only in contents was invisible to them, and every codegen row here
 * passed whether or not containment held. It did: with the symlink check removed
 * entirely, those rows stayed green. `every door can observe the canary at all`
 * is the control that now stands in front of that, and it is the first test in
 * the file for that reason — an absence assertion is worth what the thing's
 * presence is detectable.
 *
 * Real symlinks on a real filesystem, on purpose: what `lstat` does with a link,
 * with a trailing separator, or with a link partway down a path is filesystem
 * behaviour, and a mock would only assert our idea of it.
 */
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  readChannelsDirectory,
  readResourcesDirectory,
  readSeatSkills,
  readWorkforceDirectory,
} from "../src/loader";
import { discoverWorkforceCode } from "../src/codegen";
// Not on the `./codegen` subpath — the command reaches it through
// `discoverWorkforceCode`. Imported directly because it opens the root itself,
// which makes it a door in its own right.
import { discoverResourceModules } from "../src/codegen/discover-resource-modules";

/**
 * Marks every file in the outside tree. Finding it anywhere in a door's output
 * means that door read through a link.
 *
 * Lowercase and hyphenated because it has to be legal as a *basename*, not just
 * as file contents. The two codegen doors never read a file — they return names
 * and paths derived from the tree's shape — so a canary that lived only in file
 * contents would be absent from their output whether or not they had walked the
 * outside tree, and every codegen row here would assert nothing. It goes in the
 * filenames too, and `every door can observe the canary at all` is the control
 * that keeps that true.
 */
const CANARY = "canary-outside-the-root";

const TEAM = "engineering";
const WORKER = "lead";

let base: string;

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "workforce-containment-"));
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

/**
 * A complete workforce tree — one of everything every door reads — with `tag`
 * written into every file, so the tree a result came from is identifiable.
 */
function buildTree(dir: string, tag: string): void {
  const doc = (what: string) => `---\ndescription: ${what} ${tag}\n---\n\nbody ${tag}\n`;
  const skill = (name: string) =>
    `---\nname: ${name}\ndescription: ${name} ${tag}\n---\n\nbody ${tag}\n`;
  const module_ = `// ${tag}\nexport default {};\n`;

  const worker = `teams/${TEAM}/workers/${WORKER}`;

  mkdirSync(join(dir, worker), { recursive: true });
  writeFileSync(join(dir, worker, "WORKER.md"), doc("worker"));

  mkdirSync(join(dir, `teams/${TEAM}/channels/standup`), { recursive: true });
  writeFileSync(join(dir, `teams/${TEAM}/channels/standup/CHANNEL.md`), doc("channel"));

  mkdirSync(join(dir, `teams/${TEAM}/resources`), { recursive: true });
  writeFileSync(join(dir, `teams/${TEAM}/resources/brief.md`), doc("document"));
  writeFileSync(join(dir, `teams/${TEAM}/resources/store.ts`), module_);
  writeFileSync(join(dir, `teams/${TEAM}/resources/${tag}-team-store.ts`), module_);

  mkdirSync(join(dir, worker, "resources"), { recursive: true });
  writeFileSync(join(dir, worker, "resources/notes.md"), doc("document"));
  writeFileSync(join(dir, worker, `resources/${tag}-worker-store.ts`), module_);

  mkdirSync(join(dir, `teams/${TEAM}/skills/team-skill`), { recursive: true });
  writeFileSync(join(dir, `teams/${TEAM}/skills/team-skill/SKILL.md`), skill("team-skill"));

  mkdirSync(join(dir, worker, "skills/own-skill"), { recursive: true });
  writeFileSync(join(dir, worker, "skills/own-skill/SKILL.md"), skill("own-skill"));

  mkdirSync(join(dir, "org/skills/org-skill"), { recursive: true });
  writeFileSync(join(dir, "org/skills/org-skill/SKILL.md"), skill("org-skill"));

  mkdirSync(join(dir, "org/resources"), { recursive: true });
  writeFileSync(join(dir, "org/resources/policy.md"), doc("document"));
  writeFileSync(join(dir, `org/resources/${tag}-org-store.ts`), module_);

  // Two modules per code folder, and the pairing is deliberate. The fixed name
  // is what the leaf-file case relinks, which needs the same relative path to
  // exist in both trees. The `tag`-prefixed one is what makes a codegen result
  // tell the trees apart at all: those doors return a basename and a path and
  // never open the file, and both trees' fixed names are identical, so without
  // this every codegen assertion in this file would pass on an empty claim.
  mkdirSync(join(dir, "blocks"), { recursive: true });
  writeFileSync(join(dir, "blocks/tally.ts"), module_);
  writeFileSync(join(dir, `blocks/${tag}-block.ts`), module_);
  mkdirSync(join(dir, "flows/workers"), { recursive: true });
  writeFileSync(join(dir, "flows/workers/agent.ts"), module_);
  writeFileSync(join(dir, `flows/workers/${tag}-worker-flow.ts`), module_);
  mkdirSync(join(dir, "flows/channels"), { recursive: true });
  writeFileSync(join(dir, "flows/channels/room.ts"), module_);
  writeFileSync(join(dir, `flows/channels/${tag}-channel-flow.ts`), module_);
}

/** The configured tree and the tree outside it, side by side under `base`. */
function scaffold(): { root: string; outside: string } {
  const root = join(base, "configured");
  const outside = join(base, "outside");
  buildTree(root, "configured");
  buildTree(outside, CANARY);
  return { root, outside };
}

/** Replace a path inside the configured tree with a link to its outside twin. */
function relink(root: string, outside: string, relative: string): void {
  rmSync(join(root, relative), { recursive: true, force: true });
  symlinkSync(join(outside, relative), join(root, relative));
}

/** Every reader that opens a workforce root, named for the failure message. */
const DOORS: ReadonlyArray<{ name: string; open: (root: string) => Promise<unknown> }> = [
  { name: "readWorkforceDirectory", open: (root) => readWorkforceDirectory(root) },
  { name: "readChannelsDirectory", open: (root) => readChannelsDirectory(root) },
  { name: "readResourcesDirectory", open: (root) => readResourcesDirectory(root) },
  { name: "readSeatSkills", open: (root) => readSeatSkills(root, { team: TEAM, worker: WORKER }) },
  { name: "discoverWorkforceCode", open: (root) => discoverWorkforceCode(root) },
  { name: "discoverResourceModules", open: (root) => discoverResourceModules(root) },
];

/**
 * Everything one door produced, flattened to a string — the returned record,
 * every collected `Error` message, and a thrown error with its `problems`.
 *
 * Flattened rather than inspected field by field because the six doors return
 * five different shapes, and what is being asserted is the one thing they share:
 * nothing from outside the root came back, whichever field it would have
 * arrived in.
 */
async function everythingProduced(
  door: (root: string) => Promise<unknown>,
  root: string,
): Promise<string> {
  try {
    return JSON.stringify(await door(root), (_key, value) =>
      value instanceof Error ? value.message : value,
    );
  } catch (err) {
    const problems = (err as { problems?: string[] }).problems ?? [];
    return `${(err as Error).message}\n${problems.join("\n")}`;
  }
}

/**
 * Run every door over `root` and require that none of them read the outside
 * tree. `what` names the position under test so a failure says which one moved.
 */
async function expectNoDoorReadsOutside(root: string, what: string): Promise<void> {
  for (const { name, open } of DOORS) {
    const produced = await everythingProduced(open, root);
    expect(
      produced.includes(CANARY),
      `${name} followed the symlinked ${what} and read the tree outside the configured root`,
    ).toBe(false);
  }
}

describe("no door follows a symlink out of the configured root", () => {
  it("every door can observe the canary at all", async () => {
    // The control every other test in this file rests on. Each assertion below
    // is `the canary is absent`, which is worth exactly as much as the canary's
    // visibility — and for the two codegen doors it was worth nothing until the
    // outside tree's modules were given canary-bearing *filenames*, because
    // those doors return names and paths and never read a file. So: point each
    // door straight at the outside tree, with no symlink involved anywhere, and
    // require that it comes back carrying the canary.
    //
    // Without this, removing containment entirely would leave the codegen rows
    // green. It is the difference between "no door read the outside tree" and
    // "no door could have told us either way".
    const { outside } = scaffold();

    for (const { name, open } of DOORS) {
      const produced = await everythingProduced(open, outside);
      expect(
        produced.includes(CANARY),
        `${name} cannot see the canary even when pointed directly at the outside ` +
          `tree, so every assertion about it not seeing the canary proves nothing`,
      ).toBe(true);
    }
  });

  it("refuses a symlinked root", async () => {
    const { outside } = scaffold();
    const linked = join(base, "linked-root");
    symlinkSync(outside, linked);

    // Throwing, specifically: a root that is not the configured tree is a
    // wiring mistake, and returning an empty result would read as a tree that
    // simply declares nothing.
    for (const { name, open } of DOORS) {
      await expect(open(linked), `${name} did not refuse a symlinked root`).rejects.toThrow(
        /refused for safety/,
      );
    }
    await expectNoDoorReadsOutside(linked, "root");
  });

  it("refuses a symlinked root spelled with a trailing separator", async () => {
    const { outside } = scaffold();
    const linked = join(base, "linked-root");
    symlinkSync(outside, linked);

    // `lstat` resolves the FINAL link when a path ends in a separator, so this
    // spelling is the one that hides a link from a naive check — and it is the
    // ordinary way a directory falls out of config or an environment variable.
    const spelled = `${linked}${sep}`;
    for (const { name, open } of DOORS) {
      await expect(
        open(spelled),
        `${name} was fooled by the trailing separator`,
      ).rejects.toThrow(/refused for safety/);
    }
    await expectNoDoorReadsOutside(spelled, "root (trailing separator)");
  });

  it("refuses a root whose spelling collapses onto a different directory", async () => {
    const { outside } = scaffold();
    // `<base>/hop/../elsewhere`, where `hop` is a link to `<base>/holder/inner`.
    // The kernel walks the link and then `..`, landing on `<base>/holder`; every
    // caller instead builds its paths with `path.join`, which collapses `..`
    // lexically and lands on `<base>`. So the directory the root check looks at
    // and the directory the walk reads are two different places, and a link at
    // the second one is never classified.
    mkdirSync(join(base, "holder/inner"), { recursive: true });
    buildTree(join(base, "holder/elsewhere"), "configured");
    symlinkSync(join(base, "holder/inner"), join(base, "hop"));
    symlinkSync(outside, join(base, "elsewhere"));

    // Spelled by hand: `path.join` would collapse the `..` before any door saw
    // it, which is the whole difference being tested.
    const spelled = `${base}${sep}hop${sep}..${sep}elsewhere`;

    // The refusal is asserted here, and by its own wording, where every other
    // case in this file asserts content alone. Both halves are needed because
    // neither covers the other: the canary sweep below is what catches the
    // guard being gone, but it would stay green if the doors happened to fail
    // for some unrelated reason before reaching the outside tree — and the
    // directory the kernel lands on (`<base>/holder/elsewhere`) is a perfectly
    // real in-tree workforce, so "nothing escaped" is a weaker claim here than
    // it is anywhere else. Pinned to this refusal's own sentence rather than
    // the shared "refused for safety" tail, so that a future symlink check
    // firing on the kernel path instead cannot quietly satisfy it.
    for (const { name, open } of DOORS) {
      await expect(
        open(spelled),
        `${name} did not refuse a root spelled with a ".." through a link`,
      ).rejects.toThrow(
        /^Workforce directory ".+" is spelled with a "\.\." that steps back through an earlier segment/,
      );
    }
    await expectNoDoorReadsOutside(spelled, "root (`..` through a link)");
  });

  it("refuses a symlinked teams/ folder", async () => {
    const { root, outside } = scaffold();
    relink(root, outside, "teams");
    await expectNoDoorReadsOutside(root, "teams/ folder");
  });

  it("refuses a symlinked team folder", async () => {
    const { root, outside } = scaffold();
    relink(root, outside, `teams/${TEAM}`);
    await expectNoDoorReadsOutside(root, "team folder");
  });

  it("refuses a symlinked worker folder", async () => {
    const { root, outside } = scaffold();
    relink(root, outside, `teams/${TEAM}/workers/${WORKER}`);
    await expectNoDoorReadsOutside(root, "worker folder");
  });

  it.each([
    ["workers/ level", `teams/${TEAM}/workers`],
    ["resources/ slot", `teams/${TEAM}/resources`],
    ["channels/ slot", `teams/${TEAM}/channels`],
    ["skills/ level", `teams/${TEAM}/skills`],
    ["org/ level", "org"],
    ["locked code folder", "blocks"],
    ["locked folder's ancestor", "flows"],
  ])("refuses a symlinked %s", async (what, relative) => {
    const { root, outside } = scaffold();
    relink(root, outside, relative);
    await expectNoDoorReadsOutside(root, what);
  });

  it("refuses a symlinked ancestor of a level a reader jumps straight to", async () => {
    const { root, outside } = scaffold();
    // `readSeatSkills` addresses `teams/<t>/workers/<w>/skills` by name instead
    // of walking down to it, and `lstat` answers for the final component alone
    // — the OS resolves everything above it silently. Without an explicit
    // ancestor check this link is followed and the level loads from outside.
    relink(root, outside, `teams/${TEAM}/workers`);
    await expectNoDoorReadsOutside(root, "ancestor of a jumped-to level");
  });

  it("refuses every symlinked leaf file at once", async () => {
    const { root, outside } = scaffold();
    // A real folder says nothing about the file inside it: a link at the leaf
    // reaches outside exactly as a linked folder would, and each door has its
    // own leaf to be fooled at.
    for (const leaf of [
      `teams/${TEAM}/workers/${WORKER}/WORKER.md`,
      `teams/${TEAM}/channels/standup/CHANNEL.md`,
      `teams/${TEAM}/resources/brief.md`,
      `teams/${TEAM}/resources/store.ts`,
      `teams/${TEAM}/skills/team-skill/SKILL.md`,
      "blocks/tally.ts",
      "flows/workers/agent.ts",
    ]) {
      relink(root, outside, leaf);
    }
    await expectNoDoorReadsOutside(root, "leaf file");
  });
});

describe("what the root check deliberately does not cover", () => {
  // Both of these load the tree behind a link, and both are settled decisions
  // rather than gaps. They are pinned so the decision is visible where the
  // refusals are, and so a change to either is a test edit somebody has to
  // justify rather than a silent widening.

  it("does not look above the configured root", async () => {
    const { outside } = scaffold();
    // The root's own final component is a real directory; the link is its
    // parent. Checking above the root would mean refusing every root that lives
    // under a linked parent — which is the ordinary layout wherever a tree is
    // reached through a linked checkout or a linked config directory.
    mkdirSync(join(base, "holder"), { recursive: true });
    buildTree(join(base, "holder/tree"), CANARY);
    symlinkSync(join(base, "holder"), join(base, "gateway"));
    void outside;

    const { workers } = await readWorkforceDirectory(join(base, "gateway", "tree"));
    expect(workers).toHaveLength(1);
  });

  it("still opens the ordinary spellings a root arrives in", async () => {
    // The `..` refusal is the one check here that can fail by being too wide,
    // and the cost of that is an app that will not boot. These are the shapes a
    // configured root actually turns up in — absolute, trailing-separator,
    // doubled-separator, `.`-suffixed, and relative with leading `..` steps,
    // which collapse nothing because no directory precedes them.
    const { root } = scaffold();
    const spellings = [root, `${root}${sep}`, `${root}${sep}.`, `${base}${sep}${sep}configured`];
    for (const spelling of spellings) {
      const { workers } = await readWorkforceDirectory(spelling);
      expect(workers, `refused an ordinary root spelled "${spelling}"`).toHaveLength(1);
    }

    const cwd = process.cwd();
    try {
      process.chdir(join(root, "teams", TEAM));
      const { workers } = await readWorkforceDirectory(`..${sep}..`);
      expect(workers, "refused a root reached by stepping up from the caller").toHaveLength(1);
    } finally {
      process.chdir(cwd);
    }
  });

  it("follows a root spelled with a trailing `.` segment", async () => {
    const { outside } = scaffold();
    const linked = join(base, "linked-root");
    symlinkSync(outside, linked);

    // `<link>/.` resolves the link, and that is the documented way for an
    // operator who means to run a linked tree to say so. Unlike `<link>/`, this
    // spelling does not fall out of config by accident — it has to be written.
    const { workers } = await readWorkforceDirectory(`${linked}${sep}.`);
    expect(workers).toHaveLength(1);
  });
});
