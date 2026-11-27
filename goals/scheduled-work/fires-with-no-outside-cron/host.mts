/**
 * One process of the goal's app (`app.mts`), as `run.mts` starts it. Prints
 * `__READY__` once it serves, and runs until it is stopped.
 *
 * `GOAL_ROLE`:
 *   serve    `serve()` with the default scheduler: the local cron
 *   vercel   `scheduler: vercelScheduler()`, its route at `GET /api/cron/schedules`
 *            beside the flow API, on one plain Node server
 *   web      `serve()` with `scheduler: false` and a BullMQ job queue, enqueue-only
 *   worker   a BullMQ process-only job-queue process: it resolves the runtime,
 *            which starts processing, and serves nothing
 *
 * `GOAL_PROCESS` names it on the ledger; `GOAL_SEED=1` has a run write the
 * user's schedule row first. Stores: `GOAL_DB` (SQLite) or `GOAL_PG_URL`.
 */
import { createServer } from "node:http";
import { Readable } from "node:stream";
import { serve } from "@flow-state-dev/node";
import { bullmqJobQueue } from "@flow-state-dev/bullmq";
import { vercelScheduler } from "@flow-state-dev/vercel";
import { goalApp } from "./app.mts";

const env = (name: string): string => {
  const value = process.env[name];
  if (value === undefined || value === "") throw new Error(`host: ${name} is not set`);
  return value;
};
const ROLE = env("GOAL_ROLE");
const PORT = Number(process.env.GOAL_PORT ?? "0");
const pgUrl = process.env.GOAL_PG_URL;
const store = pgUrl !== undefined && pgUrl !== "" ? { postgres: pgUrl } : { sqlite: env("GOAL_DB") };
const queue = (mode: "enqueue-only" | "process-only") =>
  bullmqJobQueue({ connection: env("GOAL_REDIS_URL"), queueName: env("GOAL_QUEUE"), mode });

const scheduler = ROLE === "vercel" ? vercelScheduler() : ROLE === "web" ? false : undefined;
const jobQueue = ROLE === "web" ? queue("enqueue-only") : ROLE === "worker" ? queue("process-only") : undefined;
const { app, seed } = goalApp({
  process: env("GOAL_PROCESS"),
  ledger: env("GOAL_LEDGER"),
  store,
  ...(scheduler === undefined ? {} : { scheduler }),
  ...(jobQueue === undefined ? {} : { jobQueue })
});

if (process.env.GOAL_SEED === "1") await seed();

if (ROLE === "serve" || ROLE === "web") {
  await serve(app, { port: PORT, host: "127.0.0.1" });
} else if (ROLE === "vercel") {
  const router = await app.getRouter();
  const route = (scheduler as ReturnType<typeof vercelScheduler>).route;
  // What Vercel gives the app: its cron route, and the flow API every dispatch reaches over the network.
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
      const method = req.method ?? "GET";
      const body = method === "GET" || method === "HEAD" ? undefined : (Readable.toWeb(req) as ReadableStream);
      const request = new Request(url, { method, headers: req.headers as Record<string, string>, body, duplex: "half" } as RequestInit);
      let response: Response;
      if (url.pathname === "/api/cron/schedules") response = await route(request);
      else if (url.pathname.startsWith("/api/flows/")) {
        const path = url.pathname.slice("/api/flows/".length).split("/").map(decodeURIComponent);
        const handle = (router as unknown as Record<string, (r: Request, c: { params: { path: string[] } }) => Promise<Response>>)[method];
        response = handle === undefined ? new Response(null, { status: 405 }) : await handle(request, { params: { path } });
      } else response = new Response(null, { status: 404 });
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch (err) {
      res.writeHead(500);
      res.end(String(err));
    }
  });
  await new Promise<void>((resolve) => server.listen(PORT, "127.0.0.1", resolve));
} else if (ROLE === "worker") {
  await app.getRuntime();
} else {
  throw new Error(`host: unknown GOAL_ROLE ${ROLE}`);
}

console.log("__READY__");
const stop = () => void app.dispose().finally(() => process.exit(0));
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
