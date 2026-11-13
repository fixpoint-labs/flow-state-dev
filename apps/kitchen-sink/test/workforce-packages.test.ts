/**
 * Kitchen-sink's workforce and packages: a package the loader refuses stops
 * start, naming its folder.
 *
 * Every package problem is a start-time refusal, so a refused `PACKAGE.md` must
 * not boot the app with the worker quietly short that package. The workforce
 * kit reads the folder and refuses on it; this holds that for the app's own
 * tree, on a copy with one package that doesn't load.
 */
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { workforce } from "@flow-state-dev/workforce/kit";

import { workforceRoot } from "../lib/workforce-kit";
import * as generated from "../workforce/workforce.gen";
import { serveWorkforce } from "./workforce-host";

describe("the kitchen-sink workforce and packages", () => {
  it("starts on the app's own tree", async () => {
    const { flows, state } = await serveWorkforce();
    await state.dispose();
    expect([...flows.keys()]).toEqual(expect.arrayContaining(["agent", "coordinator", "workforce-roster"]));
  });

  it("does not start when the loader refused a package, naming its folder", async () => {
    const copy = join(mkdtempSync(join(tmpdir(), "kitchen-sink-packages-")), "workforce");
    cpSync(workforceRoot, copy, { recursive: true });
    const at = "teams/support/workers/devices/packages/refunds";
    mkdirSync(join(copy, at), { recursive: true });
    // A package whose PACKAGE.md names no description: the loader refuses it.
    writeFileSync(join(copy, at, "PACKAGE.md"), "---\nname: refunds\n---\n");
    const refused = await serveWorkforce(workforce({ directory: copy, generated, agent: { catalog: generated.blocks } })).then(
      () => "started",
      (error: Error) => error.message,
    );
    expect(refused).toContain(at);
  });
});
