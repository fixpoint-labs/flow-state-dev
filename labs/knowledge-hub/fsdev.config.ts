/**
 * fsdev config for the Knowledge Hub lab (FIX-882).
 *
 * Filesystem `dev` profile — no Postgres, still zero generators. The capture
 * surface is CLI-only by default: the MCP adapter (and every HTTP transport, via
 * the flow's fail-closed resolver) mounts only when `KH_MCP_SECRET` is set, so a
 * local import / CI run without the secret exposes no network endpoint. Hosted
 * deployment and a durable shared store land with FIX-883, when a second process
 * (the cron sweeper) actually needs them.
 *
 *   pnpm fsdev run knowledge-hub logActivity -i '{...}'   # CLI, no secret needed
 * HTTP hosts must forward `/mcp/*` to this FlowState router.
 */
import { createMcpTransportAdapter } from "@flow-state-dev/mcp";
import { createFlowState, filesystemStores } from "@flow-state-dev/engine";
import type { ModelResolver } from "@flow-state-dev/core";
import knowledgeHubFlow from "./src/flow";
import path from "node:path";

/**
 * The capture flow has no generator actions — `logActivity` / `listInbox` are
 * pure resource CRUD, no model calls. Passing an explicit throwing resolver
 * skips the ambient `FSDEV_DEFAULT_MODEL` / `FSDEV_INTENT_*` env scan (mirrors
 * the knowledge-base example's config), which would otherwise throw on a
 * model-using env here.
 */
function neverResolvesAModel(): never {
  throw new Error("knowledge-hub: no generator actions are configured yet; this flow never resolves a model.");
}
const modelResolver = Object.assign(neverResolvesAModel, {
  resolveId: neverResolvesAModel,
}) as ModelResolver;

export default createFlowState({
  flows: { "knowledge-hub": knowledgeHubFlow },
  modelResolver,
  // Fail closed: mount the MCP endpoint (POST /mcp/knowledge-hub) only
  // when the bearer secret is set — belt-and-suspenders on top of the flow's
  // throwing resolver. No secret ⇒ no MCP endpoint at all, CLI-only.
  //
  // `forwardQueryParams: ["source"]` makes `source` an INSTALLATION-level value:
  // each client points at its own tagged URL
  // (`.../mcp/knowledge-hub?source=claude-desktop`)
  // and every capture from it carries that provenance, authoritatively — the
  // model can't override it. The field stays in `logActivity`'s input schema and
  // in the mailroom fingerprint; it just fills from the URL instead of the model.
  adapters: process.env.KH_MCP_SECRET
    ? [
        createMcpTransportAdapter({
          dedicatedBasePath: true,
          forwardQueryParams: ["source"],
        }),
      ]
    : [],
  stores: {
    dev: { primary: filesystemStores({ rootDir: path.join(process.cwd(), ".fsdev", "data") }) },
  },
  defaultProfile: "dev",
  // Let `fsdev dev` drive the bearer-gated flow through DevTool: the flow's
  // resolver returns a fixed `owner` principal on a valid token, so DevTool
  // creates its session as `owner` and forwards the same secret. With
  // KH_MCP_SECRET unset the flow stays CLI-only (no token sent, resolver
  // throws) — unchanged. The token reaches only the loopback DevTool page.
  devtool: {
    userId: "owner",
    bearerToken: process.env.KH_MCP_SECRET,
  },
});
