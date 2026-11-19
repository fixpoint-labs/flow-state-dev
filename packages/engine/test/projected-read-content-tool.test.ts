/**
 * `readResourceContent` over a projected collection, against the real
 * resource registry.
 *
 * `searchResources` hands the model a projected record's uri; the read tool
 * must then read that uri when the collection opted in with `llmReadable`,
 * and refuse it, as for an unknown uri, when it didn't. The gate is the
 * collection's flag, which a projected record's ref carries as a store-backed
 * instance's ref does.
 */
import { DEFAULT_ORG_ID, defineFlow, defineProjectedResourceCollection, handler, readResourceContentTool } from "@flow-state-dev/core";
import { parseResourceTemplate } from "@flow-state-dev/core/resource-template";
import { asRuntime } from "@flow-state-dev/core/types";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createExecutionContext } from "../src";
import { createInMemoryStores } from "../src/host";

const s = z.object({ v: z.string() });
const template = parseResourceTemplate("<system>value {{ state.v }}</system>");
const read = async ({ key }: { key: string }) => (key === "AAPL" ? { v: "aapl" } : null);
const search = (async () => ({ hits: [] })) as never;

async function makeCtx() {
  const resources = {
    positions: defineProjectedResourceCollection({ pattern: "positions/*", scope: "session", stateSchema: s, llmReadable: true, contentTemplate: template, read, search }),
    // Not opted in: blocks reach it, the model doesn't.
    ledger: defineProjectedResourceCollection({ pattern: "ledger/*", scope: "session", stateSchema: s, contentTemplate: template, read, search }),
  };
  const block = handler({ name: "noop", resources, execute: () => "ok" });
  const flow = defineFlow({ kind: "projected-read-content", actions: { run: { inputSchema: z.string(), block } } })();
  return createExecutionContext({
    orgId: DEFAULT_ORG_ID,
    flow,
    actionName: "run",
    requestId: "req_1",
    sessionId: "sess_1",
    userId: "user_1",
    stores: createInMemoryStores(),
  });
}

async function readContent(uri: string): Promise<string> {
  const ctx = await makeCtx();
  try {
    return JSON.stringify(await asRuntime(readResourceContentTool()).run({ uri }, ctx as never));
  } catch (err) {
    return `throw ${err instanceof Error ? err.message : String(err)}`;
  }
}

describe("readResourceContent over a projected collection", () => {
  it("reads a record of an llmReadable projected collection by the uri a search returns", async () => {
    expect(await readContent("session/positions/AAPL")).toBe(JSON.stringify({ uri: "session/positions/AAPL", content: "value aapl" }));
  });

  it("refuses a record of a projected collection that didn't opt in, as it refuses an unknown uri", async () => {
    expect(await readContent("session/ledger/AAPL")).toBe("throw Readable resource not found for uri: session/ledger/AAPL");
    expect(await readContent("session/positions/ZZZ")).toBe("throw Readable resource not found for uri: session/positions/ZZZ");
  });
});
