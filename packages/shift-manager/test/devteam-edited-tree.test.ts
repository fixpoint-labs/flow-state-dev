/**
 * A Lab opened with a control that changes a worker writes a copy of its tree
 * for the workforce kit to read (`edited-tree.mts`), and removes the copy when
 * it is disposed: a run of checks leaves no trees behind in the temp folder.
 * The copy is read off a temp folder of the test's own (`TMPDIR`), so no
 * other test's copies are counted.
 */
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { inMemoryStores } from "@flow-state-dev/engine";
import { harnessStub } from "@flow-state-dev/harness-manager";
import { openLab } from "../teams/devteam/host.mts";

const saved = process.env.TMPDIR;
let scratch: string | undefined;
afterEach(() => {
  if (saved === undefined) delete process.env.TMPDIR;
  else process.env.TMPDIR = saved;
  if (scratch !== undefined) rmSync(scratch, { recursive: true, force: true });
});

it("removes the copy of the tree it wrote when the Lab is disposed", async () => {
  const workspace = mkdtempSync(join(tmpdir(), "edited-tree-runs-"));
  scratch = mkdtempSync(join(tmpdir(), "edited-tree-tmp-"));
  process.env.TMPDIR = scratch;
  const copies = () => readdirSync(scratch!).filter((entry) => entry.startsWith("devforce-lab-tree-"));
  const lab = await openLab({
    stores: inMemoryStores(),
    harness: harnessStub({}).slot,
    workspace: { root: workspace, remotes: { allow: ["file"] } },
    coderWorkerId: "eng.coder",
    // A control that changes the coders' description: the tree is copied.
    coderHarness: "Cursor",
  });
  // The control wrote a copy, so its removal below means something.
  expect(copies()).toHaveLength(1);
  await lab.dispose();
  expect(copies()).toEqual([]);
  rmSync(workspace, { recursive: true, force: true });
}, 60_000);

it("opens with a worker's only own skill taken away, its emptied skills folder gone with it", async () => {
  const workspace = mkdtempSync(join(tmpdir(), "edited-tree-runs-"));
  scratch = mkdtempSync(join(tmpdir(), "edited-tree-tmp-"));
  process.env.TMPDIR = scratch;
  // The coder's own folder holds one skill: taking it away empties `skills/`, which the kit would refuse.
  const lab = await openLab({
    stores: inMemoryStores(),
    harness: harnessStub({}).slot,
    workspace: { root: workspace, remotes: { allow: ["file"] } },
    coderWorkerId: "eng.coder",
    mutateSkills: (seatId: string, skills: readonly { name: string }[]) =>
      seatId === "eng.coder" ? skills.filter((skill) => skill.name !== "branch-naming") : skills,
  } as never);
  try {
    const copy = readdirSync(scratch).find((entry) => entry.startsWith("devforce-lab-tree-"));
    expect(copy).toBeDefined();
    const own = join(scratch, copy!, "workforce", "teams", "eng", "workers", "coder");
    expect(readdirSync(own)).not.toContain("skills");
  } finally {
    await lab.dispose();
    rmSync(workspace, { recursive: true, force: true });
  }
}, 60_000);
