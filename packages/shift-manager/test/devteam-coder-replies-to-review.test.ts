/**
 * The coder replies on each review comment it addresses, without being asked,
 * on the real Lab.
 *
 * Why this matters: asked to address the review feedback on its pull request,
 * eng.coder pushed the fix and said nothing on GitHub. Both inline review
 * comments stayed unanswered until Jake told it to reply, and then it posted
 * one summary comment instead of a reply to each. Nothing in the
 * coder's instructions said to reply.
 *
 * 1. The prompt the coder's harness is handed tells it to reply to each
 *    review comment it addressed, as a reply to that comment, through the
 *    GitHub MCP when it has one and `gh` otherwise.
 * 2. A scripted harness that does what its prompt says (no MCP here, so `gh`)
 *    replies once per comment, and the task's output lists both replies.
 *
 * `gh` is a stub on `PATH` that logs each call; best fit is scripted.
 */
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FlowInstance, GeneratorModel, ModelResolver } from "@flow-state-dev/core/types";
import { inMemoryStores, runAction } from "@flow-state-dev/engine";
import { harnessStub, type StubRun } from "@flow-state-dev/harness-manager";
import { LAB_ORG_ID, LAB_USER_ID, openLab, type Lab } from "../teams/devteam/host.mts";
import { createBareRemote } from "../teams/devteam/scratch-repo.mts";

const SHIFT_COORDINATOR = "shift-coordinator";
const CODER = "eng.coder";
const STOREFRONT = { visibility: "shared", id: "storefront" } as const;
const ASK = "Address the review feedback on https://github.com/acme/storefront/pull/7";
/** The two inline review comments on the pull request. */
const COMMENTS = [4605429695, 4605429708];
const replyUrl = (id: number) => `https://github.com/acme/storefront/pull/7#discussion_r${id + 1}`;

const dirs: string[] = [];
const PATH = process.env.PATH;
let ghLog: string;
const ghCalls = () => (existsSync(ghLog) ? readFileSync(ghLog, "utf8").trim().split("\n") : []);

beforeAll(() => {
  // `gh`: a reply to a review comment answers with the reply's link; anything else (the branch check) finds nothing.
  const bin = mkdtempSync(join(tmpdir(), "devteam-replies-gh-"));
  dirs.push(bin);
  ghLog = join(bin, "calls.log");
  writeFileSync(
    join(bin, "gh"),
    `#!/usr/bin/env node
const args = process.argv.slice(2);
require("node:fs").appendFileSync(${JSON.stringify(ghLog)}, args.join(" ") + "\\n");
const reply = /pulls\\/7\\/comments\\/(\\d+)\\/replies/.exec(args.join(" "));
process.stdout.write(reply === null ? "[]" : JSON.stringify({ html_url: "https://github.com/acme/storefront/pull/7#discussion_r" + (Number(reply[1]) + 1) }));
`,
  );
  chmodSync(join(bin, "gh"), 0o755);
  process.env.PATH = `${bin}${delimiter}${PATH ?? ""}`;
});

afterAll(() => {
  process.env.PATH = PATH;
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

let opened: Lab | undefined;
afterEach(async () => {
  await opened?.dispose();
  opened = undefined;
});

/** Best fit's evaluation: the coder, sure of it. The coder's judge, `done`. */
const route = {
  specificationVersion: "v4",
  provider: "test",
  modelId: "test/route",
  supportedQuestionTypes: ["choice", "score", "boolean"],
  async doEvaluate(call: { questions: Record<string, unknown> }) {
    const judging = "verdict" in call.questions;
    return {
      answers: judging
        ? { verdict: { type: "choice", choice: "done" }, why: { type: "choice", choice: "off-target" } }
        : { worker: { type: "choice", choice: CODER } },
      usage: { inputTokens: 1, outputTokens: 1 },
      warnings: [],
      providerMetadata: { typesafe: { confidence: judging ? { verdict: 0.95 } : { worker: 0.95 } } },
    };
  },
};

/** No block in this test should reach a generator model. */
const models = Object.assign(
  (_id: string, block?: string): GeneratorModel => {
    throw new Error(`no model in this test (asked for ${block ?? "a block"})`);
  },
  { resolveId: (id: string) => id, resolveEvaluationModel: () => route },
) as unknown as ModelResolver;

async function act(lab: Lab, flow: string, sessionId: string, actionName: string, input: unknown) {
  const runtime = await lab.state.getRuntime();
  return (await runAction({
    orgId: LAB_ORG_ID,
    flow: runtime.registry.get(flow) as FlowInstance,
    actionName,
    input,
    userId: LAB_USER_ID,
    sessionId,
    stores: runtime.stores,
    runtimeConfig: runtime.runtimeConfig,
  } as never)) as { output?: any; error?: unknown };
}

async function eventually<T>(check: () => Promise<T | undefined>, what: string, ms = 30_000): Promise<T> {
  for (const until = Date.now() + ms; ; ) {
    const value = await check();
    if (value !== undefined) return value;
    if (Date.now() > until) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/** Whether a prompt tells the run to reply to each review comment it addressed, MCP first and `gh` as the fallback. */
const toldToReply = (prompt: string) =>
  /reply on GitHub to each\s+review comment you addressed, as a reply to that comment/.test(prompt) &&
  prompt.includes("GitHub MCP") &&
  prompt.includes("pulls/<number>/comments/<comment id>/replies");

/** A harness that does what its prompt says: with no MCP, one `gh` reply per comment, then lists them. */
function obedientHarness() {
  const replied = new Map<StubRun, string[]>();
  return harnessStub({
    duringRun: (run) => {
      if (!toldToReply(run.prompt)) return;
      replied.set(
        run,
        COMMENTS.map((id) => {
          const out = execFileSync("gh", ["api", `repos/acme/storefront/pulls/7/comments/${id}/replies`, "-f", "body=Fixed in abc1234."], {
            encoding: "utf8",
          });
          return (JSON.parse(out) as { html_url: string }).html_url;
        }),
      );
    },
    finalMessage: (run) => ["Fixed both review comments.", ...(replied.get(run) ?? []).map((url) => `- Replied: ${url}`)].join("\n"),
  });
}

describe("the coder addressing review feedback on its pull request", () => {
  it("is told to reply to each comment it addressed, and its output lists one reply per comment", async () => {
    const stub = obedientHarness();
    const remote = createBareRemote("coder-replies", { seed: { "README.md": "storefront\n" } });
    opened = await openLab({
      modelResolver: models,
      stores: inMemoryStores(),
      harness: stub.slot,
      runTimeoutMs: 30_000,
      workspace: { root: mkdtempSync(join(tmpdir(), "devteam-coder-replies-")), remotes: { allow: ["file"] } },
      coderWorkerId: CODER,
      inventory: true,
      projects: [{ id: STOREFRONT.id, title: "Storefront", repository: remote.url }],
    });
    const lab = opened;
    const conversation = `s-shift-coordinator-${globalThis.crypto.randomUUID()}`;
    const created = await lab.door("POST", "coordinator/sessions", {
      body: { userId: LAB_USER_ID, sessionId: conversation, state: { workerId: SHIFT_COORDINATOR } },
    });
    expect(created.status).toBe(201);
    expect((await act(lab, "coordinator", conversation, "setWorkProject", { project: STOREFRONT })).error).toBeUndefined();
    expect((await act(lab, "coordinator", conversation, "respond", { message: ASK })).error).toBeUndefined();

    const task = await eventually(async () => {
      const row = (Object.values(await lab.stored("user", "tasks/")) as any[]).find((r) => r.assignee === CODER);
      return ["completed", "failed", "errored", "cancelled"].includes(row?.status) ? row : undefined;
    }, "the coder's task to end");

    expect(stub.runs).toHaveLength(1);
    expect(stub.runs[0]!.prompt).toContain(ASK);
    expect(toldToReply(stub.runs[0]!.prompt)).toBe(true);
    // One reply per review comment, each a reply to that comment.
    const replies = ghCalls().filter((call) => /\/comments\/\d+\/replies/.test(call));
    expect(replies.map((call) => /comments\/(\d+)\/replies/.exec(call)![1])).toEqual(COMMENTS.map(String));
    expect(task.status, JSON.stringify(task.lastError ?? null)).toBe("completed");
    for (const id of COMMENTS) expect(task.output.answer).toContain(replyUrl(id));
  }, 120_000);
});
