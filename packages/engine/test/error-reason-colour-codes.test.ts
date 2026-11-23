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
import { createInMemoryStores } from "../src/host";

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
    // Nothing anywhere in what the turn recorded carries an escape code.
    // JSON.stringify writes ESC as the text `\u001b`, so search for that text.
    const ESCAPED_ESC = "\\u001b";
    expect(JSON.stringify(errorItems)).not.toContain(ESCAPED_ESC);
    expect(JSON.stringify(errorItems)).toContain(PLAIN);
    expect(JSON.stringify(await stores.request.get("req_coloured"))).not.toContain(ESCAPED_ESC);
  });
});
