// FIX-2624.
/**
 * The project picker's repository check is the projects flow's view, asked
 * with no session. Against the lab's own host, in process, with every request
 * recorded.
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

describe("the project picker's repository check", () => {
  it("asks the projects flow's view, with no session found or made", async () => {
    const data = mkdtempSync(join(tmpdir(), "claude-code-style-projects-"));
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
    const inProcess = createInProcessFetch(flowState as never) as unknown as typeof fetch;
    const asked: string[] = [];
    const fetcher = ((input: RequestInfo | URL, init?: RequestInit) => {
      asked.push(`${init?.method ?? "GET"} ${decodeURIComponent(String(input))}`);
      return inProcess(input, init);
    }) as typeof fetch;
    const client = createClient({ userId: "u_lab", baseUrl: "", fetcher });
    const lab = createWiredLab(client, { fetcher });

    expect(await lab.checkRepository(join(data, "not-listed"))).toMatchObject({ usable: false });
    expect(asked.filter((line) => /\/sessions\b|\/actions\//.test(line))).toEqual([]);
    expect(await client.sessions.list({ userId: "u_lab" })).toEqual([]);
  });
});
