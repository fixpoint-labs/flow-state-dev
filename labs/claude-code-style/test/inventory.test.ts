/**
 * The lab's inventory: what the app is made of, read off its files. The lab
 * is configuration, screens and a few small flows; what the server computes
 * reaches a screen only through a kit package's view or a direct read. Each
 * rule fails on the shape it forbids, and the rules live in
 * `inventory-rules.ts`, which the epic's closure goal grades too:
 *
 * - no adapter (`src/adapter.ts`), no fake lab (`test/fake-lab.ts`), and no
 *   `LabAdapter` seam anywhere in the lab;
 * - nothing of the app's in `workforce/`: that folder holds the `WORKER.md`
 *   tree the workforce kit reads, and no code;
 * - every file is configuration, UI, a small flow or outside the count
 *   (FIX-2152 ER-1, by path), within ER-1's caps;
 * - no screen file reaches the server itself: the entry imports only
 *   `createClient`, and no file imports another client value or calls
 *   `.subscribe(` or `.flow(`, `src/lab.ts` included;
 * - every exported object type in a `src/` module that is not a component
 *   is on `SCREEN_TYPES`, the types the screen computes itself; a row a view
 *   returns takes its type from the view;
 * - the host keeps no wiring a kit replaces: no `workerFlows` callback, no
 *   call to workforce's retired installation or hire function, no `as never`.
 *
 * A rule the lab doesn't meet yet is an `it.fails`, green while the lab still
 * breaks it and red the day it stops, and that PR makes it an `it`.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { filesUnder, hostWiring, LAB, overCaps, reachingTheServer, unlistedTypes, unclassified } from "./inventory-rules";

const read = (rel: string) => readFileSync(join(LAB, rel), "utf8");
const code = (rel: string) => /\.(m?ts|tsx)$/.test(rel);

/** The lab's own code: its screens, flows, host and CLI, not its tests. */
const APP_CODE = [...filesUnder("src"), ...filesUnder("flows"), ...filesUnder("cli"), "host.mts", "fsdev.config.mts"].filter(code);

/** The workforce identifiers of its project concept the lab may not import once a session works in a repository. */
const PROJECT_CONCEPT = ["parseProjectRef", "projectRef", "PROJECTS_PATTERN", "WORK_PROJECT_STATE_KEY", "CreateProjectOutput", "projectSourceCapability", "projectWorkspace", "defineProjectBlocks", "projectChecks"];

describe("the lab's inventory", () => {
  it("has no adapter, no fake lab and no LabAdapter seam", () => {
    expect(existsSync(join(LAB, "src/adapter.ts"))).toBe(false);
    expect(existsSync(join(LAB, "test/fake-lab.ts"))).toBe(false);
    const seam = [...APP_CODE, ...filesUnder("test").filter(code)].filter((rel) => !rel.startsWith("test/inventory") && read(rel).includes("LabAdapter"));
    expect(seam).toEqual([]);
  });

  it("keeps nothing of the app's in workforce/: only the WORKER.md tree", () => {
    expect(filesUnder("workforce").filter((rel) => !rel.endsWith(".md"))).toEqual([]);
  });

  it("classes every file as configuration, UI, a small flow or outside the count", () => {
    expect(unclassified()).toEqual([]);
  });

  it("keeps its flows and configuration within ER-1's caps", () => {
    expect(overCaps()).toEqual([]);
  });

  it("reaches the server from no screen file at all: src/lab.ts reads and sends through package hooks", () => {
    expect(reachingTheServer()).toEqual([]);
  });

  it("types no row a view returns by hand: every exported object type outside the components is one the screen computes", () => {
    expect(unlistedTypes()).toEqual([]);
  });

  it("keeps no host wiring a kit replaces: no workerFlows callback, no installation or hire call, no as never", () => {
    expect(hostWiring(join(LAB, "host.mts"))).toEqual([]);
  });

  // FIX-2594: the picker lists repositories, not workforce projects.
  it.fails("imports none of workforce's project concept", () => {
    const imports = APP_CODE.flatMap((rel) => {
      const text = read(rel);
      return PROJECT_CONCEPT.filter((name) => new RegExp(`\\b${name}\\b`).test(text)).map((name) => `${rel}: ${name}`);
    });
    expect(imports).toEqual([]);
  });
});
