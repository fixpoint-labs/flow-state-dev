// ---------------------------------------------------------------------------
// fsdev.config.ts adapter wiring (FIX-882 fail-closed mount; FIX-888 source
// forwarding).
//
// Modeled on examples/knowledge-base/test/config.spec.ts: each case sets env,
// resets the module registry, and dynamically imports the config fresh so the
// adapter decision (`process.env.KH_MCP_SECRET ? [mcp] : []`) is re-evaluated.
// `createFlowState` is lazy, so importing never opens a store. We then build the
// router and probe the MCP endpoint — a custom adapter route gets first crack at
// dispatch, so an unmounted MCP endpoint falls through to the catch-all's 404,
// while a mounted one is handled by the adapter (non-404).
//
// The FIX-888 cases drive a real authenticated `tools/call log_activity` with a
// `?source=` query param and read the persisted record back off the runtime's
// resource store, so the actual `forwardQueryParams: ["source"]` wiring — not
// just the mechanism it delegates to — is covered: a typo'd option key or a
// merge-precedence regression in the shared adapter would fail here.
//
// These cases capture through the REAL config, whose filesystem store roots at
// `process.cwd()/.fsdev/data` (captured at config import). Each test runs in a
// throwaway temp cwd so the suite never writes into the developer's own
// `.fsdev/data` inbox — deleting that shared dir in cleanup would wipe real
// local captures, so we isolate the store root instead.
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { callMcpTool } from "./mcp-http";

const original = process.env.KH_MCP_SECRET;

// Isolate the filesystem store root: chdir into a fresh temp dir before each
// test (so the config's `process.cwd()/.fsdev/data` lands there), restore + drop
// it after. Runs around every test in this file; the describe-level afterEach
// (which disposes the FlowState) is inner and fires first, so store handles are
// closed before the dir is removed.
let cwdBefore: string;
let storeDir: string;
beforeEach(async () => {
  cwdBefore = process.cwd();
  storeDir = await mkdtemp(join(tmpdir(), "kh-config-spec-"));
  process.chdir(storeDir);
});
afterEach(async () => {
  process.chdir(cwdBefore);
  await rm(storeDir, { recursive: true, force: true });
});

function setSecret(value: string | undefined): void {
  if (value === undefined) delete process.env.KH_MCP_SECRET;
  else process.env.KH_MCP_SECRET = value;
}

async function loadConfig() {
  vi.resetModules();
  return (await import("../fsdev.config")).default;
}

/** POST an MCP request and return the HTTP status. 404 ⇒ the MCP route is not
 *  mounted (no adapter); anything else ⇒ the adapter handled it. */
async function mcpStatus(flowState: Awaited<ReturnType<typeof loadConfig>>): Promise<number> {
  const router = await flowState.getRouter();
  const req = new Request("http://localhost/mcp/knowledge-hub", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  const res = await router.POST(req, { params: { path: ["mcp", "knowledge-hub"] } });
  return res.status;
}

describe("fsdev.config fail-closed MCP adapter", () => {
  // Disposed in afterEach (not inline) so a failing assertion can't leak the
  // opened filesystem-backed runtime.
  let flowState: Awaited<ReturnType<typeof loadConfig>> | undefined;
  afterEach(async () => {
    await flowState?.dispose();
    flowState = undefined;
    setSecret(original);
    vi.resetModules();
  });

  it("without KH_MCP_SECRET: imports without throwing and mounts no MCP adapter", async () => {
    setSecret(undefined);
    flowState = await loadConfig();
    expect(flowState).toBeDefined();
    expect(await mcpStatus(flowState)).toBe(404);
  });

  it("with KH_MCP_SECRET: the MCP adapter is mounted (endpoint no longer 404s)", async () => {
    setSecret("test-secret");
    flowState = await loadConfig();
    expect(await mcpStatus(flowState)).not.toBe(404);
  });
});

/** `log_activity` over MCP with a defaulted contextId — these cases exercise
 *  ?source= forwarding, not grouping. */
async function captureViaMcp(
  flowState: Awaited<ReturnType<typeof loadConfig>>,
  query: string,
  args: Record<string, unknown>
): Promise<{ id: string; deduplicated: boolean }> {
  return (await callMcpTool(flowState, "log_activity", { contextId: "ctx_config", ...args }, { query })) as {
    id: string;
    deduplicated: boolean;
  };
}

/** Read the persisted `source` off the owner-scoped inbox record for `id`. */
async function readSource(
  flowState: Awaited<ReturnType<typeof loadConfig>>,
  id: string
): Promise<string | null> {
  const runtime = await flowState.getRuntime();
  const all = (await runtime.stores.resourceState.getAll("user", "owner")) as Record<
    string,
    { source: string | null }
  >;
  return all[`inbox/${id}`]?.source ?? null;
}

describe("fsdev.config forwards ?source= into the capture (FIX-888)", () => {
  // Disposed in afterEach (not inline) so a failing assertion can't leak the
  // opened filesystem-backed runtime and strand its `.fsdev/data` state.
  let flowState: Awaited<ReturnType<typeof loadConfig>> | undefined;
  afterEach(async () => {
    await flowState?.dispose();
    flowState = undefined;
    setSecret(original);
    vi.resetModules();
  });

  it("stamps the endpoint's ?source= onto the persisted record", async () => {
    setSecret("test-secret");
    flowState = await loadConfig();
    // Unique content so a leftover .fsdev/data record from a prior local run
    // can't dedup this capture and flip `deduplicated`.
    const out = await captureViaMcp(flowState, "?source=claude-desktop", {
      kind: "task",
      content: `book dentist ${randomUUID()}`,
      context: "config wiring test",
    });
    expect(out.deduplicated).toBe(false);
    expect(await readSource(flowState, out.id)).toBe("claude-desktop");
  });

  it("overrides a model-supplied source argument (installation value wins)", async () => {
    setSecret("test-secret");
    flowState = await loadConfig();
    const out = await captureViaMcp(flowState, "?source=endpoint", {
      kind: "task",
      content: `renew passport ${randomUUID()}`,
      context: "config wiring test",
      source: "model-guess",
    });
    expect(await readSource(flowState, out.id)).toBe("endpoint");
  });
});

// The real MCP HTTP path consults the `mcp.session` directive (which `testFlow`
// bypasses), so this is the CI home for the FIX-897 goal — proving createContext
// mints a ctx_ id and log_activity's `{ fromInput: "contextId" }` routes captures
// into that one flow session. Mirrors scripts/goal-check-fix-897.mts, in CI.
describe("mcp.session groups captures under a context (FIX-897)", () => {
  let flowState: Awaited<ReturnType<typeof loadConfig>> | undefined;
  afterEach(async () => {
    await flowState?.dispose();
    flowState = undefined;
    setSecret(original);
    vi.resetModules();
  });

  it("createContext mints a ctx_ id; captures sharing it run in one session, store the description, and carry it on the rows", async () => {
    setSecret("test-secret");
    flowState = await loadConfig();

    const description = `roadmap planning ${randomUUID()}`;
    const opened = await callMcpTool(flowState, "create_context", { description });
    const contextId = opened.contextId as string;
    expect(contextId).toMatch(/^ctx_/);

    await callMcpTool(flowState, "log_activity", {
      contextId,
      kind: "task",
      content: `draft the doc ${randomUUID()}`,
      context: "roadmap chat",
    });
    await callMcpTool(flowState, "log_activity", {
      contextId,
      kind: "goal",
      content: `ship v1 ${randomUUID()}`,
      context: "roadmap chat",
    });

    const runtime = await flowState.getRuntime();

    // Both log_activity requests dispatched under the minted session id (the
    // `{ fromInput: "contextId" }` directive routed them) — the grouping proof.
    const reqs = await runtime.stores.request.list({ flowKind: "knowledge-hub", sessionId: contextId });
    expect(reqs.filter((r) => r.actionName === "logActivity")).toHaveLength(2);

    // The session record IS the context record — its state holds the description.
    const session = await runtime.stores.session.get(contextId);
    expect((session?.state as { description?: unknown } | undefined)?.description).toBe(description);

    // Both inbox rows carry the contextId (the grouping key the sweeper reads).
    const inbox = (await runtime.stores.resourceState.getAll("user", "owner")) as Record<
      string,
      { contextId?: string }
    >;
    const rows = Object.entries(inbox).filter(([key]) => key.startsWith("inbox/"));
    expect(rows).toHaveLength(2);
    expect(rows.every(([, record]) => record.contextId === contextId)).toBe(true);
  });
});
