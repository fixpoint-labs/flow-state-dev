/**
 * Bull Board admin dashboard wired to the BullMQ worker adapter's queue.
 *
 * Only activates when the `bullmq` adapter is available (REDIS_URL set).
 * Mounted at /api/admin/queues via Next.js catch-all route.
 */
import express from "express";
import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { ExpressAdapter } from "@bull-board/express";
import { bullmq } from "./flowstate";

const BASE_PATH = "/api/admin/queues";

const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath(BASE_PATH);

if (bullmq) {
  createBullBoard({
    queues: [new BullMQAdapter(bullmq.queue)],
    serverAdapter,
  });
}

const app = express();
app.use(BASE_PATH, serverAdapter.getRouter());

export { app as bullBoardApp };
export { BASE_PATH };
