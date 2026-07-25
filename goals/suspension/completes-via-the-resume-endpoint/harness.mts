/**
 * Real-path driver for the HTTP resume-endpoint goal check. Run via `tsx -e`
 * from `apps/kitchen-sink` (by run.mts) so `flowstate.getRouter()` resolves both
 * the app's `@/*` aliases and `@flow-state-dev/*` — only a file executed with
 * that app as cwd resolves both, and `goals/` is not that app.
 *
 * Drives the flow router exactly as the DevTool / client does, then reports raw
 * observations on a single `__GOAL__<json>` line; run.mts owns the grading.
 * Requires `FSDEV_DEBUG_ENDPOINTS=1` for the suspensions debug route.
 *
 * Not typechecked by `goals/tsconfig.json` — its imports resolve against
 * apps/kitchen-sink. See goals/README.md → "Harnesses".
 */
import { flowstate } from "./lib/flowstate";

const FLOW = "chat-agent";
const userId = "goal-http-user";
const sessionId = "goal_http_" + Date.now();
const request = process.env.KS_GOAL_REQUEST;
const note = process.env.KS_GOAL_NOTE;
const out = (r: unknown) => console.log("__GOAL__" + JSON.stringify(r));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  const router = await flowstate.getRouter();

  async function call(
    method: "GET" | "POST",
    segs: string[],
    body?: unknown,
    accept = "application/json",
  ): Promise<{ status: number; body: any; text: string }> {
    const req = new Request("http://local/api/flows/" + segs.join("/"), {
      method,
      headers: { "content-type": "application/json", accept },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const res = await router[method](req, { params: { path: segs } });
    const text = await res.text();
    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      json = text;
    }
    return { status: res.status, body: json, text };
  }

  async function pollStatus(requestId: string, want: string, tries: number) {
    let snap: any = null;
    for (let i = 0; i < tries; i++) {
      const r = await call("GET", [FLOW, "requests", requestId, "status"]);
      snap = r.body;
      const st = r.body?.status ?? r.body?.request?.status;
      if (st === want || st === "failed" || st === "completed") return { status: st, snap };
      await sleep(100);
    }
    return { status: snap?.status ?? "unknown", snap };
  }

  const report: Record<string, unknown> = {};

  const dispatch = await call("POST", [FLOW, sessionId, "actions", "requestApproval"], {
    input: { request },
    userId,
  });
  const requestId = dispatch.body?.request?.id ?? dispatch.body?.requestId;
  report.dispatchStatus = dispatch.status;
  report.requestId = requestId;

  report.suspended = (await pollStatus(requestId, "suspended", 50)).status === "suspended";

  const susList = await call("GET", ["sessions", sessionId, "debug", "suspensions"]);
  const pending = Array.isArray(susList.body) ? susList.body : (susList.body?.suspensions ?? []);
  const suspensionId = pending[0]?.suspensionId;
  report.pendingBeforeResume = pending.length;

  const resume = await call("POST", [FLOW, "requests", requestId, "resume"], {
    suspensionId,
    action: "approve",
    data: { note },
    resumedBy: userId,
  });
  report.resumeStatus = resume.status;

  report.completed = (await pollStatus(requestId, "completed", 100)).status === "completed";

  // The reconnect a client issues after a resume: replay the request stream.
  const stream = await call("GET", [FLOW, "requests", requestId, "stream"], undefined, "text/event-stream");
  report.streamStatus = stream.status;
  report.streamText = stream.text ?? "";

  // What a reload fetches.
  const reqList = await call("GET", ["sessions", sessionId, "requests"]);
  const reqs = Array.isArray(reqList.body) ? reqList.body : (reqList.body?.requests ?? []);
  report.reloadRequestStatus =
    reqs.find((r: { id: string }) => r.id === requestId)?.status ?? "missing";
  const susAfter = await call("GET", ["sessions", sessionId, "debug", "suspensions"]);
  const after = Array.isArray(susAfter.body) ? susAfter.body : (susAfter.body?.suspensions ?? []);
  report.pendingAfterResume = after.length;

  report.ok = true;
  out(report);
}

main()
  .catch((err) =>
    out({
      ok: false,
      reason: "driver threw: " + (err instanceof Error ? (err.stack ?? err.message) : String(err)),
    }),
  )
  .finally(async () => {
    if (typeof flowstate.dispose === "function") await flowstate.dispose().catch(() => {});
    process.exit(0);
  });
