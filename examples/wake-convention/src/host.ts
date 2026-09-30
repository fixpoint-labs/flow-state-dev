/**
 * Proposed host. Not wired. Not a shipped API.
 *
 * Today the host names adapters in code and each flow owns
 * `schedules.static` / `webhooks[provider].on`. #2372 names that
 * registration once, then still compiles route rules onto a flow.
 *
 * This sketch inverts the ownership:
 *   1. Walk `transports/` — each folder registers a transport + its events.
 *   2. Walk `workers/` and `channels/` — each folder that wants a wake
 *      references a catalog id, or writes a seat-local clock.
 *   3. Delivery stays `host.dispatch` / `dispatcher(...)`.
 *
 * Cron POST addresses the seat folder, not
 * `/api/flows/:kind/schedules/:scheduleId`.
 *
 * `webhooks.ts` in a seat folder is the rejected spelling: hire must not
 * runtime-import seat files (FIX-1342). `hooks.yaml` is data.
 */

export const proposedHost = {
  registerTransportsFrom: "transports/",
  readWakesFrom: ["workers/*", "channels/*"],
  dispatchDoor: "host.dispatch — unchanged",
  hop: "dispatcher({ flowKind, action, session: { key } })",
  sessionIdFence: "FIX-1634 — pointer only; { id } on BullMQ stays Hard gates",
  rejectedSeatModule: "webhooks.ts imported as config",
  preferredSeatFiles: ["WORKER.md wake:", "schedule.yaml", "hooks.yaml"],
} as const;
