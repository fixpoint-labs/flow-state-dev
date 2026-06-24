/**
 * Resume endpoint handler for durable action suspension resolution.
 */
import { Validator } from "@cfworker/json-schema";
import type { Schema } from "@cfworker/json-schema";
import type { ResumeAction, ResumeContext } from "@flow-state-dev/core/types";
import { RESUME_ACTION_STATUS } from "@flow-state-dev/core/types";
import type { FlowRegistry } from "../registry/flow-registry";
import type { StoreRegistry } from "../stores/types";
import type { InboundTransportHost } from "../transports/types";
import type { DurabilityProvider } from "../durability/types";
import { generateId } from "../utils/generate-id";
import {
  jsonResponse,
  parseJsonBody,
  getString,
  SSE_HEADERS
} from "./route-utils";
import type { ParsedFlowRoute } from "./parseFlowRoute";
import type { InternalRouteSeams, RequestContext } from "./http-handlers";

/** The resolution actions the resume endpoint accepts on the wire. */
const RESUME_ACTIONS: readonly ResumeAction[] = ["approve", "reject", "submit", "skip"];

/** Narrow an arbitrary string to a known resume action. */
function isResumeAction(value: string | undefined): value is ResumeAction {
  return value !== undefined && (RESUME_ACTIONS as readonly string[]).includes(value);
}

/**
 * Validate a resume `data` payload against the suspension's persisted JSON
 * Schema. Returns `null` when valid (or when there is no schema to check
 * against); otherwise a path-keyed error map (JSON-pointer field → message)
 * mirroring rjsf's `extraErrors` shape so a client can pin each error to its
 * field. Only `submit`/`approve` carry a payload — `skip`/`reject` skip this.
 */
function validateResumePayload(
  schema: Record<string, unknown> | undefined,
  data: unknown
): Record<string, string> | null {
  if (schema === undefined) return null;
  // Match the draft `zod-to-json-schema` emits (draft-07), and disable
  // short-circuiting so every failing field is reported, not just the first.
  const validator = new Validator(schema as Schema, "7", false);
  let result: ReturnType<Validator["validate"]>;
  try {
    result = validator.validate(data);
  } catch {
    // The validator throws on an unsupported instance (e.g. `undefined` when a
    // `submit` carries no `data`) or an unresolved `$ref`. Treat any such throw
    // as a validation failure, not a 500 — the payload did not satisfy the
    // schema. Keyed at the root since there is no per-field location.
    return { "": "Resume payload does not satisfy the suspension's resumeSchema" };
  }
  if (result.valid) return null;
  const errors: Record<string, string> = {};
  for (const unit of result.errors) {
    // `instanceLocation` is a JSON pointer ("" for the root, "/field" for a
    // property). Strip the leading slash for a bare field key; keep "" → "".
    const key = unit.instanceLocation.replace(/^\//, "");
    // Keep the first error per field — the most specific keyword failure.
    if (errors[key] === undefined) errors[key] = unit.error;
  }
  return errors;
}

type ResumeRouteContext = {
  host: InboundTransportHost;
  registry: FlowRegistry;
  stores: StoreRegistry;
  durabilityProvider?: DurabilityProvider;
  seams: InternalRouteSeams;
  requestContext: RequestContext;
};

export async function handleResumeSuspension(
  request: Request,
  route: Extract<ParsedFlowRoute, { kind: "resume_suspension" }>,
  ctx: ResumeRouteContext
): Promise<Response> {
  const flow = ctx.registry.get(route.flowKind);
  if (flow === undefined) {
    return jsonResponse(404, { error: `Unknown flow "${route.flowKind}"` });
  }

  const originalRequest = await ctx.stores.request.get(route.requestId);
  if (originalRequest === undefined) {
    return jsonResponse(404, { error: `Request "${route.requestId}" not found` });
  }

  // A webhook request is reachable only through a verified webhook, never this
  // public surface — resuming one would re-enter the handler with
  // caller-supplied gate data and no signature check. Reject like the
  // retry/continue routes (and before anything else can act on the record),
  // returning the same not-found shape as a missing record so webhook requests
  // are indistinguishable here.
  if (originalRequest.source === "webhook") {
    return jsonResponse(404, { error: `Request "${route.requestId}" not found` });
  }

  const provider = ctx.durabilityProvider;
  if (provider === undefined) {
    return jsonResponse(400, {
      error: "No DurabilityProvider configured. Resume requires durable execution."
    });
  }

  const body = await parseJsonBody(request);
  const suspensionId = getString(body.suspensionId);
  const action = getString(body.action);
  const resumeData = body.data;
  const resumedBy = getString(body.resumedBy);

  if (suspensionId === undefined) {
    return jsonResponse(400, { error: "Missing required field: suspensionId" });
  }

  if (!isResumeAction(action)) {
    return jsonResponse(400, {
      error: `Field "action" must be one of ${RESUME_ACTIONS.join(", ")}`
    });
  }

  if (originalRequest.status !== "suspended") {
    return jsonResponse(409, {
      error: `Request is "${originalRequest.status}", not "suspended"`
    });
  }

  const suspension = await provider.loadSuspension(route.requestId, suspensionId);
  if (suspension === null) {
    return jsonResponse(404, {
      error: `Suspension "${suspensionId}" not found`
    });
  }
  if (suspension.status !== "pending") {
    return jsonResponse(409, {
      error: `Suspension "${suspensionId}" has already been resolved (status: "${suspension.status}")`
    });
  }

  // The action must be in the suspension's permitted set. This is the
  // suspension's contract (not a malformed request), so an out-of-set action is
  // a 409. Records persisted before `allow` existed are treated as binary.
  const allowed = suspension.allow ?? ["approve", "reject"];
  if (!allowed.includes(action)) {
    return jsonResponse(409, {
      error: `Action "${action}" not permitted for this suspension (allowed: ${allowed.join(", ")})`
    });
  }

  // Validate the submitted payload against the persisted resumeSchema before any
  // state transition, so an invalid submission is a clean 400 and the suspension
  // stays pending. `skip`/`reject` carry no payload.
  if (action === "submit" || action === "approve") {
    const validationErrors = validateResumePayload(suspension.resumeSchema, resumeData);
    if (validationErrors !== null) {
      return jsonResponse(400, {
        error: "Resume payload failed validation against the suspension's resumeSchema",
        validationErrors
      });
    }
  }

  // Enforce expiry at the endpoint, not just in the sweeper. The sweeper flips
  // pending -> expired only every sweepIntervalMs (and only when retention is
  // configured), so without this check an expired gate stays approvable between
  // ticks — or forever if retention is off. Mark it expired now and reject.
  if (suspension.expiresAt != null && suspension.expiresAt <= Date.now()) {
    await provider.suspend({
      ...suspension,
      status: "expired",
      resolvedAt: Date.now()
    });
    return jsonResponse(410, {
      error: `Suspension "${suspensionId}" expired at ${suspension.expiresAt}`
    });
  }

  const lease = await provider.acquireLease(route.requestId, {
    holder: generateId("resume"),
    durationMs: 60_000
  });

  if (lease === null) {
    return jsonResponse(409, {
      error: "Concurrent resume in progress. Try again later."
    });
  }

  const resumeContext: ResumeContext = {
    suspensionId,
    action,
    data: resumeData,
    resumedBy
  };

  try {
    const now = Date.now();
    await provider.suspend({
      ...suspension,
      status: RESUME_ACTION_STATUS[action],
      resolvedAt: now,
      resolvedBy: resumedBy,
      resumeData
    });

    // Same-request continuation (FIX-811): re-enter the ORIGINAL request id. No
    // second request is created. `continueRequest` rejects synchronously (well,
    // its returned promise) for a missing record / unknown flow — but those are
    // already guarded above (404 paths), so a rejection here is a genuine
    // setup failure handled by the catch below.
    const handle = await ctx.host.continueRequest({
      requestId: route.requestId,
      resumeContext
    });

    const accept = request.headers.get("accept") ?? "";
    if (accept.includes("text/event-stream") && handle.liveStream !== null) {
      return new Response(handle.liveStream.readable, {
        status: 200,
        headers: {
          ...SSE_HEADERS,
          "cache-control": "no-cache, no-transform",
          "x-accel-buffering": "no",
          "x-request-id": handle.requestId
        }
      });
    }

    return jsonResponse(202, {
      requestId: route.requestId
    });
  } catch (error) {
    // Setup failed before the point-of-no-return (continueRequest threw, or the
    // status transition never happened). Revert the suspension to pending so the
    // operator can retry, and release the lease. Once runAction crosses into
    // `in_progress` a failure is a durable terminal `failed` and does not reach
    // here (continueRequest's `finished` carries it, not awaited above).
    await provider.suspend({ ...suspension, status: "pending" }).catch(() => {});
    await provider.releaseLease(route.requestId, lease.leaseId);
    throw error;
  }
}
