/**
 * OpenRouter Decisions client: payload shape, auth header, error mapping.
 */
import { describe, expect, it } from "vitest";
import { createOpenRouterDecisionsClient } from "../src/client";
import { TypeSafeError } from "../src/errors";
import { OPENROUTER_DECISIONS_URL } from "../src/schemas";
import { BILLING_RESULT } from "./scripted-client";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("createOpenRouterDecisionsClient", () => {
  it("POSTs model + state + questions to the Decisions URL with a Bearer key", async () => {
    const seen: Array<{ url: string; init: RequestInit }> = [];
    const client = createOpenRouterDecisionsClient({
      apiKey: "or-test-key",
      fetch: async (url, init) => {
        seen.push({ url: String(url), init: init ?? {} });
        return jsonResponse(200, BILLING_RESULT);
      },
    });

    const out = await client.evaluate({
      state: "Help ASAP",
      questions: { urgent: { type: "noul", instructions: "Urgent?" } },
    });

    expect(out).toEqual(BILLING_RESULT);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.url).toBe(OPENROUTER_DECISIONS_URL);
    const headers = new Headers(seen[0]?.init.headers);
    expect(headers.get("Authorization")).toBe("Bearer or-test-key");
    expect(JSON.parse(String(seen[0]?.init.body))).toEqual({
      model: "~typesafe/jev-latest",
      state: "Help ASAP",
      questions: { urgent: { type: "noul", instructions: "Urgent?" } },
    });
  });

  it("maps a non-2xx into TypeSafeError.http without leaking the key in the message", async () => {
    const client = createOpenRouterDecisionsClient({
      apiKey: "or-secret-should-not-appear",
      fetch: async () => jsonResponse(401, { error: "unauthorized" }),
    });

    await expect(
      client.evaluate({
        state: "x",
        questions: { q: { type: "noul", instructions: "yes?" } },
      }),
    ).rejects.toMatchObject({
      name: "TypeSafeError",
      code: "http",
      status: 401,
    });

    try {
      await client.evaluate({
        state: "x",
        questions: { q: { type: "noul", instructions: "yes?" } },
      });
    } catch (error) {
      expect(error).toBeInstanceOf(TypeSafeError);
      expect(String(error)).not.toContain("or-secret-should-not-appear");
    }
  });

  it("rejects a 200 body that is not a TypeSafe answers map", async () => {
    const client = createOpenRouterDecisionsClient({
      apiKey: "or-test-key",
      fetch: async () =>
        jsonResponse(200, {
          choices: [{ message: { content: "sure, billing" } }],
        }),
    });

    await expect(
      client.evaluate({
        state: "x",
        questions: { q: { type: "noul", instructions: "yes?" } },
      }),
    ).rejects.toMatchObject({ code: "invalid_response" });
  });
});
