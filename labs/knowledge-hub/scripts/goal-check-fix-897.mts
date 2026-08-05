/**
 * FIX-897 goal check — the real MCP HTTP path (not `testFlow`, which bypasses
 * the `mcp.session` directive).
 *
 * Goal: a client can open a named conversation and log multiple captures grouped
 * under it. This drives the actual JSON-RPC `tools/call` surface through the
 * mounted MCP adapter and asserts, on the persisted stores:
 *
 *   (a) createConversation returns a `conv_`-prefixed id;
 *   (b) both logActivity requests were dispatched under that session id
 *       (the `{ fromInput: "conversationId" }` directive routed them);
 *   (c) both inbox rows carry the conversationId (the grouping key the sweeper reads);
 *   (d) the session's state holds the description createConversation wrote.
 *
 * Run from the lab root:
 *   KH_MCP_SECRET=test-secret pnpm tsx scripts/goal-check-fix-897.mts
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { toStates } from "@flow-state-dev/engine";

const SECRET = "test-secret";
process.env.KH_MCP_SECRET = SECRET;

// Isolate the filesystem store root so this never writes into a developer's
// real .fsdev/data inbox (the config roots the store at process.cwd()).
const storeDir = await mkdtemp(join(tmpdir(), "kh-goal-fix897-"));
const cwdBefore = process.cwd();
process.chdir(storeDir);

const failures: string[] = [];
function check(label: string, ok: boolean): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) failures.push(label);
}

const flowState = (await import("../fsdev.config")).default;
const { callMcpTool } = await import("../test/mcp-http");

async function callTool(name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  return callMcpTool(flowState, { secret: SECRET, name, args });
}

try {
  const description = "Planning the Q3 roadmap over a Claude conversation";
  const opened = await callTool("create_conversation", { description });
  const conversationId = opened.conversationId as string;

  check("(a) createConversation returns a conv_-prefixed id", typeof conversationId === "string" && /^conv_/.test(conversationId));

  await callTool("log_activity", { conversationId, kind: "task", content: "Draft the roadmap doc", situation: "roadmap chat" });
  await callTool("log_activity", { conversationId, kind: "goal", content: "Ship v1 by August", situation: "roadmap chat" });

  const runtime = await flowState.getRuntime();

  // (b) both logActivity requests ran under the minted session id.
  const reqs = await runtime.stores.request.list({ flowKind: "knowledge-hub", sessionId: conversationId });
  const logReqs = reqs.filter((r) => r.actionName === "logActivity");
  check("(b) both logActivity requests recorded under the conversation session id", logReqs.length === 2);

  // (c) both inbox rows carry the conversationId.
  const inbox = toStates<{ conversationId?: string }>(
    await runtime.stores.resourceState.getAll("user", "owner")
  );
  const rows = Object.entries(inbox).filter(([k]) => k.startsWith("inbox/"));
  check("(c) two inbox rows exist and both carry the conversationId", rows.length === 2 && rows.every(([, v]) => v.conversationId === conversationId));

  // (d) the session record (the conversation record) holds the description.
  const session = await runtime.stores.session.get(conversationId);
  check("(d) session state holds the description", (session?.state as { description?: unknown } | undefined)?.description === description);
} finally {
  await flowState.dispose();
  process.chdir(cwdBefore);
  await rm(storeDir, { recursive: true, force: true });
}

if (failures.length > 0) {
  console.error(`\nGOAL CHECK FAILED (${failures.length}): ${failures.join("; ")}`);
  process.exit(1);
}
console.log("\nGOAL CHECK PASSED — a client can open a conversation and group captures under it.");
