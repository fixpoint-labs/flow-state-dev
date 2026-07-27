/**
 * Goal check — suspension completes via the HTTP resume endpoint.
 *
 * Real path, no mocking, out of CI. See goal.md for the contract.
 *
 * Drives kitchen-sink's flow router (flowstate.getRouter()) exactly as the
 * DevTool / client does:
 *   POST .../actions/requestApproval     → dispatch (then poll status: suspended)
 *   GET  /sessions/:id/debug/suspensions → the Suspensions tab's source (pending)
 *   POST .../requests/:id/resume         → non-stream 202 (recoveryClient's call)
 *   poll status                          → completed (background continuation)
 *   GET  .../requests/:id/stream         → the reconnect a client issues after a
 *                                          resume; its replay must carry the
 *                                          resumed items (held-out request + note)
 *   GET  /sessions/:id/requests + debug/suspensions → what a reload fetches
 *
 * Grades the re-fetched stream replay CONTENT against the held-out fixture — the
 * exact bytes a reconnecting DevTool receives — not the 202 or the status flag
 * (see goal.md Anti-game). requestApproval has no LLM, so no model credential.
 *
 * The router needs both the kitchen-sink `@/*` aliases and `@flow-state-dev/*`,
 * which only resolve for a file run with that app as cwd — that is `harness.mts`;
 * this file owns the grading.
 *
 * Run: pnpm tsx goals/suspension/completes-via-the-resume-endpoint/run.mts
 */
import { KITCHEN_SINK, loadFixture, runGoal, runHarness } from "../../lib/index.mts";

const fixture = loadFixture<{ request: string; note: string }>(import.meta.url, "approval.json");

interface Observation {
  ok: boolean;
  reason?: string;
  suspended?: boolean;
  pendingBeforeResume?: number;
  resumeStatus?: number;
  completed?: boolean;
  streamText?: string;
  reloadRequestStatus?: string;
  pendingAfterResume?: number;
}

await runGoal(() => {
  const r = runHarness<Observation>({
    app: KITCHEN_SINK,
    harness: new URL("./harness.mts", import.meta.url),
    env: {
      FSD_ENV: "dev",
      FSDEV_DEBUG_ENDPOINTS: "1",
      KS_GOAL_REQUEST: fixture.request,
      KS_GOAL_NOTE: fixture.note,
    },
    // The app's own runtime resolves the models it declares; keep its ladder.
    keepIntents: true,
  });

  if (r.ok !== true) return { failures: [r.reason ?? "driver reported failure"], evidence: "" };

  const stream = String(r.streamText ?? "");
  const failures: string[] = [];
  if (r.suspended !== true) failures.push("dispatch did not reach suspended");
  if ((r.pendingBeforeResume ?? 0) < 1) failures.push("no pending suspension was listed before resume");
  if (r.resumeStatus !== 202) failures.push(`resume endpoint returned ${r.resumeStatus}, expected 202`);
  if (r.completed !== true) failures.push("request did not reach completed after the resume endpoint call");

  // Anti-game: the bytes a reconnecting client receives must carry the resumed result.
  if (!stream.toLowerCase().includes(fixture.request.toLowerCase())) {
    failures.push(`re-fetched stream replay missing the request "${fixture.request}"`);
  }
  if (!stream.toLowerCase().includes(fixture.note.toLowerCase())) {
    failures.push(
      `re-fetched stream replay missing the approver note "${fixture.note}" — resumed items not in the reconnect replay (the DevTool would show a stale view)`,
    );
  }
  if (!stream.includes("request.completed")) {
    failures.push("re-fetched stream replay has no request.completed event");
  }
  if (r.reloadRequestStatus !== "completed") {
    failures.push(`reload shows request status "${r.reloadRequestStatus}", expected completed`);
  }
  if (r.pendingAfterResume !== 0) {
    failures.push(`reload still lists ${r.pendingAfterResume} pending suspension(s), expected 0`);
  }
  if (failures.length > 0) failures.push(`stream sample: ${stream.slice(0, 400)}`);

  return {
    failures,
    evidence:
      `resume endpoint completed the request (202 → completed), and a re-fetched stream replay ` +
      `carried the resumed result (held-out request + note) with a request.completed event; reload shows ` +
      `completed and 0 pending suspensions. This is the exact path a reconnecting DevTool client follows.`,
  };
});
