/**
 * Standalone server entry — stands up just the flows, no app wrapper.
 *
 * Deploy to a long-lived host (Railway, Render, Fly, a container, a VPS)
 * with a Postgres URL (`FSD_DB_URL`/`DATABASE_URL`) and `KB_MCP_SECRET` set:
 *
 *   KB_MCP_SECRET=... DATABASE_URL=... pnpm serve
 *
 * `POST /api/flows/knowledge/mcp` is served by the registered MCP adapter
 * (../fsdev.config.ts); GET/DELETE on that path return 405 (MCP v1).
 * `/healthz` is exposed for the host's probe. Importing `../fsdev.config`
 * triggers its fail-closed KB_MCP_SECRET guard for the hosted (Postgres)
 * profile, so a deploy missing the secret refuses to start rather than
 * serving unauthenticated.
 */
import { serve } from "@flow-state-dev/node";
import flowstate from "../fsdev.config";

await serve(flowstate, {
  port: Number(process.env.PORT ?? 3000),
  host: "0.0.0.0",
});
