/**
 * Variant 2 — WORKER.md compiled onto a kind-level `defineFlow`.
 *
 * The worker author writes `src/worker-md/WORKER.md`. This file is the flow
 * author's half: a block catalog + `compileWorkerWakes`. Hire does not do
 * this merge today. Two workers with different wakes would need two kinds,
 * or a hire-time merge that does not exist.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineFlow } from "@flow-state-dev/core";
import {
  inspectWakes,
  recordInboundIssue,
  sweepOpenTickets,
  WORKER_WAKE_BLOCKS,
} from "../handlers";
import { compileWorkerWakes } from "./compile";

const workerMd = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "WORKER.md"),
  "utf8",
);

export const compiledWorkerWakes = compileWorkerWakes(workerMd, WORKER_WAKE_BLOCKS);

const inspect = inspectWakes("worker-md");

export const inboxWatchWorkerMd = defineFlow({
  kind: "inbox-watch-worker",
  requireUser: false,
  authentication: { defaultUserId: "system", requireUser: false },
  actions: {
    inspect: { block: inspect },
    sweep: { block: sweepOpenTickets },
    record: { block: recordInboundIssue },
  },
  schedules: compiledWorkerWakes.schedules,
  webhooks: compiledWorkerWakes.webhooks,
});

export default inboxWatchWorkerMd();
