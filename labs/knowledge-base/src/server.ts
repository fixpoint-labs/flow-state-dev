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
 * `/healthz` is exposed for the host's probe.
 *
 * Two independent guards keep a hosted server from ever serving
 * unauthenticated:
 *   1. `../fsdev.config` fails closed if the Postgres (`prod`) profile is
 *      selected without `KB_MCP_SECRET`.
 *   2. The bind guard below refuses to expose a non-loopback interface
 *      without a secret — covering the gap where `DATABASE_URL` is unset or
 *      mistyped (so the `dev` profile is silently chosen and the config
 *      guard doesn't fire) yet the process still binds `0.0.0.0`. Without
 *      this, a request with no `Authorization` header would fall through to
 *      the default body-userId resolver and a crafted `userId` in the
 *      `tools/call` body could read/write the corpus.
 */
import { isIP } from "node:net";
import { serve } from "@flow-state-dev/node";
import flowstate from "../fsdev.config";

const host = process.env.HOST ?? "0.0.0.0";

/** Loopback-only binds (127.0.0.0/8, ::1, localhost) are safe to serve without a secret; anything else is network-exposed. */
function isLoopbackHost(h: string): boolean {
  if (h === "localhost") return true;
  if (isIP(h) === 4) return h === "127.0.0.1" || h.startsWith("127.");
  if (isIP(h) === 6) return h === "::1";
  return false;
}

if (!isLoopbackHost(host) && !process.env.KB_MCP_SECRET) {
  throw new Error(
    `Refusing to bind ${host} without KB_MCP_SECRET: a network-exposed knowledge server must be ` +
      `authenticated. Set KB_MCP_SECRET (and a Postgres URL for durability), or bind a loopback ` +
      `host (HOST=127.0.0.1) for local-only use.`,
  );
}

await serve(flowstate, {
  port: Number(process.env.PORT ?? 3000),
  host,
});
