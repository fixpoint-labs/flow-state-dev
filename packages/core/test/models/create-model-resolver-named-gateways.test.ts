/**
 * Two gateways of the same type, registered under different names with
 * different keys, are two accounts. A `name:model` string must reach the
 * account registered under that name, for generators and evaluators alike,
 * whichever was resolved first.
 *
 * The real `@ai-sdk/gateway` package serves the calls; `fetch` is stubbed to
 * record the bearer key each request carries and then refuse it, so "which
 * account served this" is read off the request, and nothing leaves the
 * process.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createModelResolver } from "../../src/models/createModelResolver";

const messages = [{ role: "user" as const, content: "hi" }];
let keysSeen: string[] = [];
const realFetch = globalThis.fetch;

beforeEach(() => {
  vi.stubEnv("AI_GATEWAY_API_KEY", "");
  vi.stubEnv("OPENAI_API_KEY", "");
  keysSeen = [];
  globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
    const auth = new Headers(init?.headers).get("authorization") ?? "";
    keysSeen.push(auth.replace(/^Bearer\s+/i, ""));
    return new Response(JSON.stringify({ error: { message: "refused by the test", type: "authentication_error" } }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.unstubAllEnvs();
});

/** The bearer key the call behind `run` sent. */
async function keyOf(run: () => Promise<unknown>): Promise<string | undefined> {
  const before = keysSeen.length;
  await run().catch((err) => {
    if (process.env.DEBUG_NAMED_GW) console.log(err);
  });
  return keysSeen.slice(before)[0];
}

const twoAccounts = () =>
  createModelResolver({
    gateways: { east: { type: "vercel", apiKey: "k-east" }, west: { type: "vercel", apiKey: "k-west" } },
    env: {},
  });

const generate = (resolver: ReturnType<typeof createModelResolver>, model: string) => () =>
  resolver(model).generate({ messages });

const evaluate = (resolver: ReturnType<typeof createModelResolver>, model: string) => async () => {
  const m = (await resolver.resolveEvaluationModel!(model)) as unknown as {
    doEvaluate?: (o: unknown) => Promise<unknown>;
    doDecide?: (o: unknown) => Promise<unknown>;
  };
  const call = m.doEvaluate ?? m.doDecide;
  return call!.call(m, { questions: { q: { type: "boolean", instructions: "Urgent?" } }, state: [{ type: "text", text: "x" }] });
};

describe("named gateways of one type are separate accounts", () => {
  it("routes each generator string to the key registered under its name, in either order", async () => {
    const a = twoAccounts();
    expect(await keyOf(generate(a, "east:openai/gpt-5.4-mini"))).toBe("k-east");
    expect(await keyOf(generate(a, "west:openai/gpt-5.4-mini"))).toBe("k-west");

    const b = twoAccounts();
    expect(await keyOf(generate(b, "west:openai/gpt-5.4-mini"))).toBe("k-west");
    expect(await keyOf(generate(b, "east:openai/gpt-5.4-mini"))).toBe("k-east");
  });

  it("routes each evaluator string to the key registered under its name, in either order", async () => {
    const a = twoAccounts();
    expect(await keyOf(evaluate(a, "east:typesafe-ai/jev"))).toBe("k-east");
    expect(await keyOf(evaluate(a, "west:typesafe-ai/jev"))).toBe("k-west");

    const b = twoAccounts();
    expect(await keyOf(evaluate(b, "west:typesafe-ai/jev"))).toBe("k-west");
    expect(await keyOf(evaluate(b, "east:typesafe-ai/jev"))).toBe("k-east");
  });

  it("does not hand a named config the app's instance registered under the gateway's type", async () => {
    const instanceIds: string[] = [];
    const instance = {
      languageModel: (id: string) => {
        instanceIds.push(id);
        throw new Error("the vercel instance must not serve west");
      },
      evaluationModel: (id: string) => {
        instanceIds.push(id);
        throw new Error("the vercel instance must not serve west");
      },
    };
    const resolver = createModelResolver({
      gateways: { vercel: instance, west: { type: "vercel", apiKey: "k-west" } },
      env: {},
    });

    expect(await keyOf(generate(resolver, "west:openai/gpt-5.4-mini"))).toBe("k-west");
    expect(await keyOf(evaluate(resolver, "west:typesafe-ai/jev"))).toBe("k-west");
    expect(instanceIds).toEqual([]);
  });

  it("serves the bare provider/model fall-through from one configured account", async () => {
    // Fall-through picks the first configured gateway; it must use that
    // entry's own key, not whichever same-type instance loaded first.
    const resolver = twoAccounts();
    await keyOf(generate(resolver, "west:openai/gpt-5.4-mini"));
    expect(await keyOf(generate(resolver, "openai/gpt-5.4-mini"))).toBe("k-east");
  });
});
