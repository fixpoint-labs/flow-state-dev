// FIX-2624.
/**
 * The readiness chips read harness-manager's readiness view by scope: the
 * picker reads them, and Re-check reads them again, with no session found or
 * made for the read. Against the lab's own host, in process.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createClient } from "@flow-state-dev/client";
import { createInProcessFetch } from "@flow-state-dev/engine";
import { scriptedModels } from "../../test-support/contract";
import { openLab } from "../host.mts";
import { createWiredLab } from "../src/adapter";

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

describe("the readiness chips", () => {
  it("read and re-check the harnesses with no session found or made", async () => {
    const data = mkdtempSync(join(tmpdir(), "claude-code-style-readiness-"));
    cleanups.push(() => rmSync(data, { recursive: true, force: true }));
    const { flowState } = await openLab({
      data,
      userId: "u_lab",
      model: "test/scripted",
      utilityModel: "test/utility",
      repositories: [],
      modelResolver: scriptedModels({}) as never,
    });
    cleanups.push(async () => (flowState as unknown as { dispose?: () => Promise<void> }).dispose?.());
    const fetcher = createInProcessFetch(flowState as never) as unknown as typeof fetch;
    const client = createClient({ userId: "u_lab", baseUrl: "", fetcher });
    const lab = createWiredLab(client, { fetcher });

    expect((await lab.readHarnesses()).map((harness) => harness.harness)).toEqual(["claude-code", "claude-code-plan", "codex", "cursor"]);
    expect((await lab.readHarnesses(true)).map((harness) => harness.harness)).toEqual(["claude-code", "claude-code-plan", "codex", "cursor"]);
    expect(await client.sessions.list({ userId: "u_lab" })).toEqual([]);
  });
});
