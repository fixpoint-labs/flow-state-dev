/**
 * A failed turn's reason is read by a person — in an app's error line, the
 * devtool, a lab's recovery line — so it has to be plain text. Some throwers
 * (the AI SDK's AI Gateway "no key" error, CLI tools) bake terminal colour
 * codes into their messages; the engine strips them where it normalizes the
 * error, so no surface has to.
 */
import { DEFAULT_ORG_ID, defineFlow, FlowError, handler } from "@flow-state-dev/core";
import { errorDetailsWithCause } from "@flow-state-dev/core/internal";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { runAction } from "../src";
import { displayCause, normalizeError } from "../src/errors/normalize-error";
import { runActionInternal } from "../src/execution/runAction";
import { applyNormalizedErrorSeam } from "../src/execution/internal/seams";
import type { ExecutionMetadata } from "../src/execution/types";
import { createInMemoryStores } from "../src/host";

/** What a field-preserving `interceptNormalizedError` seam returns. */
const cloneError = (error: FlowError): FlowError =>
  new FlowError(error.message, {
    code: error.code,
    retryable: error.retryable,
    details: error.details,
    cause: error.cause,
    blockName: error.blockName,
    blockInstanceId: error.blockInstanceId,
    scope: error.scope
  });

// What the AI SDK throws for a gateway call with no key, through a pipe.
const COLOURED =
  "\u001b[1m\u001b[31mUnauthenticated request to AI Gateway.\u001b[0m Set AI_GATEWAY_API_KEY.";
const PLAIN = "Unauthenticated request to AI Gateway. Set AI_GATEWAY_API_KEY.";

describe("a failed turn's reason has no terminal colour codes", () => {
  it("normalizeError strips them from a plain thrown error", () => {
    expect(normalizeError(new Error(COLOURED)).message).toBe(PLAIN);
  });

  it("normalizeError strips them from a thrown FlowError, keeping its code", () => {
    const normalized = normalizeError(new FlowError(COLOURED, { code: "model_error", retryable: false }));
    expect(normalized.message).toBe(PLAIN);
    expect(normalized.code).toBe("model_error");
  });

  it("normalizeError strips them from an AI SDK error it classifies", () => {
    const apiError = Object.assign(new Error(COLOURED), { name: "AI_APICallError", statusCode: 503 });
    const normalized = normalizeError(apiError);
    expect(normalized.code).toBe("provider_unavailable_error");
    expect(normalized.message).toBe(PLAIN);
  });

  it("still unwraps the synthetic layer, so the raw coloured message isn't serialized as a cause", () => {
    // The original keeps its message on `cause` (that's the thrower's object);
    // displayCause must still see it as the same message, or the coloured text
    // comes back as `details.cause` under the clean reason.
    const inner = new Error("socket closed");
    const normalized = normalizeError(new Error(COLOURED, { cause: inner }));
    expect(displayCause(normalized)).toBe(inner);
  });

  it("keeps an author's own cause that differs from the message only by colour codes", () => {
    // Not a wrapper normalizeError built: the author chose this cause, and its
    // name and code are the diagnosis. Unwrapping it would lose them.
    const cause = Object.assign(new Error("\u001b[31mplain\u001b[0m"), { code: "ECONNRESET" });
    const normalized = normalizeError(new FlowError("plain", { cause }));
    expect(displayCause(normalized)).toBe(cause);
    const details = errorDetailsWithCause({ details: normalized.details, cause: displayCause(normalized) });
    expect(details?.cause).toMatchObject({ name: "Error", code: "ECONNRESET" });
  });

  it("keeps an author's own cause when the author's message is the coloured one", () => {
    // The thrown messages differ, so the cause was kept before stripping
    // existed; stripping the outer message must not make it look like a wrapper.
    const cause = Object.assign(new Error("plain"), { code: "ECONNRESET" });
    const normalized = normalizeError(new FlowError("\u001b[31mplain\u001b[0m", { cause }));
    expect(normalized.message).toBe("plain");
    expect(displayCause(normalized)).toBe(cause);
    // Normalizing again (as each layer of the engine does) keeps the decision.
    expect(displayCause(normalizeError(normalized))).toBe(cause);
    const details = errorDetailsWithCause({ details: normalized.details, cause: displayCause(normalized) });
    expect(details?.cause).toMatchObject({ name: "Error", code: "ECONNRESET" });
  });

  it("keeps that decision on a clone made by the normalized-error seam", () => {
    const cause = Object.assign(new Error("plain"), { code: "ECONNRESET" });
    const normalized = normalizeError(new FlowError("\u001b[31mplain\u001b[0m", { cause }));
    const cloned = applyNormalizedErrorSeam(
      { interceptNormalizedError: cloneError },
      normalized,
      {} as ExecutionMetadata
    );
    expect(cloned).not.toBe(normalized);
    expect(displayCause(cloned)).toBe(cause);
  });

  it("still unwraps a wrapper's clone, and keeps a wrapped error given later as a different message's cause", () => {
    const thrown = new Error(COLOURED, { cause: new Error("socket closed") });
    const wrapper = normalizeError(thrown);
    expect(displayCause(cloneError(wrapper))).toBe(thrown.cause);
    // The same error, now the cause of an author's error that says something else.
    const rethrown = normalizeError(new FlowError("Could not reach the model", { cause: thrown }));
    expect(displayCause(rethrown)).toBe(thrown);
  });

  it("keeps a cause first normalized as a raw throw, then given as an author's cause with the same text", () => {
    const thrown = Object.assign(new Error("\u001b[31mplain\u001b[0m"), { code: "ECONNRESET" });
    normalizeError(thrown);
    const authored = normalizeError(new FlowError("plain", { cause: thrown }));
    expect(displayCause(authored)).toBe(thrown);
  });

  it("shows an author's cause even when its message is exactly the author's", () => {
    // Only a wrapper normalizeError built is unwrapped; an author's cause is
    // always shown, which is more information, never less.
    const cause = Object.assign(new Error("plain"), { code: "ECONNRESET" });
    expect(displayCause(normalizeError(new FlowError("plain", { cause })))).toBe(cause);
  });

  it("keeps the author's cause on the terminal error item when the seam clones the error", async () => {
    const flow = defineFlow({
      kind: "coloured-author-failure",
      actions: {
        run: handler({
          name: "call-service",
          inputSchema: z.object({}),
          outputSchema: z.string(),
          execute: () => {
            throw new FlowError("\u001b[31mplain\u001b[0m", {
              cause: Object.assign(new Error("plain"), { code: "ECONNRESET" })
            });
          }
        })
      }
    })();

    const result = await runActionInternal({
      orgId: DEFAULT_ORG_ID,
      flow,
      actionName: "run",
      input: {},
      requestId: "req_author_cause",
      sessionId: "sess_author_cause",
      userId: "user_author_cause",
      stores: createInMemoryStores(),
      runtimeConfig: {},
      internalSeams: { interceptNormalizedError: cloneError }
    });

    const errorItem = result.items.find((item) => item.type === "error") as
      | { message?: string; details?: { cause?: unknown } }
      | undefined;
    expect(errorItem?.message).toBe("plain");
    expect(errorItem?.details?.cause).toMatchObject({ name: "Error", code: "ECONNRESET" });
  });

  it("reaches the turn's recorded error item and request result clean", async () => {
    const stores = createInMemoryStores();
    const flow = defineFlow({
      kind: "coloured-failure",
      actions: {
        run: handler({
          name: "call-model",
          inputSchema: z.object({}),
          outputSchema: z.string(),
          execute: () => {
            throw new Error(COLOURED);
          }
        })
      }
    })();

    const result = await runAction({
      orgId: DEFAULT_ORG_ID,
      flow,
      actionName: "run",
      input: {},
      requestId: "req_coloured",
      sessionId: "sess_coloured",
      userId: "user_coloured",
      stores,
      runtimeConfig: {}
    });

    expect(result.error?.message).toBe(PLAIN);
    const errorItems = result.items.filter((item) => item.type === "error");
    expect(errorItems.length).toBeGreaterThan(0);
    // A plain throw with no cause of its own still records no details: the
    // wrapper's marker is not something to show.
    expect((errorItems[0] as { details?: unknown }).details).toBeUndefined();
    // Nothing anywhere in what the turn recorded carries an escape code.
    // JSON.stringify writes ESC as the text `\u001b`, so search for that text.
    const ESCAPED_ESC = "\\u001b";
    expect(JSON.stringify(errorItems)).not.toContain(ESCAPED_ESC);
    expect(JSON.stringify(errorItems)).toContain(PLAIN);
    expect(JSON.stringify(await stores.request.get("req_coloured"))).not.toContain(ESCAPED_ESC);
  });
});
