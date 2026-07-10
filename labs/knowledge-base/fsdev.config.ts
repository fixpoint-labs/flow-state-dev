/**
 * fsdev config for the knowledge-base incubation lab — a secured personal
 * MCP server (FIX-855).
 *
 * `dev` (no Postgres URL set) keeps in-memory stores for local iteration.
 * `prod` (a Postgres URL is set) persists the corpus and requires
 * `KB_MCP_SECRET` — enforced below so a hosted deploy can never fall back to
 * the unauthenticated default body-userId resolver.
 *
 *   pnpm fsdev dev                          # serve locally (dev profile)
 *   KB_MCP_SECRET=... pnpm serve            # standalone host (prod profile)
 */
import { createMcpTransportAdapter } from "@flow-state-dev/mcp";
import { createFlowState, filesystemStores } from "@flow-state-dev/engine";
import { postgresStores } from "@flow-state-dev/store-postgres";
import type { ModelResolver } from "@flow-state-dev/core";
import knowledgeFlow from "./src/flow";
import path from "node:path";

/**
 * `knowledge` has no generator actions — pure CRUD, no model calls. Passing
 * an explicit resolver (rather than relying on `createFlowState`'s
 * auto-built one) skips `createModelResolver`'s `FSDEV_DEFAULT_MODEL` /
 * `FSDEV_INTENT_*` env scan, which throws when an ambient env sets
 * `FSDEV_DEFAULT_MODEL` but no intents are declared — a real
 * misconfiguration for a model-using app, a no-op here.
 */
function neverResolvesAModel(): never {
  throw new Error("knowledge-base lab: no generator actions are configured; this flow never resolves a model.");
}
const modelResolver = Object.assign(neverResolvesAModel, {
  resolveId: neverResolvesAModel,
}) as ModelResolver;

// Select prod when either Postgres URL the adapter honors is set — not just
// DATABASE_URL — else a FSD_DB_URL-only deploy silently picks in-memory dev
// and loses the corpus on restart.
const profile = (process.env.FSD_DB_URL ?? process.env.DATABASE_URL) ? "prod" : "dev";

// Fail closed at config load: a hosted deploy (prod profile) MUST carry the
// bearer secret. `src/flow.ts` only constructs `authentication.resolvePrincipal`
// when KB_MCP_SECRET is set — without this guard, a prod deploy missing the
// secret would leave `resolvePrincipal` undefined and fall back to the
// unauthenticated default body-userId resolver. Dev (no Postgres URL) needs
// no secret, so importing this config in local dev / CI never throws.
if (profile === "prod" && !process.env.KB_MCP_SECRET) {
  throw new Error("KB_MCP_SECRET must be set for the hosted (Postgres) profile");
}

export default createFlowState({
  flows: { knowledge: knowledgeFlow },
  modelResolver,
  adapters: [createMcpTransportAdapter()], // mounts POST /api/flows/knowledge/mcp
  stores: {
    dev: { primary: filesystemStores({ rootDir: path.join(process.cwd(), ".fsdev", "data") }) },
    // Empty options object required by the signature; the adapter then reads
    // FSD_DB_URL -> DATABASE_URL.
    prod: { primary: postgresStores({}) },
  },
  defaultProfile: profile,
  onError: (error, context) => {
    console.error(`[flow-api] ${context.method} ${context.path}:`, error.message);
  },
});
