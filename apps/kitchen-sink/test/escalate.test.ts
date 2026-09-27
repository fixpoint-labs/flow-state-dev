/**
 * A specialist files a case that needs a person onto `support.help`'s
 * `escalations`, through the channel's own `fileTask`, and says so.
 *
 * Every case boots the whole app in test mode (the scripted model, no key)
 * and reaches the seat the way the page does, over the app's router. What is
 * graded is what the server kept: the seat's conversation, the channel's
 * requests, and the rows on the board as the team panel reads them.
 *
 * Checks, by the spec's ids (`specs/issues/FIX-1611/BUSINESS-RULES.md`, V3):
 *
 *   BR-8  `[scenario:needs-a-person]` calls `escalate` once: one row on
 *         `escalations` carrying the case, through one `fileTask` request on
 *         `support.help` signed as the seat, and the reply says it filed.
 *   BR-10 the model names another author, board and channel: the row is
 *         still on `escalations`, in `support.help`, authored by the seat.
 *   BR-11 past a host that hands work to an external queue, the tool says
 *         filing is unavailable, the reply says nothing was filed, and no row
 *         lands.
 *   A seat that is not a member of `support.help`, which the channel would
 *   refuse, files nothing, sends nothing, and its reply says nothing was
 *   filed. The members the tool files for are the ones the channel's file
 *   declares: drop one from `ESCALATION_MEMBERS` and that case fails.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FlowState } from "@flow-state-dev/engine";
import { runAction } from "@flow-state-dev/engine";
import { createResourceClient, createSessionClient } from "@flow-state-dev/client";
import type { FlowInstance } from "@flow-state-dev/core/types";

// Each case boots the whole app afresh, and the first import is cold.
vi.setConfig({ testTimeout: 30_000 });

const CHANNEL = "support.help";
const BOARD = `${CHANNEL}.escalations`;

type Item = { type?: string; role?: string; content?: unknown; text?: string };

afterEach(async () => {
  const hmr = globalThis as { __fsdFlowstate?: FlowState };
  await hmr.__fsdFlowstate?.dispose();
  delete hmr.__fsdFlowstate;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

async function bootApp() {
  vi.resetModules();
  vi.stubEnv("KITCHEN_SINK_TEST_MODE", "1");
  vi.stubEnv("STORE_TYPE", "memory");
  vi.stubEnv("WORKFORCE_ADMIN_TOKENS", "");
  vi.stubEnv("AI_GATEWAY_API_KEY", "");
  vi.stubEnv("GOAL_CONTROL", "");
  const flowstate = (await import("@/fsdev.config")).default as FlowState;
  const router = await flowstate.getRouter();
  const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://kitchen-sink.local");
    const path = url.pathname
      .replace(/^\/api\/flows\/?/, "")
      .split("/")
      .filter((segment) => segment.length > 0)
      .map(decodeURIComponent);
    const method = (init?.method ?? "GET").toUpperCase() as "GET" | "POST" | "PATCH" | "DELETE";
    return await router[method](new Request(url, init), { params: { path } });
  };
  return {
    flowstate,
    router,
    sessions: createSessionClient({ fetcher }),
    resources: createResourceClient({ fetcher }),
  };
}

type App = Awaited<ReturnType<typeof bootApp>>;

const token = () => `case-token-${Math.random().toString(36).slice(2, 10)}`;

function textOf(item: Item): string {
  if (typeof item.content === "string") return item.content;
  if (Array.isArray(item.content)) {
    return item.content.map((part) => (part as { text?: string }).text ?? "").join("");
  }
  return item.text ?? JSON.stringify(item);
}

/** Send a message the way the seat composer does, and wait for the run to finish. */
async function ask(app: App, seat: string, message: string) {
  const session = await app.sessions.createSession({ flowKind: seat, userId: "devuser" });
  const res = await app.router.POST(
    new Request(`http://localhost/api/flows/${seat}/actions/run`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "text/event-stream" },
      body: JSON.stringify({ userId: "devuser", sessionId: session.id, input: { message } }),
    }),
    { params: { path: [seat, "actions", "run"] } },
  );
  const stream = await res.text();
  const snapshot = await app.sessions.getSessionState(session.id, { includeItems: true });
  const replies = ((snapshot.items ?? []) as Item[])
    .filter((item) => item.type === "message" && item.role === "assistant")
    .map(textOf);
  return { status: res.status, stream, replies };
}

type Row = { goal?: string; assignee?: string };

/** Rows on the board carrying `mark`, as the team panel reads them, waiting for the channel's own request. */
async function rowsWith(app: App, mark: string, expectAny = true): Promise<Row[]> {
  for (let i = 0; i < (expectAny ? 100 : 15); i++) {
    const page = await app.resources.listCollectionItems(CHANNEL, BOARD, {});
    const rows = ((page as { items?: Array<{ clientData?: Row }> }).items ?? [])
      .map((row) => row.clientData ?? {})
      .filter((row) => JSON.stringify(row).includes(mark));
    if (rows.length > 0) return rows;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return [];
}

type FileRequest = { status: string; actionName?: string; input?: { board?: string; author?: string } };

/** `support.help`'s requests carrying `mark`, once they settle. */
async function fileRequestsWith(app: App, mark: string): Promise<FileRequest[]> {
  let found: FileRequest[] = [];
  for (let i = 0; i < 100; i++) {
    const requests = (await app.sessions.listSessionRequests(CHANNEL)) as unknown as FileRequest[];
    found = requests.filter((request) => JSON.stringify(request).includes(mark));
    if (found.length > 0 && found.every((r) => !["pending", "queued", "in_progress", "running"].includes(r.status))) {
      return found;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return found;
}

describe("V3 · a specialist files what needs a person", () => {
  it("files the case onto escalations through the channel's fileTask, authored by the seat, and says so (BR-8)", async () => {
    const app = await bootApp();
    const mark = token();
    const ran = await ask(app, "support.devices", `[scenario:needs-a-person] ${mark} the charger caught fire`);

    expect(ran.status).toBe(200);
    expect(ran.replies).toEqual([expect.stringContaining("[reply:escalated]")]);
    const rows = await rowsWith(app, mark);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.assignee).toBeUndefined();
    const requests = await fileRequestsWith(app, mark);
    expect(requests.map((r) => [r.actionName, r.status, r.input?.board, r.input?.author])).toEqual([
      ["fileTask", "completed", "escalations", "support.devices"],
    ]);
  });

  it("files as the seat onto escalations whatever author, board and channel the model names (BR-10)", async () => {
    const app = await bootApp();
    const mark = token();
    // The scripted call adds an author, a board and a channel of its own; the
    // tool's input is the case alone, so none of them reaches the filing.
    await ask(app, "support.accounts", `[scenario:needs-a-person] [forge-author] ${mark} refund me now`);

    expect(await rowsWith(app, mark)).toHaveLength(1);
    const requests = await fileRequestsWith(app, mark);
    expect(requests.map((r) => [r.actionName, r.input?.board, r.input?.author])).toEqual([
      ["fileTask", "escalations", "support.accounts"],
    ]);
  });

  it("files nothing for a seat that is not a member of support.help, and says so", async () => {
    const app = await bootApp();
    const { kitchenSinkKinds } = await import("@/workforce/hire");
    const { hireWorkforce } = await import("@flow-state-dev/workforce");
    const [outsider] = hireWorkforce(
      [{ id: "support.bo", declared: { tools: ["escalate"] }, body: "Answer questions." }],
      { kinds: kitchenSinkKinds },
    );
    app.flowstate.register(outsider as FlowInstance);
    const mark = token();
    const ran = await ask(app, "support.bo", `[scenario:needs-a-person] ${mark} escalate me`);

    // What the person sees: a reply that says nothing was filed, never one
    // that claims it was. The channel would refuse the seat, so nothing is
    // sent to it.
    expect(ran.replies).toEqual([expect.stringContaining("[reply:unfiled]")]);
    expect(ran.replies.join("\n")).not.toContain("[reply:escalated]");
    expect(await fileRequestsWith(app, mark)).toEqual([]);
    expect(await rowsWith(app, mark, false)).toEqual([]);
  });

  it("files for the members support.help's CHANNEL.md declares, and no one else", async () => {
    const { readChannelsDirectory } = await import("@flow-state-dev/workforce/loader");
    const { workforceRoot } = await import("@/workforce/hire");
    const { ESCALATION_CHANNEL, ESCALATION_MEMBERS } = await import("@/workforce/blocks/escalate");
    const { channels, errors } = await readChannelsDirectory(workforceRoot);
    expect(errors).toEqual([]);
    const declared = channels.find((channel) => channel.id === ESCALATION_CHANNEL)?.declared.members;
    expect(declared).toBeDefined();
    expect([...ESCALATION_MEMBERS].sort()).toEqual([...(declared as string[])].sort());
  });

  it("says filing is unavailable past an external dispatcher, and files nothing (BR-11)", async () => {
    const app = await bootApp();
    const runtime = await app.flowstate.getRuntime();
    const seat = runtime.registry.get("support.devices") as FlowInstance;
    const session = await app.sessions.createSession({ flowKind: "support.devices", userId: "devuser" });
    const mark = token();

    const ran = await runAction({
      flow: seat,
      actionName: "run",
      input: { message: `[scenario:needs-a-person] ${mark} the charger caught fire` },
      userId: "devuser",
      orgId: "kitchen-sink",
      sessionId: session.id,
      stores: runtime.stores,
      runtimeConfig: {
        ...runtime.runtimeConfig,
        requestHost: {
          ...runtime.runtimeConfig.requestHost,
          // What the host answers an `id` delivery when its dispatcher hands
          // work to an external queue.
          dispatchOperation: async () => ({
            notStarted: true,
            externalDispatcher: true,
            reason: "the effective dispatcher hands work to an external queue",
          }),
        } as never,
      },
    });

    expect(ran.error).toBeUndefined();
    const toolOutputs = JSON.stringify((ran.items ?? []).filter((item) => (item as Item).type === "tool_output"));
    expect(toolOutputs).toContain("unavailable");
    // What the person sees: a reply that says nothing was filed, never one
    // that claims it was.
    const replies = (ran.items ?? [])
      .filter((item) => (item as Item).type === "message" && (item as Item).role === "assistant")
      .map((item) => textOf(item as Item));
    expect(replies).toEqual([expect.stringContaining("[reply:unfiled]")]);
    expect(replies.join("\n")).not.toContain("[reply:escalated]");
    expect(await fileRequestsWith(app, mark)).toEqual([]);
    expect(await rowsWith(app, mark, false)).toEqual([]);
  });
});
