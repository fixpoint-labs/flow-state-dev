/**
 * The answer route (FIX-2129, D2): how a screen answers a suspension that waits
 * for a user, whatever started the run that asked, a task's run included.
 *
 *   POST /api/flows/:flowKind/requests/:requestId/answer
 *   { "suspensionId": "...", "action": "approve" | "reject" | "submit", "data"?: ... }
 *
 * It takes only where the stop is (its request and id, the pair every store
 * keys a suspension by) and the answer. Before it loads the suspension it runs
 * the public resume path's ownership checks on the stop's request (`ownsRecord`:
 * the flow instance; `callerReachesRequest`: user, tenant, organization), so a
 * caller with the stop's user id in another tenant or organization is told the
 * stop doesn't exist, as is a caller who names a stop that is not a user's.
 * Nothing it trusts comes from the caller but the answer, which is checked
 * against the stop's own permitted actions and schema; who answered is the
 * signed-in caller, set here.
 *
 * Unlike the resume route, it never re-enters a request with caller gate data
 * beyond that answer, so it is open to every source the resume route refuses
 * (`task` among them, FIX-999). The answer resolves the stop through its single
 * pending state, under its request's lease, so an answer and a cancel, a
 * deadline or a stop resume it once: the one that loses is told
 * `already-resolved` (409).
 */
import type { FlowRegistry } from "../registry/flow-registry";
import { ownsRecord } from "../context/record-owner";
import type { StoreRegistry } from "../stores/types";
import type { InboundTransportHost, ResolvedPrincipal } from "../transports/types";
import type { DurabilityProvider } from "../durability/types";
import { isUserSuspension, isWaitGate, type SuspensionRecord } from "@flow-state-dev/core/types";
import { expireUnderLease, latestGateIdOf, resumeUnderLease } from "../durability/resume-under-lease";
import { loggedUserStop, PARKED } from "../durability/stop-suspended";
import { callerReachesRequest, getString, jsonResponse, parseJsonBody, SSE_HEADERS } from "./route-utils";
import { isResumeAction, RESUME_ACTIONS, validateResumePayload } from "./resume-routes";
import type { ParsedFlowRoute } from "./parseFlowRoute";

type AnswerRouteContext = {
  host: InboundTransportHost;
  registry: FlowRegistry;
  stores: StoreRegistry;
  durabilityProvider?: DurabilityProvider;
  /** Caller's tenant (FIX-682), extracted as every other request route does. */
  tenantId?: string;
  /** The authenticated caller, when route-level authentication is active. */
  principal?: ResolvedPrincipal;
};

/**
 * How long an answer that finds the stop's request held by another resume (a
 * cancel writing its task, a stop) waits for it before saying so: long enough
 * for that resume to resolve the stop, so the answer is told the outcome.
 */
const BUSY_WAIT_MS = 2_000;
const BUSY_POLL_MS = 50;

/** The answer to a stop that isn't the caller's to answer, or isn't there: the same, so neither is disclosed. */
const unknownStop = (suspensionId: string): Response =>
  jsonResponse(404, { error: `Suspension "${suspensionId}" not found` });

const alreadyResolved = (suspensionId: string, status: string): Response =>
  jsonResponse(409, {
    error: `Suspension "${suspensionId}" has already been resolved (status: "${status}")`,
    refused: "already-resolved"
  });

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function handleAnswerSuspension(
  request: Request,
  route: Extract<ParsedFlowRoute, { kind: "answer_suspension" }>,
  ctx: AnswerRouteContext
): Promise<Response> {
  const body = await parseJsonBody(request);
  const suspensionId = getString(body.suspensionId);
  const action = getString(body.action);
  const data = body.data;
  if (suspensionId === undefined) return jsonResponse(400, { error: "Missing required field: suspensionId" });
  if (action === undefined) return jsonResponse(400, { error: "Missing required field: action" });
  if (!isResumeAction(action)) {
    return jsonResponse(400, { error: `Field "action" must be one of ${RESUME_ACTIONS.join(", ")}` });
  }

  // The stop's request first, through the resume path's own checks, before
  // the stop is loaded: a request that isn't this caller's answers as a stop
  // that doesn't exist. A stored stop carries no tenant or org; its request does.
  const flow = ctx.registry.get(route.flowKind);
  const owner = await ctx.stores.request.get(route.requestId);
  if (
    flow === undefined ||
    owner === undefined ||
    !ownsRecord(flow, owner) ||
    !callerReachesRequest(owner, ctx.tenantId, ctx.principal)
  ) {
    return unknownStop(suspensionId);
  }

  const provider = ctx.durabilityProvider;
  if (provider === undefined) {
    return jsonResponse(400, { error: "No DurabilityProvider configured. Answering requires durable execution." });
  }

  const suspension = await provider.loadSuspension(route.requestId, suspensionId);
  // A stop whose request finished has had its record cleaned up; its log still
  // names it, so it was this request's, and it is resolved.
  if (suspension === null && loggedUserStop(owner, suspensionId)) return alreadyResolved(suspensionId, owner.status);
  // Only a user's stop is answered here; a wait gate's answer is its task's ending.
  if (suspension === null || isWaitGate(suspension) || !isUserSuspension(suspension)) return unknownStop(suspensionId);
  if (suspension.status !== "pending") return alreadyResolved(suspensionId, suspension.status);

  // Its deadline is enforced here too, as the resume route enforces it.
  if (suspension.expiresAt != null && suspension.expiresAt <= Date.now()) {
    await expireUnderLease(provider, suspension);
    return jsonResponse(410, { error: `Suspension "${suspensionId}" expired at ${suspension.expiresAt}` });
  }
  const allowed = suspension.allow ?? ["approve", "reject"];
  if (!allowed.includes(action)) {
    return jsonResponse(409, {
      error: `Action "${action}" not permitted for this suspension (allowed: ${allowed.join(", ")})`
    });
  }
  if (action === "submit" || (action === "approve" && data !== undefined)) {
    const validationErrors = validateResumePayload(suspension.resumeSchema, data);
    if (validationErrors !== null) {
      return jsonResponse(400, {
        error: "Answer failed validation against the suspension's resumeSchema",
        validationErrors
      });
    }
  }

  // Who answered is the signed-in caller, never a field of the body.
  const resumedBy = ctx.principal?.userId ?? owner.userId;
  const deps = { provider, continueRequest: (options: Parameters<InboundTransportHost["continueRequest"]>[0]) => ctx.host.continueRequest(options) };
  type Refusal = { status: string; expiredAt?: number };
  for (const deadline = Date.now() + BUSY_WAIT_MS; ; ) {
    const resumed = await resumeUnderLease<Refusal>(deps, {
      requestId: route.requestId,
      holder: "answer",
      // Re-read under the lease: a cancel, a deadline or a stop that resolved
      // it first wins, and this answer is told so. So does a deadline that
      // passed while the answer waited out another resume.
      admit: async () => {
        const current = await provider.loadSuspension(route.requestId, suspensionId);
        if (current === null || current.status !== "pending") return { refusal: { status: current?.status ?? "gone" } };
        if (current.expiresAt != null && current.expiresAt <= Date.now()) return { refusal: { status: "expired", expiredAt: current.expiresAt } };
        const parked = await parkedOn(ctx.stores, current);
        if (parked !== true) return { refusal: { status: parked } };
        return { suspension: current };
      },
      action,
      data,
      resumedBy
    });
    if (resumed.ok) {
      const handle = resumed.handle;
      const accept = request.headers.get("accept") ?? "";
      if (accept.includes("text/event-stream") && handle.liveStream !== null) {
        return new Response(handle.liveStream.readable, {
          status: 200,
          headers: { ...SSE_HEADERS, "cache-control": "no-cache, no-transform", "x-accel-buffering": "no", "x-request-id": handle.requestId }
        });
      }
      return jsonResponse(202, { requestId: route.requestId });
    }
    if ("refusal" in resumed) {
      if (resumed.refusal.status === "busy" && Date.now() < deadline) {
        await sleep(BUSY_POLL_MS);
        continue;
      }
      if (resumed.refusal.status === "busy") break;
      if (resumed.refusal.expiredAt !== undefined) {
        await expireUnderLease(provider, suspension);
        return jsonResponse(410, { error: `Suspension "${suspensionId}" expired at ${resumed.refusal.expiredAt}` });
      }
      return alreadyResolved(suspensionId, resumed.refusal.status);
    }
    // Another resume holds the request: wait for it, then answer with what it did.
    if (Date.now() >= deadline) break;
    await sleep(BUSY_POLL_MS);
  }
  return jsonResponse(409, { error: "Another resume of this request is in progress. Try again shortly.", refused: "busy" });
}

/**
 * Whether the stop's request is parked on it, so the answer can be replayed
 * onto it. `busy` while it is still parking (or was interrupted before its log
 * held the stop); its status otherwise.
 */
async function parkedOn(stores: StoreRegistry, gate: SuspensionRecord): Promise<true | string> {
  const record = await stores.request.get(gate.requestId);
  if (record?.status === "in_progress") return "busy";
  if (record?.status === "interrupted" && latestGateIdOf(record) !== gate.suspensionId) return "busy";
  if (record === undefined || !PARKED.includes(record.status)) return record?.status ?? "gone";
  return true;
}
