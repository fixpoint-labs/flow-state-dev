/**
 * The desk clerk answers with a model, and can file what it can't close, on
 * this app's own wiring.
 *
 * Every case boots the whole app in test mode (the scripted model, no key)
 * and reaches the seat the way the page does, over the app's router. What is
 * graded is what the server kept: the seat's conversation, and the rows on
 * `support.desk`'s boards as the team panel reads them.
 *
 * Checks, by the spec's ids (`specs/issues/FIX-1589/PLAN.md`):
 *
 *   V2 A note to `support.ada` is the person's turn, and the reply is
 *      `[front desk]` plus the scripted text, never the note; `support.grace`
 *      answers `[back desk]`. The no-op model gives the tag alone. With no
 *      scripted model and no key the run fails, and nothing echoes.
 *      Red: `deskNote` put back as the answer — the reply is the note.
 *   V3 The file scenario leaves one row with the note's token on
 *      `escalations`, authored by the seat (whatever the model sent), through
 *      a `fileTask` request on `support.desk`; aimed at `followups` it leaves
 *      a row for `followup-runner`; a board the tool does not offer files
 *      nothing; a clerk that is not a member of the channel is refused and
 *      files nothing; past an external dispatcher the tool says filing is
 *      unavailable and files nothing.
 *   V4 The boot still warns that `escalations` is unattended: filing onto it
 *      is not draining it.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FlowState } from "@flow-state-dev/engine";
import { runAction } from "@flow-state-dev/engine";
import { createResourceClient, createSessionClient } from "@flow-state-dev/client";
import { createMockModelResolver } from "@flow-state-dev/testing";
import { createFlowState, inMemoryStores } from "@flow-state-dev/engine";
import type { FlowInstance } from "@flow-state-dev/core/types";
import { DEFAULT_ORG_ID } from "@flow-state-dev/core";

// Each case boots the whole app afresh, and the first import is cold.
vi.setConfig({ testTimeout: 30_000 });

type Router = Awaited<ReturnType<FlowState["getRouter"]>>;
type Item = { type?: string; role?: string; content?: unknown; text?: string };

afterEach(async () => {
  const hmr = globalThis as { __fsdFlowstate?: FlowState };
  await hmr.__fsdFlowstate?.dispose();
  delete hmr.__fsdFlowstate;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

async function bootApp(options: { testMode?: boolean } = {}) {
  vi.resetModules();
  vi.stubEnv("KITCHEN_SINK_TEST_MODE", options.testMode === false ? "" : "1");
  vi.stubEnv("STORE_TYPE", "memory");
  vi.stubEnv("WORKFORCE_ADMIN_TOKENS", "");
  vi.stubEnv("AI_GATEWAY_API_KEY", "");
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

const token = () => `clerk-token-${Math.random().toString(36).slice(2, 10)}`;

/** Send a note the way the seat composer does, and wait for the run to finish. */
async function ask(app: App, seat: string, note: string) {
  const session = await app.sessions.createSession({ flowKind: seat, userId: "devuser" });
  const res = await app.router.POST(
    new Request(`http://localhost/api/flows/${seat}/actions/answer`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "text/event-stream" },
      body: JSON.stringify({ userId: "devuser", sessionId: session.id, input: { note } }),
    }),
    { params: { path: [seat, "actions", "answer"] } },
  );
  const stream = await res.text();
  const snapshot = await app.sessions.getSessionState(session.id, { includeItems: true });
  const messages = ((snapshot.items ?? []) as Item[])
    .filter((item) => item.type === "message")
    .map((item) => ({ role: String(item.role), text: textOf(item) }));
  return { status: res.status, stream, messages, sessionId: session.id };
}

function textOf(item: Item): string {
  if (typeof item.content === "string") return item.content;
  if (Array.isArray(item.content)) {
    return item.content.map((part) => (part as { text?: string }).text ?? "").join("");
  }
  return item.text ?? JSON.stringify(item);
}

type Row = { goal?: string; assignee?: string; status?: string };

/** A board's rows as the team panel reads them: the resource route, the fields it shows. */
async function rowsOn(app: App, board: string): Promise<Row[]> {
  const page = await app.resources.listCollectionItems("support.desk", `support.desk.${board}`, {});
  return ((page as { items?: Array<{ clientData?: Row }> }).items ?? []).map((row) => row.clientData ?? {});
}

/** Rows on `board` carrying `mark`, waiting for the channel's separate `fileTask` request. */
async function rowsWith(app: App, board: string, mark: string, expectAny = true) {
  for (let i = 0; i < (expectAny ? 100 : 15); i++) {
    const rows = (await rowsOn(app, board)).filter((row) => JSON.stringify(row).includes(mark));
    if (rows.length > 0) return rows;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return [];
}

type FileRequest = { status: string; actionName?: string; input?: { author?: string; assignee?: string } };

/** `support.desk`'s requests carrying `mark`, once they settle. */
async function fileRequestsWith(app: App, mark: string) {
  let found: FileRequest[] = [];
  for (let i = 0; i < 100; i++) {
    const requests = (await app.sessions.listSessionRequests("support.desk")) as unknown as FileRequest[];
    found = requests.filter((request) => JSON.stringify(request).includes(mark));
    if (found.length > 0 && found.every((r) => !["pending", "queued", "in_progress", "running"].includes(r.status))) {
      return found;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return found;
}

describe("V2 · the clerk answers with a model", () => {
  it("keeps the note as the person's turn and replies under the seat's desk, not with the note", async () => {
    const app = await bootApp();
    const mark = token();
    const note = `[scenario:clerk-answer] ${mark} where is my refund?`;

    const ada = await ask(app, "support.ada", note);
    expect(ada.status).toBe(200);
    const asked = ada.messages.find((m) => m.role === "user");
    const replies = ada.messages.filter((m) => m.role === "assistant");
    expect(asked?.text).toBe(note);
    expect(replies).toHaveLength(1);
    expect(replies[0]!.text).toMatch(/^\[front desk\] \[clerk:answered\] /);
    expect(replies[0]!.text).not.toContain(mark);

    const grace = await ask(app, "support.grace", note);
    const graceReplies = grace.messages.filter((m) => m.role === "assistant");
    expect(graceReplies.map((m) => m.text)).toEqual([expect.stringMatching(/^\[back desk\] \[clerk:answered\] /)]);
  });

  it("replies with the desk tag alone when the model says nothing", async () => {
    const { kitchenSinkKinds } = await import("@/workforce/hire");
    const { hireWorkforce } = await import("@flow-state-dev/workforce");
    const [seat] = hireWorkforce(
      [{ id: "support.quiet", declared: { flow: "desk-clerk", desk: "side" }, body: "Answer notes." }],
      { kinds: kitchenSinkKinds },
    );
    const state = createFlowState({
      flows: { [seat!.id]: seat as FlowInstance },
      stores: { default: { primary: inMemoryStores() } },
      modelResolver: createMockModelResolver({ policy: "allow" }),
    });
    const runtime = await state.getRuntime();
    const ran = await runAction({
      flow: seat as FlowInstance,
      actionName: "answer",
      input: { note: "a note the reply must not repeat" },
      userId: "devuser",
      orgId: DEFAULT_ORG_ID,
      sessionId: "s_quiet",
      stores: runtime.stores,
      runtimeConfig: { ...runtime.runtimeConfig },
    });
    expect(ran.error).toBeUndefined();
    const items = (ran.items ?? []) as Item[];
    const replies = items.filter((item) => item.type === "message" && item.role === "assistant").map(textOf);
    expect(replies).toEqual(["[side desk]"]);
    await state.dispose();
  });

  it("fails, and echoes nothing, when there is no scripted model and no key", async () => {
    const app = await bootApp({ testMode: false });
    const mark = token();
    const ran = await ask(app, "support.ada", `[scenario:clerk-answer] ${mark} hello`);
    expect(ran.stream).toContain('"type":"error"');
    expect(ran.stream).toContain("No API key");
    // No reply at all: in particular, not the note handed back.
    expect(ran.messages.filter((m) => m.role === "assistant")).toEqual([]);
  });
});

describe("V3 · the clerk files what the desk can't close", () => {
  it("files onto escalations through the channel's fileTask, authored by the seat, and says so", async () => {
    const app = await bootApp();
    const mark = token();
    // The note asks the script to forge an author; the row must still be the seat's.
    const ran = await ask(app, "support.ada", `[scenario:clerk-file] [forge-author] ${mark} the charger caught fire`);

    const replies = ran.messages.filter((m) => m.role === "assistant").map((m) => m.text);
    expect(replies).toEqual([expect.stringMatching(/^\[front desk\] \[clerk:filed\] /)]);

    const rows = await rowsWith(app, "escalations", mark);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.assignee).toBeUndefined();

    // One `fileTask` on the channel's own session, signed as the seat, not as
    // the author the model tried to set.
    const requests = await fileRequestsWith(app, mark);
    expect(requests.map((r) => [r.actionName, r.status, r.input?.author])).toEqual([
      ["fileTask", "completed", "support.ada"],
    ]);
  });

  it("files onto followups for the followup-runner worker", async () => {
    const app = await bootApp();
    const mark = token();
    await ask(app, "support.grace", `[scenario:clerk-file] [board:followups] ${mark} call them back tomorrow`);

    const rows = await rowsWith(app, "followups", mark);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.assignee).toBe("followup-runner");
    expect((await fileRequestsWith(app, mark)).map((r) => r.input?.author)).toEqual(["support.grace"]);
    expect(await rowsWith(app, "escalations", mark, false)).toEqual([]);
  });

  it("files nothing onto a board the tool does not offer", async () => {
    const app = await bootApp();
    const mark = token();
    await ask(app, "support.ada", `[scenario:clerk-file] [board:general] ${mark} put this somewhere`);
    expect(await fileRequestsWith(app, mark)).toEqual([]);
    expect(await rowsWith(app, "escalations", mark, false)).toEqual([]);
    expect(await rowsWith(app, "followups", mark, false)).toEqual([]);
  });

  it("files nothing for a clerk that is not a member of support.desk", async () => {
    const app = await bootApp();
    const { kitchenSinkKinds } = await import("@/workforce/hire");
    const { hireWorkforce } = await import("@flow-state-dev/workforce");
    const [outsider] = hireWorkforce(
      [{ id: "support.bo", declared: { flow: "desk-clerk", desk: "side" }, body: "Answer notes." }],
      { kinds: kitchenSinkKinds },
    );
    app.flowstate.register(outsider as FlowInstance);
    const mark = token();
    await ask(app, "support.bo", `[scenario:clerk-file] ${mark} escalate me`);

    const requests = await fileRequestsWith(app, mark);
    expect(requests.map((r) => r.status)).toEqual(["failed"]);
    expect(JSON.stringify(requests)).toContain("author-not-a-member");
    expect(await rowsWith(app, "escalations", mark, false)).toEqual([]);
  });

  it("says filing is unavailable past an external dispatcher, and files nothing", async () => {
    const app = await bootApp();
    const runtime = await app.flowstate.getRuntime();
    const ada = runtime.registry.get("support.ada") as FlowInstance;
    const session = await app.sessions.createSession({ flowKind: "support.ada", userId: "devuser" });
    const mark = token();

    const ran = await runAction({
      flow: ada,
      actionName: "answer",
      input: { note: `[scenario:clerk-file] ${mark} the charger caught fire` },
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
    expect(replies).toEqual([expect.stringMatching(/^\[front desk\] \[clerk:unfiled\] /)]);
    expect(replies.join("\n")).not.toContain("[clerk:filed]");
    expect(await fileRequestsWith(app, mark)).toEqual([]);
    expect(await rowsWith(app, "escalations", mark, false)).toEqual([]);
  });
});

describe("V4 · filing onto escalations does not attend it", () => {
  it("still warns at boot that escalations is unattended", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await bootApp();
    expect(warn.mock.calls.map((call) => call.join(" ")).some((line) => line.includes('board "escalations"'))).toBe(true);
  });
});
