/**
 * Harness readiness: the kept read, its refresh, its refusal, the formatter,
 * the action through a real flow, the view through a real router, and the
 * coordinator's context entry.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createClient } from "@flow-state-dev/client";
import { defineFlow } from "@flow-state-dev/core";
import type { HarnessReadiness, HarnessReadinessCheck } from "@flow-state-dev/core/harness";
import { createFlowApiRouter, createFlowRegistry, createFlowState, disposeFlowApiRouter, inMemoryStores, runAction } from "@flow-state-dev/engine";
import { createInMemoryStores } from "@flow-state-dev/engine/host";
import {
  formatHarnessReadiness,
  harnessReadiness,
  harnessReadinessAction,
  harnessReadinessCapability,
  harnessReadinessView,
  READINESS_GUIDANCE,
  type HarnessReadinessRead,
  type HarnessReadinessView,
} from "../src/readiness";
import { harnessReadinessViewRef } from "../src/browser";

const routers: ReturnType<typeof createFlowApiRouter>[] = [];
afterEach(async () => {
  await Promise.all(routers.splice(0).map((router) => disposeFlowApiRouter(router)));
});

const READY: HarnessReadiness = { ready: true };
const SIGNED_OUT: HarnessReadiness = { ready: false, reason: "Codex has no credential: Not logged in", remedy: "Run `codex login`, or set CODEX_API_KEY" };

/** A check that counts its calls and answers what it is told, in turn. */
function scripted(answers: Array<HarnessReadiness | "hang" | "throw">) {
  let calls = 0;
  const check: HarnessReadinessCheck = async (options) => {
    const answer = answers[Math.min(calls, answers.length - 1)]!;
    calls += 1;
    if (answer === "throw") throw new Error("SDK exploded");
    if (answer === "hang") {
      return new Promise((_, reject) => options?.signal?.addEventListener("abort", () => reject(new Error("aborted"))));
    }
    return answer;
  };
  return { check, calls: () => calls };
}

const brief = (rows: HarnessReadinessView[]) => rows.map(({ harness, ready, remedy, unanswered }) => ({ harness, ready, remedy, unanswered }));

describe("harnessReadiness — the kept read", () => {
  it("checks every harness on the first read, then answers from the kept rows", async () => {
    const cursor = scripted([READY]);
    const codex = scripted([SIGNED_OUT, READY]);
    const readiness = harnessReadiness({ cursor: { label: "Cursor", check: cursor.check }, codex: { label: "Codex", check: codex.check } });

    expect(brief(await readiness.read())).toEqual([
      { harness: "cursor", ready: true, remedy: null, unanswered: false },
      { harness: "codex", ready: false, remedy: "Run `codex login`, or set CODEX_API_KEY", unanswered: false },
    ]);
    // A second read is the kept answer: no check runs, so Codex still reads signed out.
    expect((await readiness.read())[1]!.ready).toBe(false);
    expect([cursor.calls(), codex.calls()]).toEqual([1, 1]);
  });

  it("checks again on refresh, all harnesses or one by name (Re-check)", async () => {
    const cursor = scripted([READY]);
    const codex = scripted([SIGNED_OUT, READY]);
    const readiness = harnessReadiness({ cursor: { check: cursor.check }, codex: { check: codex.check } });
    await readiness.read();

    const one = await readiness.read({ refresh: "codex" });
    expect(one.map((row) => row.ready)).toEqual([true, true]);
    expect([cursor.calls(), codex.calls()]).toEqual([1, 2]);

    await readiness.read({ refresh: true });
    expect([cursor.calls(), codex.calls()]).toEqual([2, 3]);
  });

  it("shares one call between concurrent reads of the same harness", async () => {
    const codex = scripted([READY]);
    const readiness = harnessReadiness({ codex: { check: codex.check } });
    await Promise.all([readiness.read(), readiness.read({ refresh: true }), readiness.read({ refresh: "codex" })]);
    expect(codex.calls()).toBe(1);
  });

  it("never throws: a check that throws or hangs past the timeout is a not-ready, unanswered row", async () => {
    const readiness = harnessReadiness(
      { broken: { label: "Broken", check: scripted(["throw"]).check }, slow: { label: "Slow", check: scripted(["hang"]).check } },
      { timeoutMs: 20 },
    );
    const [broken, slow] = await readiness.read();
    expect(broken).toMatchObject({ ready: false, unanswered: true, reason: "The check failed: SDK exploded" });
    expect(slow).toMatchObject({ ready: false, unanswered: true, reason: "The check did not answer within 0.02 s", remedy: null });
  });

  it("refuses an empty host: there is nothing to read", () => {
    expect(() => harnessReadiness({})).toThrow(/no harness/);
  });
});

describe("harnessReadiness — refusal before a task starts", () => {
  it("answers a ready harness from the kept row, with no check", async () => {
    const cursor = scripted([READY]);
    const readiness = harnessReadiness({ cursor: { label: "Cursor", check: cursor.check } });
    await readiness.read();
    expect(await readiness.refusal("cursor")).toBeUndefined();
    expect(cursor.calls()).toBe(1);
  });

  it("checks a not-ready harness again, so a sign-in made since start counts", async () => {
    const codex = scripted([SIGNED_OUT, READY]);
    const readiness = harnessReadiness({ codex: { label: "Codex", check: codex.check } });
    await readiness.read();
    expect(await readiness.refusal("codex")).toBeUndefined();
    expect(codex.calls()).toBe(2);
  });

  it("checks a harness with no kept row once, not twice, before refusing", async () => {
    const codex = scripted([SIGNED_OUT]);
    const readiness = harnessReadiness({ codex: { label: "Codex", check: codex.check } });
    expect(await readiness.refusal("codex")).toMatch(/isn't set up/);
    expect(codex.calls()).toBe(1);
  });

  it("says it couldn't tell, not that the harness isn't set up, when the check got no answer", async () => {
    const readiness = harnessReadiness({ slow: { label: "Slow", check: scripted(["hang"]).check } }, { timeoutMs: 20 });
    expect(await readiness.refusal("slow")).toBe(
      "Couldn't tell whether Slow is set up on this machine: The check did not answer within 0.02 s. Try starting the task again in a moment.",
    );
  });

  it("refuses with a sentence that names the harness, says why, and what to run", async () => {
    const readiness = harnessReadiness({ codex: { label: "Codex", check: scripted([SIGNED_OUT]).check } });
    expect(await readiness.refusal("codex")).toBe(
      "Codex isn't set up on this machine: Codex has no credential: Not logged in. Run `codex login`, or set CODEX_API_KEY. Then start the task again.",
    );
  });

  it("has nothing to say about a harness the host didn't name", async () => {
    const readiness = harnessReadiness({ codex: { check: scripted([SIGNED_OUT]).check } });
    expect(await readiness.refusal("cursor")).toBeUndefined();
  });
});

describe("formatHarnessReadiness", () => {
  it("prints one line per harness under a heading: ✓ for ready, ✗ with reason and remedy, ? for no answer", async () => {
    const readiness = harnessReadiness(
      {
        cursor: { label: "Cursor", check: scripted([READY]).check },
        codex: { label: "Codex", check: scripted([SIGNED_OUT]).check },
        claude: { label: "Claude Code", check: scripted(["hang"]).check },
      },
      { timeoutMs: 20 },
    );
    expect(formatHarnessReadiness(await readiness.read())).toBe(
      [
        "Coding harnesses on this machine:",
        "✓ Cursor",
        "✗ Codex: Codex has no credential: Not logged in. Run `codex login`, or set CODEX_API_KEY.",
        "? Claude Code: The check did not answer within 0.02 s.",
      ].join("\n"),
    );
  });
});

describe("harnessReadinessAction — through a real flow", () => {
  it("returns the rows, and refresh: true checks again", async () => {
    const codex = scripted([SIGNED_OUT, READY]);
    const readiness = harnessReadiness({ codex: { label: "Codex", check: codex.check } });
    const flow = defineFlow({ kind: "readiness-flow", actions: { harnessReadiness: harnessReadinessAction(readiness) } } as never)({
      id: "readiness-flow",
    } as never);
    const state = createFlowState({ flows: [flow], stores: { test: { primary: inMemoryStores() } }, defaultProfile: "test" } as never);
    const rt = (await (state as any).getRuntime()) as { stores: unknown; runtimeConfig: object };
    const act = async (input: unknown): Promise<HarnessReadinessView[]> => {
      const result = (await runAction({
        flow,
        actionName: "harnessReadiness",
        input,
        userId: "alice",
        orgId: "org_1",
        sessionId: `s_${Math.random().toString(36).slice(2)}`,
        stores: rt.stores,
        runtimeConfig: { ...rt.runtimeConfig },
      } as never)) as { output?: { harnesses: HarnessReadinessView[] }; error?: unknown };
      if (result.error !== undefined) throw new Error(JSON.stringify(result.error));
      return result.output!.harnesses;
    };

    expect((await act({}))[0]).toMatchObject({ harness: "codex", label: "Codex", ready: false });
    expect((await act({}))[0]!.ready).toBe(false);
    expect((await act({ refresh: true }))[0]!.ready).toBe(true);
    expect(codex.calls()).toBe(2);
  });
});

describe("harnessReadinessView — read by scope, with no session", () => {
  // Three callers, signed in by the flow: two users in one org, one in another.
  const signIn = (context: { request?: Request }) => {
    const user = context.request?.headers.get("x-user");
    const org = context.request?.headers.get("x-org");
    return user == null || org == null ? null : { userId: user, orgId: org };
  };
  const callers = { alice: "org-a", bob: "org-a", carol: "org-b" } as const;

  function host(readiness: HarnessReadinessRead) {
    const flow = defineFlow({
      kind: "harness-readiness",
      views: { readiness: harnessReadinessView(readiness) },
      authentication: { resolvePrincipal: signIn },
    } as never)();
    const registry = createFlowRegistry();
    registry.register(flow as never);
    const stores = createInMemoryStores();
    const router = createFlowApiRouter({ registry, stores, staleSweepIntervalMs: 0 });
    routers.push(router);
    const clientOf = (userId: keyof typeof callers) =>
      createClient({
        userId,
        fetcher: async (input: RequestInfo | URL, init?: RequestInit) => {
          const request = new Request(new URL(String(input instanceof Request ? input.url : input), "http://localhost"), init);
          request.headers.set("x-user", userId);
          request.headers.set("x-org", callers[userId]);
          const path = new URL(request.url).pathname.replace(/^\/api\/flows\//, "").split("/");
          return request.method === "GET" ? router.GET(request, { params: { path } }) : router.POST(request, { params: { path } });
        },
      });
    return { stores, router, clientOf };
  }

  it("answers each user in each org the machine's rows, makes no session for any of them, and Re-check checks again", async () => {
    const codex = scripted([SIGNED_OUT, READY]);
    const { stores, clientOf } = host(harnessReadiness({ codex: { label: "Codex", check: codex.check } }));
    const ref = harnessReadinessViewRef("harness-readiness");

    for (const user of ["alice", "bob", "carol"] as const) {
      const answer = await clientOf(user).view(ref, {});
      // Machine state, not user data: every caller reads the same kept rows, and the
      // answer names no user or org topic, so nothing of one caller reaches another.
      expect(brief(answer.value)).toEqual([{ harness: "codex", ready: false, remedy: "Run `codex login`, or set CODEX_API_KEY", unanswered: false }]);
      expect(answer.topics).toEqual([]);
      expect(answer.keys).toEqual(["codex"]);
    }
    // One check for three readers: the read is the kept one.
    expect(codex.calls()).toBe(1);

    // Re-check from the second org's user checks again, and the next reader sees it.
    expect((await clientOf("carol").view(ref, { refresh: true })).value[0]!.ready).toBe(true);
    expect((await clientOf("alice").view(ref, {})).value[0]!.ready).toBe(true);
    expect(codex.calls()).toBe(2);

    // No reader had a session found or made for it.
    expect(await stores.session.list({})).toEqual([]);
  });

  it("refuses a caller the flow doesn't sign in, and runs no check for them", async () => {
    const codex = scripted([READY]);
    const { router } = host(harnessReadiness({ codex: { check: codex.check } }));
    const path = ["harness-readiness", "views", "readiness"];
    const request = new Request(`http://localhost/api/flows/${path.join("/")}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: "mallory", input: {} }),
    });
    const res = await router.POST(request, { params: { path } });
    // The flow's sign-in names no user for it: a body's claimed user is never taken.
    expect(res.status, await res.clone().text()).toBe(400);
    expect(codex.calls()).toBe(0);
  });
});

describe("harnessReadinessCapability — the coordinator's context", () => {
  it("puts the rows and the guidance in context, read from the kept rows", async () => {
    const codex = scripted([SIGNED_OUT, READY]);
    const readiness = harnessReadiness({ codex: { label: "Codex", check: codex.check } });
    const cap = harnessReadinessCapability(readiness);
    const presets = (cap as any).__presetDefs;
    expect(presets.default).toEqual(["context"]);
    const [entry] = presets.context.context as Array<(input: unknown, ctx: unknown) => Promise<{ harnessReadiness: string }>>;

    const first = await entry!({}, {});
    expect(first.harnessReadiness).toContain("✗ Codex");
    expect(first.harnessReadiness).toContain(READINESS_GUIDANCE);
    await entry!({}, {});
    expect(codex.calls()).toBe(1);
  });
});
