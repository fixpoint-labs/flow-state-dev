/**
 * A harness session born with the tracker issue it is for (FIX-2388).
 *
 * The issue is fixed at create, like the model, and checked there: it becomes
 * a path segment and the host's branch name. The workspace is handed it on
 * the session's place. With `issueSpec` on, each turn until the harness
 * confirms a conversation opens with the issue's spec from the session's own
 * checkout; after that the conversation already has it.
 *
 * Red states produced before these were trusted:
 *   - `createCheck` without the issue check: a path-climbing issue is stored.
 *   - the brief step's binding guard dropped: the second turn repeats the spec.
 *   - `placeOf` without the issue: the workspace never sees it.
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_ORG_ID, handler } from "@flow-state-dev/core";
import type { HarnessBlock, HarnessCallbackContext } from "@flow-state-dev/core/types";
import { createFlowApiRouter, createFlowRegistry, createInMemoryStores, runAction } from "@flow-state-dev/engine";
import { afterAll, describe, expect, it } from "vitest";
import { z } from "zod";

import {
  HARNESS_SESSION_ISSUE_REFUSED,
  harnessSessionFlow,
  readIssueSpecSection,
  ISSUE_SPEC_MAX_BYTES,
  type HarnessSessionFeeds,
  type HarnessSessionFlowOptions,
  type HarnessSessionPlace,
  type HarnessSessionWorkspace,
} from "../src";

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const ISSUE = "FIX-9001";
const MARKER = "periwinkle-anchor";

/** A checkout holding the issue's spec, and a host that hands it to every session, logging each place. */
function specWorkspace(): HarnessSessionWorkspace & { places: HarnessSessionPlace[]; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "harness-issue-session-"));
  dirs.push(dir);
  mkdirSync(join(dir, "specs/issues", ISSUE), { recursive: true });
  writeFileSync(join(dir, "specs/issues", ISSUE, "SPEC.md"), `# ${ISSUE}\n\nOnly this spec says ${MARKER}.\n`);
  const places: HarnessSessionPlace[] = [];
  return {
    dir,
    places,
    provision: async (place) => {
      places.push(place);
      return dir;
    },
    locate: () => dir,
    branch: () => null,
  };
}

/** A harness that records each prompt and confirms a conversation, as a real one does on its first turn. */
function recordingAgent(prompts: string[]) {
  return (feeds: HarnessSessionFeeds) =>
    handler({
      name: "recording-harness",
      inputSchema: z.object({ prompt: z.string() }),
      execute: async (input, ctx) => {
        const harnessCtx = ctx as unknown as HarnessCallbackContext;
        prompts.push(input.prompt);
        await feeds.cwd(harnessCtx);
        const asked = await feeds.resume(harnessCtx);
        await feeds.onSession(asked ?? "conv-1", harnessCtx);
        return { outcome: "completed" };
      },
    }) as unknown as HarnessBlock;
}

/** One turn of `sessionId`, born with `state` the first time. */
async function turn(
  stores: ReturnType<typeof createInMemoryStores>,
  options: Omit<HarnessSessionFlowOptions, "kind">,
  sessionId: string,
  prompt: string,
  state: Record<string, unknown>,
) {
  if ((await stores.session.get(sessionId)) === undefined) {
    const now = Date.now();
    await stores.session.set(
      sessionId,
      { id: sessionId, flowKind: "stub-session", userId: "u", orgId: DEFAULT_ORG_ID, metadata: undefined, latestRequestId: undefined, state, version: 0, createdAt: now, updatedAt: now, journal: [] } as never,
      "any" as never,
    );
  }
  const result = await runAction({
    flow: harnessSessionFlow({ kind: "stub-session", ...options }),
    actionName: "turn",
    input: { prompt },
    userId: "u",
    orgId: DEFAULT_ORG_ID,
    sessionId,
    stores,
    runtimeConfig: {},
  } as never);
  return result as { error?: unknown };
}

describe("a session born with its issue", () => {
  it("opens its first turn with the issue's spec, and later turns with the person's words alone", async () => {
    const prompts: string[] = [];
    const workspace = specWorkspace();
    const stores = createInMemoryStores();
    const options = { workspace, agent: recordingAgent(prompts), issueSpec: true };
    await turn(stores, options, "s-1", "Implement it.", { model: "m", issue: ISSUE });
    await turn(stores, options, "s-1", "Now add a test.", { model: "m", issue: ISSUE });

    expect(prompts).toHaveLength(2);
    expect(prompts[0]!.startsWith(`## This work is for issue ${ISSUE}`)).toBe(true);
    expect(prompts[0]).toContain(MARKER);
    expect(prompts[0]!.endsWith("Implement it.")).toBe(true);
    // The conversation the harness confirmed already holds the spec.
    expect(prompts[1]).toBe("Now add a test.");
  });

  it("hands the workspace the issue on the session's place, so a host can name the branch after it", async () => {
    const workspace = specWorkspace();
    await turn(createInMemoryStores(), { workspace, agent: recordingAgent([]) }, "s-2", "Go.", { model: "m", issue: ISSUE });
    expect(workspace.places[0]).toEqual({ flowKind: "stub-session", sessionId: "s-2", issue: ISSUE });
  });

  it("gets no spec when the host leaves the brief off", async () => {
    const prompts: string[] = [];
    await turn(createInMemoryStores(), { workspace: specWorkspace(), agent: recordingAgent(prompts) }, "s-3", "Go.", { model: "m", issue: ISSUE });
    expect(prompts).toEqual(["Go."]);
  });

  it("gets no spec, and no issue on its place, when it names none", async () => {
    const prompts: string[] = [];
    const workspace = specWorkspace();
    await turn(createInMemoryStores(), { workspace, agent: recordingAgent(prompts), issueSpec: true }, "s-4", "Go.", { model: "m" });
    expect(prompts).toEqual(["Go."]);
    expect(workspace.places[0]).toEqual({ flowKind: "stub-session", sessionId: "s-4" });
  });
});

describe("creating a session with an issue", () => {
  function boot() {
    const registry = createFlowRegistry();
    const stores = createInMemoryStores();
    registry.register(harnessSessionFlow({ kind: "stub-session", workspace: specWorkspace(), agent: recordingAgent([]) }));
    return { router: createFlowApiRouter({ registry, stores, staleSweepIntervalMs: 0 }), stores };
  }

  async function create(router: ReturnType<typeof boot>["router"], state: Record<string, unknown>) {
    const res = await router.POST(
      new Request("http://localhost/api/flows/stub-session/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: "u", state }),
      }),
      { params: { path: ["stub-session", "sessions"] } },
    );
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  }

  it("refuses an issue that could climb out of a directory or break a branch name, and writes nothing", async () => {
    const { router, stores } = boot();
    for (const issue of ["../etc", "FIX 1", "a/b", "fix.lock"]) {
      const refused = await create(router, { model: "m", issue });
      expect(refused.status, issue).toBe(400);
      expect(refused.body.error).toBe(HARNESS_SESSION_ISSUE_REFUSED);
    }
    expect(await stores.session.list({})).toHaveLength(0);
  });

  it("creates a session with a tracker key, and one with no issue at all", async () => {
    const { router } = boot();
    expect((await create(router, { model: "m", issue: ISSUE })).status).toBe(201);
    expect((await create(router, { model: "m" })).status).toBe(201);
  });
});

describe("the spec section", () => {
  it("says in one line that an issue has no spec, rather than failing", async () => {
    const dir = mkdtempSync(join(tmpdir(), "harness-issue-nospec-"));
    dirs.push(dir);
    expect(await readIssueSpecSection(dir, "FIX-1")).toContain("There is no spec for it at specs/issues/FIX-1/SPEC.md");
  });

  it("refuses a path that leaves the checkout, and reads nothing", async () => {
    const section = await readIssueSpecSection(specWorkspace().dir, ISSUE, { path: () => "../outside.md" });
    expect(section).toContain("is outside this checkout");
  });

  it("cuts a spec over the cap and says so", async () => {
    const dir = mkdtempSync(join(tmpdir(), "harness-issue-big-"));
    dirs.push(dir);
    mkdirSync(join(dir, "specs/issues/FIX-2"), { recursive: true });
    writeFileSync(join(dir, "specs/issues/FIX-2/SPEC.md"), `${"x".repeat(ISSUE_SPEC_MAX_BYTES)}TAIL`);
    const section = await readIssueSpecSection(dir, "FIX-2");
    expect(section).not.toContain("TAIL");
    expect(section).toContain("was cut here");
  });
});
