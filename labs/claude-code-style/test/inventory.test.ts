/**
 * The lab's inventory: what the app is made of, read off its files. The lab
 * is configuration, screens and a few small flows; what the server computes
 * reaches a screen only through a kit package's view or a direct read. Each
 * rule fails on the shape it forbids. The rules live in the shared module
 * (`labs/test-support/inventory.mts`), run with the lab's settings
 * (`inventory-settings.ts`) against an empty allowlist; the epic's closure
 * goal grades the same rules and settings:
 *
 * - no adapter (`src/adapter.ts`), no fake lab (`test/fake-lab.ts`), and no
 *   `LabAdapter` seam anywhere in the lab;
 * - nothing of the app's in `workforce/`: that folder holds the `WORKER.md`
 *   tree the workforce kit reads, and no code;
 * - every file is configuration, UI, a small flow or outside the count
 *   (FIX-2152 ER-1, by path), within ER-1's caps;
 * - no screen file reaches the server itself: the entry imports only
 *   `createClient`, and no file imports another client value or calls
 *   `.subscribe(` or `.flow(`, `src/app/` included;
 * - every exported object type in a `src/` module that is not a component
 *   is on the settings' screen types, the types the screen computes itself;
 *   a row a view returns takes its type from the view;
 * - the host keeps no wiring a kit replaces: no `workerFlows` callback, no
 *   call to workforce's retired installation or hire function, no `as never`.
 *
 * A rule the lab doesn't meet yet is an `it.fails`, green while the lab still
 * breaks it and red the day it stops, and that PR makes it an `it`.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { checkInventory, filesUnder, findings } from "../../test-support/inventory.mts";
import { claudeCodeStyle } from "./inventory-settings.ts";

const LAB = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string) => readFileSync(join(LAB, rel), "utf8");
const code = (rel: string) => /\.(m?ts|tsx)$/.test(rel);

/** The lab's own code: its screens, flows, host and CLI, not its tests. */
const APP_CODE = [...filesUnder("src", LAB), ...filesUnder("flows", LAB), ...filesUnder("cli", LAB), "host.mts", "fsdev.config.mts"].filter(code);

/** The workforce identifiers of its project concept the lab may not import once a session works in a repository. */
const PROJECT_CONCEPT = ["parseProjectRef", "projectRef", "PROJECTS_PATTERN", "WORK_PROJECT_STATE_KEY", "CreateProjectOutput", "projectSourceCapability", "projectWorkspace", "defineProjectBlocks", "projectChecks"];

describe("the lab's inventory", () => {
  it("has no adapter, no fake lab and no LabAdapter seam", () => {
    expect(existsSync(join(LAB, "src/adapter.ts"))).toBe(false);
    expect(existsSync(join(LAB, "test/fake-lab.ts"))).toBe(false);
    const seam = [...APP_CODE, ...filesUnder("test", LAB).filter(code)].filter((rel) => !rel.startsWith("test/inventory") && read(rel).includes("LabAdapter"));
    expect(seam).toEqual([]);
  });

  it("keeps nothing of the app's in workforce/: only the WORKER.md tree", () => {
    expect(filesUnder("workforce", LAB).filter((rel) => !rel.endsWith(".md"))).toEqual([]);
  });

  // Every file classed (L1), within ER-1's caps (L2), no screen file reaching the server,
  // src/app/ included (L3), no row a view returns typed by hand (L4), no host wiring (H).
  it("meets every rule with an empty allowlist: no file classed wrong, over a cap, reaching the server, typing a row by hand, or wiring the host", () => {
    expect(checkInventory(claudeCodeStyle)).toEqual([]);
  });

  it("reads each exported interface on its own: an unlisted one after a listed one is still named", () => {
    // A listed interface's body must not swallow the declarations after it.
    const lab = mkdtempSync(join(tmpdir(), "inventory-l4-"));
    mkdirSync(join(lab, "src"));
    writeFileSync(join(lab, "src/modes.ts"), "export interface Mode {\n  id: string;\n}\n\nexport interface BoardRow {\n  id: string;\n}\n");
    try {
      expect(findings({ ...claudeCodeStyle, root: lab }).map((f) => `${f.rule} ${f.file}: ${f.symbol}`)).toEqual(["L4 src/modes.ts: BoardRow"]);
    } finally {
      rmSync(lab, { recursive: true, force: true });
    }
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
