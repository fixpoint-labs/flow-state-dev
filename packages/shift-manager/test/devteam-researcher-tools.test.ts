/**
 * The Researcher has something to look things up with (FIX-2496): web search,
 * fetch, and reads of its session's project. Its whole job is knowing things,
 * and with `tools: []` it answered from the model's memory.
 *
 * Two halves, because either alone is a broken lab: the worker's file names
 * the tools, and the `agent` flow's catalog carries them. A name the catalog
 * does not carry is refused when the flow mints, so the open itself fails.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { inMemoryStores } from "@flow-state-dev/engine";
import { harnessStub } from "@flow-state-dev/harness-manager";
import { openLab, type Lab } from "../teams/devteam/host.mts";

const LOOKUPS = ["search", "fetch", "globProjectSource", "readProjectSource", "grepProjectSource"];

let lab: Lab | undefined;
afterEach(async () => {
  await lab?.dispose();
  lab = undefined;
});

/** The Researcher's resolved `tools:` line, read off the lab's installation. */
function researcherTools(opened: Lab): unknown {
  const researcher = opened.roster.workers.find((worker) => worker.declared.name === "Researcher");
  expect(researcher, "the tree declares the Researcher").toBeDefined();
  return opened.installation.standardWorker(researcher!.id)?.declared.tools;
}

it("the Researcher holds web search, fetch and the project reads, on a lab with a projects workspace", async () => {
  lab = await openLab({
    stores: inMemoryStores(),
    harness: harnessStub({}).slot,
    workspace: { root: mkdtempSync(join(tmpdir(), "devteam-researcher-")), remotes: { allow: ["file"] } },
    coderWorkerId: "eng.coder",
  });
  expect(researcherTools(lab)).toEqual(LOOKUPS);
});

it("the Researcher holds the same tools on a lab over one fixed repository, where the coder has no projects host", async () => {
  // The project reads fall back to the answer host here; without it the open
  // would be refused for names the catalog does not carry.
  lab = await openLab({
    stores: inMemoryStores(),
    harness: harnessStub({}).slot,
    workspace: { root: mkdtempSync(join(tmpdir(), "devteam-researcher-fixed-")), sourceRepo: process.cwd(), baseRef: "HEAD" },
    coderWorkerId: "eng.coder",
  });
  expect(researcherTools(lab)).toEqual(LOOKUPS);
});
