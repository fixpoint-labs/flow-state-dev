/**
 * A failed turn's reason is read by a person — in an app's error line, the
 * devtool, a lab's recovery line — so it has to be plain text. Some throwers
 * (the AI SDK's AI Gateway "no key" error, CLI tools) bake terminal colour
 * codes into their messages; the engine strips them where it normalizes the
 * error, so no surface has to.
 */
import { DEFAULT_ORG_ID, defineFlow, FlowError, handler, sequencer } from "@flow-state-dev/core";
import { errorDetailsWithCause } from "@flow-state-dev/core/internal";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { runAction } from "../src";
import { displayCause, normalizeError } from "../src/errors/normalize-error";
import { runActionInternal } from "../src/execution/runAction";
import { applyNormalizedErrorSeam } from "../src/execution/internal/seams";
import type { ExecutionMetadata } from "../src/execution/types";
import { createInMemoryStores, createResponseEmitter } from "../src/host";

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

  it("still unwraps a wrapper's seam clone, and keeps a wrapped error given later as a different message's cause", () => {
    const thrown = new Error(COLOURED, { cause: new Error("socket closed") });
    const wrapper = normalizeError(thrown);
    expect(displayCause(wrapper)).toBe(thrown.cause);
    const seamClone = applyNormalizedErrorSeam(
      { interceptNormalizedError: cloneError },
      wrapper,
      {} as ExecutionMetadata
    );
    expect(seamClone).not.toBe(wrapper);
    expect(displayCause(seamClone)).toBe(thrown.cause);
    // A rebuild outside the seam drops the marker and reads as an author's
    // error: its cause is shown, which fails safe (more information).
    expect(displayCause(cloneError(wrapper))).toBe(thrown);
    // The same error, now the cause of an author's error that says something else.
    const rethrown = normalizeError(new FlowError("Could not reach the model", { cause: thrown }));
    expect(displayCause(rethrown)).toBe(thrown);
  });

  it("treats a seam rebuild with a new message as an author's error, and keeps unwrapping an unchanged one", () => {
    const thrown = Object.assign(new Error("raw"), { code: "ECONNRESET" });
    const wrapper = normalizeError(thrown);
    const friendly = applyNormalizedErrorSeam(
      { interceptNormalizedError: (error) => new FlowError("friendly", { cause: error.cause }) },
      wrapper,
      {} as ExecutionMetadata
    );
    expect(displayCause(friendly)).toBe(thrown);
    const unchanged = applyNormalizedErrorSeam(
      { interceptNormalizedError: (error) => new FlowError(error.message, { cause: error.cause }) },
      wrapper,
      {} as ExecutionMetadata
    );
    expect(displayCause(unchanged)).toBeUndefined();
  });

  it("shows the raw cause when the seam changes the wrapper's message in place", async () => {
    const thrown = Object.assign(new Error("raw"), { code: "ECONNRESET" });
    // Unmutated, the engine's wrapper still unwraps.
    expect(displayCause(normalizeError(thrown))).toBeUndefined();
    // Mutated and returned, or mutated with nothing returned.
    for (const returns of [true, false]) {
      const wrapper = normalizeError(thrown);
      const out = applyNormalizedErrorSeam(
        {
          interceptNormalizedError: (error) => {
            error.message = "friendly";
            return returns ? error : undefined;
          }
        },
        wrapper,
        {} as ExecutionMetadata
      );
      expect(out).toBe(wrapper);
      expect(displayCause(out)).toBe(thrown);
    }

    const flow = defineFlow({
      kind: "mutated-item",
      actions: {
        run: handler({
          name: "fails",
          inputSchema: z.object({}),
          outputSchema: z.string(),
          execute: () => {
            throw Object.assign(new Error("raw"), { code: "ECONNRESET" });
          }
        })
      }
    })();
    const result = await runActionInternal({
      orgId: DEFAULT_ORG_ID,
      flow,
      actionName: "run",
      input: {},
      requestId: "req_mutated_item",
      sessionId: "sess_mutated_item",
      userId: "user_mutated_item",
      stores: createInMemoryStores(),
      runtimeConfig: {},
      internalSeams: {
        interceptNormalizedError: (error) => {
          error.message = "friendly";
        }
      }
    });
    const errorItem = result.items.find((item) => item.type === "error") as
      | { message?: string; details?: { cause?: unknown } }
      | undefined;
    expect(errorItem?.message).toBe("friendly");
    expect(errorItem?.details?.cause).toMatchObject({ name: "Error", code: "ECONNRESET", message: "raw" });
  });

  it("shows the cause as the seam left it when the seam changes or replaces the cause and keeps the message", async () => {
    // A seam that narrows the wrapped cause and adds a diagnosis has said
    // something the raw throw did not; unwrapping past it would drop that.
    const narrow = (error: FlowError) => {
      const cause = error.cause as Error & { code?: string };
      cause.message = "socket closed by the provider";
      cause.code = "E_PROVIDER_RESET";
    };
    const raw = () => new Error("raw", { cause: new Error("socket closed") });

    // Changed in place: returned as is, returned as a clone, or nothing returned.
    for (const seam of [
      (error: FlowError) => (narrow(error), error),
      (error: FlowError) => (narrow(error), cloneError(error)),
      (error: FlowError) => void narrow(error)
    ]) {
      const thrown = raw();
      const out = applyNormalizedErrorSeam({ interceptNormalizedError: seam }, normalizeError(thrown), {} as ExecutionMetadata);
      expect(out.message).toBe("raw");
      expect(displayCause(out)).toBe(thrown);
    }

    // Normalizing again, as each engine layer does, keeps the seam's change shown.
    const thrown = raw();
    const narrowed = normalizeError(thrown);
    narrow(narrowed);
    expect(displayCause(normalizeError(narrowed))).toBe(thrown);

    // Replaced in place with a different error.
    const replaced = normalizeError(raw());
    const replacement = Object.assign(new Error("raw"), { code: "E_PROVIDER_RESET" });
    (replaced as { cause?: unknown }).cause = replacement;
    expect(displayCause(replaced)).toBe(replacement);

    // End to end: the terminal error item carries the seam's cause.
    const flow = defineFlow({
      kind: "narrowed-cause-item",
      actions: {
        run: handler({
          name: "fails",
          inputSchema: z.object({}),
          outputSchema: z.string(),
          execute: () => {
            throw raw();
          }
        })
      }
    })();
    const result = await runActionInternal({
      orgId: DEFAULT_ORG_ID,
      flow,
      actionName: "run",
      input: {},
      requestId: "req_narrowed_cause",
      sessionId: "sess_narrowed_cause",
      userId: "user_narrowed_cause",
      stores: createInMemoryStores(),
      runtimeConfig: {},
      internalSeams: { interceptNormalizedError: (error) => void narrow(error) }
    });
    const errorItem = result.items.find((item) => item.type === "error") as
      | { message?: string; details?: { cause?: unknown } }
      | undefined;
    expect(errorItem?.message).toBe("raw");
    expect(errorItem?.details?.cause).toMatchObject({
      name: "Error",
      message: "socket closed by the provider",
      code: "E_PROVIDER_RESET",
      cause: { message: "socket closed" }
    });
  });

  it("keeps the raw cause's name, code and message when the seam rewrites the message", async () => {
    const friendlySeam = {
      interceptNormalizedError: (error: FlowError) => new FlowError("friendly", { cause: error.cause })
    };
    const raw = () => Object.assign(new Error("raw"), { code: "ECONNRESET" });
    const expected = { name: "Error", code: "ECONNRESET", message: "raw" };

    // The terminal error item.
    const itemFlow = defineFlow({
      kind: "friendly-item",
      actions: {
        run: handler({
          name: "fails",
          inputSchema: z.object({}),
          outputSchema: z.string(),
          execute: () => {
            throw raw();
          }
        })
      }
    })();
    const itemResult = await runActionInternal({
      orgId: DEFAULT_ORG_ID,
      flow: itemFlow,
      actionName: "run",
      input: {},
      requestId: "req_friendly_item",
      sessionId: "sess_friendly_item",
      userId: "user_friendly_item",
      stores: createInMemoryStores(),
      runtimeConfig: {},
      internalSeams: friendlySeam
    });
    const errorItem = itemResult.items.find((item) => item.type === "error") as
      | { message?: string; details?: { cause?: unknown } }
      | undefined;
    expect(errorItem?.message).toBe("friendly");
    expect(errorItem?.details?.cause).toMatchObject(expected);

    // The failed block_trace of a step, under the same seam. The seam does not
    // reach the block_trace path, so the trace carries the raw error's own
    // message, and (as on main) no details.cause for a plain throw.
    const failing = handler({
      name: "fails",
      inputSchema: z.object({}),
      outputSchema: z.object({}),
      execute: () => {
        throw raw();
      }
    });
    const traceFlow = defineFlow({
      kind: "friendly-trace",
      actions: { run: sequencer({ name: "seq", inputSchema: z.object({}) }).step(failing) }
    })();
    const response = createResponseEmitter({ requestId: "req_friendly_trace", now: () => Date.now() });
    await runActionInternal({
      orgId: DEFAULT_ORG_ID,
      flow: traceFlow,
      actionName: "run",
      input: {},
      requestId: "req_friendly_trace",
      sessionId: "sess_friendly_trace",
      userId: "user_friendly_trace",
      stores: createInMemoryStores(),
      responseEmitter: response,
      runtimeConfig: {},
      internalSeams: friendlySeam
    });
    const trace = response
      .getItems()
      .find((item) => item.type === "block_trace" && (item as { blockName?: string }).blockName === "fails") as
      | { error?: { message?: string; details?: { cause?: unknown } } }
      | undefined;
    expect(trace?.error?.message).toBe("raw");
    expect(trace?.error?.details?.cause).toBeUndefined();
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

  it("leaves a wrapper's details exactly as given, with no marker in them", () => {
    expect(normalizeError(new Error("boom")).details).toBeUndefined();
    const given = { attempt: 2 };
    const wrapper = normalizeError(new Error("boom"), { details: given });
    expect(wrapper.details).toBe(given);
    expect(Object.getOwnPropertySymbols(given)).toEqual([]);
  });

  it("hands public error hooks a plain throw's error with details undefined", async () => {
    const seen: Array<{ hook: string; details: unknown; symbols: symbol[] }> = [];
    const record = (hook: string) =>
      handler({
        name: `record-${hook}`,
        inputSchema: z.any(),
        outputSchema: z.any(),
        execute: (input: { error?: FlowError }) => {
          if (input?.error !== undefined) {
            seen.push({ hook, details: input.error.details, symbols: Object.getOwnPropertySymbols(input.error) });
          }
          return input;
        }
      });
    const flow = defineFlow({
      kind: "hook-details",
      actions: {
        run: {
          block: handler({
            name: "fails",
            inputSchema: z.object({}),
            outputSchema: z.string(),
            execute: () => {
              throw new Error("boom");
            }
          }),
          onErrored: record("action.onErrored")
        }
      },
      request: { onErrored: record("request.onErrored"), onFinished: record("request.onFinished") }
    })();
    const captured: Array<{ details: unknown; symbols: symbol[] }> = [];

    await runAction({
      orgId: DEFAULT_ORG_ID,
      flow,
      actionName: "run",
      input: {},
      requestId: "req_hook_details",
      sessionId: "sess_hook_details",
      userId: "user_hook_details",
      stores: createInMemoryStores(),
      runtimeConfig: {
        errorCapture: (event: { error: FlowError }) =>
          void captured.push({ details: event.error.details, symbols: Object.getOwnPropertySymbols(event.error) })
      }
    });

    // The hooks get the error exactly as on main: no details, nothing hidden on it.
    expect(seen.map((entry) => entry.hook)).toEqual(
      expect.arrayContaining(["action.onErrored", "request.onErrored", "request.onFinished"])
    );
    expect(captured.length).toBeGreaterThan(0);
    for (const entry of [...seen, ...captured]) {
      expect(entry.details).toBeUndefined();
      expect(entry.symbols).toEqual([]);
    }
  });

  it("emits no marker on the error item, with and without details of its own", async () => {
    const run = async (requestId: string, withDetails: boolean) => {
      const flow = defineFlow({
        kind: `marker-free-${requestId}`,
        actions: {
          run: handler({
            name: "fails",
            inputSchema: z.object({}),
            outputSchema: z.string(),
            execute: () => {
              throw new Error("boom");
            }
          })
        }
      })();
      const result = await runActionInternal({
        orgId: DEFAULT_ORG_ID,
        flow,
        actionName: "run",
        input: {},
        requestId,
        sessionId: `sess_${requestId}`,
        userId: `user_${requestId}`,
        stores: createInMemoryStores(),
        runtimeConfig: {},
        // A seam that adds details to the engine's wrapper keeps the marked object.
        internalSeams: withDetails
          ? {
              interceptNormalizedError: (error) =>
                new FlowError(error.message, { code: error.code, cause: error.cause, details: { attempt: 2 } })
            }
          : undefined
      });
      return result.items.find((item) => item.type === "error") as { details?: Record<string, unknown> };
    };

    const plain = await run("req_marker_plain", false);
    expect(plain.details).toBeUndefined();
    const detailed = await run("req_marker_detailed", true);
    expect(detailed.details).toEqual({ attempt: 2 });
    expect(Object.getOwnPropertySymbols(detailed.details!)).toEqual([]);
  });

  it("emits no marker on a failed block_trace, with and without details of its own", async () => {
    const traceOf = async (requestId: string, thrown: () => Error) => {
      const failing = handler({
        name: "fails",
        inputSchema: z.object({}),
        outputSchema: z.object({}),
        execute: () => {
          throw thrown();
        }
      });
      const flow = defineFlow({
        kind: `trace-marker-${requestId}`,
        actions: { run: sequencer({ name: "seq", inputSchema: z.object({}) }).step(failing) }
      })();
      const response = createResponseEmitter({ requestId, now: () => Date.now() });
      await runAction({
        orgId: DEFAULT_ORG_ID,
        flow,
        actionName: "run",
        input: {},
        requestId,
        sessionId: `sess_${requestId}`,
        userId: `user_${requestId}`,
        stores: createInMemoryStores(),
        responseEmitter: response,
        runtimeConfig: {}
      });
      const trace = response
        .getItems()
        .find((item) => item.type === "block_trace" && (item as { blockName?: string }).blockName === "fails") as
        | { status?: string; error?: { details?: Record<string, unknown> } }
        | undefined;
      expect(trace?.status).toBe("failed");
      return trace!.error?.details;
    };

    // A plain throw: the engine's wrapper, whose details hold only the marker.
    expect(await traceOf("req_trace_plain", () => new Error("boom"))).toBeUndefined();
    // An error with details of its own and a cause, so details are emitted.
    const detailed = await traceOf(
      "req_trace_detailed",
      () => new FlowError("boom", { details: { attempt: 2 }, cause: new Error("socket closed") })
    );
    expect(detailed).toMatchObject({ attempt: 2 });
    expect(Object.getOwnPropertySymbols(detailed!)).toEqual([]);
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
