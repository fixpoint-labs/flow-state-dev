/**
 * Goal check — personal-knowledge-mcp › it persists a concept across
 * stateless calls. Real path, model-free (CRUD needs no LLM) — see goal.md.
 *
 * Stands up the REAL `serve()` host (`@flow-state-dev/node`) fronting the
 * REAL MCP transport adapter (`@flow-state-dev/mcp`) and the knowledge-base
 * example's actual flow, backed by a PGlite-executor Postgres store (the
 * DURABLE `prod` profile, not in-memory) — so the check exercises schema
 * init + the production persistence wiring, not just in-process cross-
 * session visibility. Drives genuinely separate HTTP requests over the
 * loopback socket (`fetch`, not a synthetic `Request` passed to a router
 * function directly): MCP v1 is stateless, so request B is a fresh
 * ephemeral session — its ability to read request A's write is exactly the
 * "durable, user-scoped, secured personal wiki" outcome.
 *
 * Run: pnpm tsx goals/personal-knowledge-mcp/persists-a-concept-across-stateless-calls/run.mts
 */
import { PGlite } from "@electric-sql/pglite";
import type { QueryExecutor } from "@flow-state-dev/store-postgres";
import { loadFixture, runGoal } from "../../lib/index.mts";

const SECRET = process.env.KB_MCP_SECRET ?? "goal-check-secret";

// Held-out fixture — the runner reads id/type/title/body/passphrase from
// here and hardcodes none, so swapping in a different valid concept must
// still pass a correct implementation.
const fixture = loadFixture<{
  id: string;
  type: string;
  title: string;
  body: string;
  passphrase: string;
}>(import.meta.url, "concept.json");

/** Wrap PGlite to match `QueryExecutor` — the same shape store-postgres's own tests use. */
function pgliteExecutor(pglite: PGlite): QueryExecutor {
  return {
    async query(text: string, values?: unknown[]) {
      const result = await pglite.query(text, values);
      return { rows: result.rows as Record<string, unknown>[], rowCount: result.affectedRows ?? 0 };
    },
  };
}

function neverResolvesAModel(): never {
  throw new Error("personal-knowledge-mcp goal check: the knowledge flow has no generator actions.");
}

async function postMcp(
  baseUrl: string,
  body: unknown,
  auth: boolean,
): Promise<{ status: number; json: any }> {
  const res = await fetch(baseUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(auth ? { Authorization: `Bearer ${SECRET}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => undefined);
  return { status: res.status, json };
}

await runGoal(async () => {
  // Set before the FIRST (dynamic) import of the lab's config/flow modules —
  // both read `process.env.KB_MCP_SECRET` at module-evaluation time to build
  // the bearer-secret resolver and the fail-closed prod-profile guard.
  process.env.KB_MCP_SECRET = SECRET;

  const pglite = new PGlite();
  const { createFlowState } = await import("@flow-state-dev/engine");
  const { createMcpTransportAdapter } = await import("@flow-state-dev/mcp");
  const { postgresStores } = await import("@flow-state-dev/store-postgres");
  const { serve } = await import("@flow-state-dev/node");
  const { default: knowledgeFlow } = await import("../../../examples/knowledge-base/src/flow.ts");

  const modelResolver = Object.assign(neverResolvesAModel, {
    resolveId: neverResolvesAModel,
  }) as any;

  const flowstate = createFlowState({
    flows: { knowledge: knowledgeFlow },
    modelResolver,
    adapters: [createMcpTransportAdapter()],
    // The durable profile — PGlite executor, real schema init, real Postgres
    // store code paths. Not in-memory: the goal is durable persistence.
    stores: { prod: { primary: postgresStores({ executor: pgliteExecutor(pglite) }) } },
    defaultProfile: "prod",
  });

  const handle = await serve(flowstate, { port: 0, host: "127.0.0.1" });
  const baseUrl = `http://127.0.0.1:${handle.port}/api/flows/knowledge/mcp`;
  const failures: string[] = [];

  try {
    // Request A: create the concept.
    const createRes = await postMcp(
      baseUrl,
      {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "create_concept",
          arguments: { id: fixture.id, type: fixture.type, title: fixture.title, body: fixture.body },
        },
      },
      true,
    );
    if (createRes.status !== 200 || createRes.json?.error !== undefined || createRes.json?.result?.isError === true) {
      failures.push(`create_concept failed: ${JSON.stringify(createRes.json)}`);
    }

    // Request B: a SEPARATE request (fresh ephemeral session under MCP v1
    // statelessness) — read_concept + list_concepts, same bearer principal.
    const readRes = await postMcp(
      baseUrl,
      { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "read_concept", arguments: { id: fixture.id } } },
      true,
    );
    const readText: string = readRes.json?.result?.content?.[0]?.text ?? "";
    // Signal: the passphrase from request A's write appears in request B's
    // OWN response text — not asserted from the fixture directly, not from
    // request A's response, and not from reading the PGlite store directly.
    if (!readText.includes(fixture.passphrase)) {
      failures.push(
        `read_concept (separate request) did not carry the held-out passphrase — got ${JSON.stringify(readText)}`,
      );
    }

    const listRes = await postMcp(
      baseUrl,
      { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "list_concepts", arguments: {} } },
      true,
    );
    const listText: string = listRes.json?.result?.content?.[0]?.text ?? "";
    if (!listText.includes(fixture.id)) {
      failures.push(
        `list_concepts (separate request) did not carry the concept id — got ${JSON.stringify(listText)}`,
      );
    }

    // Negative: no Authorization header must be refused, not silently served.
    const unauthRes = await postMcp(
      baseUrl,
      { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "list_concepts", arguments: {} } },
      false,
    );
    if (unauthRes.status !== 401) {
      failures.push(`unauthenticated tools/call returned ${unauthRes.status}, expected 401`);
    }
  } finally {
    await handle.close();
    await pglite.close().catch(() => {});
  }

  return {
    failures,
    evidence:
      `create_concept in request A; a separate request B's read_concept carried the held-out ` +
      `passphrase and list_concepts carried the id (durable, PGlite-backed prod profile); an ` +
      `unauthenticated tools/call was refused with 401. Real serve() host over the loopback socket.`,
  };
});
