/**
 * A hired built-in seat answers a caller who sends only `userId`.
 *
 * The skills collection stays at organization scope. The organization is the
 * one already on the principal — a configured resolver's verified org, or the
 * framework development org when the app configures no resolver. The request
 * body does not carry an `orgId`, and the test does not mint one to make the
 * turn succeed. What is graded is that the seat's own skill is seeded and
 * reaches the model, which is the thing that used to die with
 * `Resource "skills" is not registered` before the model was called.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_ORG_ID } from "@flow-state-dev/core";
import type { FlowInstance, InitialSkill, ResolvePrincipalFn } from "@flow-state-dev/core/types";
import { createFlowState, inMemoryStores } from "@flow-state-dev/engine";
import { createMockModelResolver, mockGenerator } from "@flow-state-dev/testing";
import { hireWorkforce } from "../src/hire";
import { AGENT_KIND, defineAgentWorkerFlow } from "../src/agent-worker-flow";
import type { WorkerManifest } from "../src/manifest";

const USER_ID = "u_caller";
const PRINCIPAL_ORG = "acme";
const MARKER = "MARKER-PRINCIPAL-SKILL";

const houseStyle: InitialSkill = {
  name: "house-style",
  skillMd: ["---", "description: How this desk writes.", "---", "", MARKER].join("\n"),
};

function record(): WorkerManifest {
  return {
    id: "engineering.desk",
    declared: {},
    body: "You are the engineering desk.",
    skills: [houseStyle],
  };
}

/** Body user id only. Organization is never read from the body. */
const principalOrg: ResolvePrincipalFn = (context) => {
  const metadata = context.envelope.metadata;
  const body = (metadata?.body ?? context.envelope.input) as { userId?: unknown } | undefined;
  const userId = typeof body?.userId === "string" ? body.userId : undefined;
  if (userId === undefined) return null;
  return { userId, orgId: PRINCIPAL_ORG };
};

type Turn = {
  httpStatus: number;
  httpBody: unknown;
  request: { status?: string; orgId?: string; items?: unknown[] } | undefined;
  session: { orgId?: string; state?: Record<string, unknown> } | undefined;
  shown: string;
};

async function ask(seat: FlowInstance, sessionId: string): Promise<Turn> {
  const answer = mockGenerator({ name: "agent-answer", script: [{ text: "ok" }] });
  const state = createFlowState({
    flows: { [seat.id]: seat },
    stores: { default: { primary: inMemoryStores() } },
    modelResolver: createMockModelResolver({
      generators: {
        "agent-answer": answer,
        "agent-answer-with-activate-tool": answer,
      },
    }),
  });
  const router = await state.getRouter();
  const path = [seat.id, sessionId, "actions", "run"];
  const body = { userId: USER_ID, input: { message: "/house-style" } };
  const response = await router.POST(
    new Request(`http://test/api/flows/${path.join("/")}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: { path } } as never,
  );
  const text = await response.text();
  const httpBody = text.length > 0 ? JSON.parse(text) : undefined;
  const requestId = httpBody?.request?.id as string | undefined;
  const stores = (await state.getRuntime()).stores;

  let request: Turn["request"];
  if (requestId !== undefined) {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      request = (await stores.request.get(requestId)) as Turn["request"];
      if (request !== undefined && request.status !== undefined && request.status !== "in_progress") {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 15));
    }
  }

  const session = (await stores.session.get(sessionId)) as Turn["session"];
  const shown = JSON.stringify(answer.calls[0]?.input ?? null);
  return { httpStatus: response.status, httpBody, request, session, shown };
}

function hireSeat(authentication?: FlowInstance["authentication"]): FlowInstance {
  const kind = defineAgentWorkerFlow();
  const [seat] = hireWorkforce([record()], { kinds: { [AGENT_KIND]: kind } });
  if (authentication !== undefined) {
    Object.assign(seat!, { authentication });
  }
  return seat!;
}

describe("a built-in seat resolves skills from the principal's org", () => {
  it("seeds and shows the seat's skill when the body sends only userId", async () => {
    const turn = await ask(hireSeat({ resolvePrincipal: principalOrg }), "s-principal");

    expect(turn.httpStatus, JSON.stringify(turn.httpBody)).toBe(202);
    expect(turn.request?.status, JSON.stringify(turn.request)).toBe("completed");
    expect(turn.request?.orgId).toBe(PRINCIPAL_ORG);
    expect(turn.session?.orgId).toBe(PRINCIPAL_ORG);
    const active = turn.session?.state?.activeSkills as Array<{ name: string }> | undefined;
    expect(active?.map((entry) => entry.name)).toContain("house-style");
    expect(turn.shown).toContain(MARKER);
  });

  it("does the same when the app configures no resolver and the framework supplies the development org", async () => {
    const turn = await ask(hireSeat(), "s-default");

    expect(turn.httpStatus, JSON.stringify(turn.httpBody)).toBe(202);
    expect(turn.request?.status, JSON.stringify(turn.request)).toBe("completed");
    expect(turn.request?.orgId).toBe(DEFAULT_ORG_ID);
    expect(turn.session?.orgId).toBe(DEFAULT_ORG_ID);
    const active = turn.session?.state?.activeSkills as Array<{ name: string }> | undefined;
    expect(active?.map((entry) => entry.name)).toContain("house-style");
    expect(turn.shown).toContain(MARKER);
  });
});
