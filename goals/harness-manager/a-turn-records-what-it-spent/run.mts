/**
 * Goal check — harness-manager › a turn records what it spent (FIX-2398).
 *
 * A real Claude Code turn runs through `harnessSessionFlow`, signed in with an
 * API key so the vendor reports a charge. The check reads the turn's record
 * from session state, the record a page reads, and never the harness's handle
 * or its spend report: a report that never reaches the record is the failure
 * this guards against.
 *
 * Legs:
 *   - **t**: a completed turn's `spend` names the model, has tokens and a
 *     charge above zero, and `endedAt` is at or after the turn's start.
 *   - **s**: a turn stopped mid-run still has `spend`, naming Claude Code.
 *
 * Control: the same script run from a worktree of `main`, whose flow writes
 * no turn spend. **t** and **s** FAIL on `spend` being missing. The flow
 * writes the spend inside its turn, where nothing outside the package can
 * switch it off, so the baseline is the control.
 *
 * Run: pnpm tsx goals/harness-manager/a-turn-records-what-it-spent/run.mts
 */
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_ORG_ID, harnessEnv } from "@flow-state-dev/core";
import { claudeCodeAgent } from "@flow-state-dev/claude-code/sdk";
import { createInMemoryStores, runAction } from "@flow-state-dev/engine";
import { harnessSessionFlow, type HarnessSessionState, type HarnessTurnRecord } from "@flow-state-dev/harness-manager";
import { runGoal } from "../../lib/index.mts";

if ((process.env.ANTHROPIC_API_KEY ?? "") === "" && (process.env.MY_ANTHROPIC_API_KEY ?? "") !== "") {
  process.env.ANTHROPIC_API_KEY = process.env.MY_ANTHROPIC_API_KEY;
}
const MODEL = process.env.GOAL_CLAUDE_MODEL ?? "claude-haiku-4-5";
const STOP_AFTER_MS = 8_000;

await runGoal(async (failures) => {
  if ((process.env.ANTHROPIC_API_KEY ?? "") === "") {
    return { failures: ["blocked: no ANTHROPIC_API_KEY (or MY_ANTHROPIC_API_KEY): the check needs an API-key sign-in so a charge is reported"], evidence: "" };
  }
  const scratch = mkdtempSync(join(tmpdir(), "turn-spend-"));
  const flow = harnessSessionFlow({
    kind: "turn-spend-goal",
    workspace: { provision: async () => scratch, locate: () => scratch, branch: () => null },
    agent: (feeds) =>
      claudeCodeAgent({
        ...feeds,
        // Only what the run needs: its sign-in and a shell's basics. No tools, so a turn is a reply.
        env: harnessEnv({ pass: ["PATH", "HOME", "USER", "TMPDIR", "ANTHROPIC_API_KEY", "ANTHROPIC_BASE_URL", "HTTPS_PROXY", "NODE_EXTRA_CA_CERTS"] }),
        allowedTools: [],
        disallowedTools: ["Bash", "Read", "Write", "Edit", "Grep", "Glob", "WebFetch", "WebSearch", "Task", "TodoWrite"],
        settingSources: [],
        detached: true,
      } as never) as never,
  });

  const stores = createInMemoryStores();
  const born = async (sessionId: string) => {
    const now = Date.now();
    await stores.session.set(
      sessionId,
      { id: sessionId, flowKind: "turn-spend-goal", userId: "goal-user", orgId: DEFAULT_ORG_ID, metadata: undefined, latestRequestId: undefined, state: { model: MODEL }, version: 0, createdAt: now, updatedAt: now, journal: [] } as never,
      "any" as never,
    );
  };
  const turnOf = (sessionId: string, prompt: string, signal?: AbortSignal) =>
    runAction({ flow, actionName: "turn", input: { prompt }, userId: "goal-user", orgId: DEFAULT_ORG_ID, sessionId, stores, runtimeConfig: {}, ...(signal ? { signal } : {}) } as never);
  const recordOf = async (sessionId: string): Promise<HarnessTurnRecord | undefined> => {
    const state = (await stores.session.get(sessionId))?.state as HarnessSessionState | undefined;
    return Object.values(state?.turns ?? {})[0];
  };

  const evidence: string[] = [];
  try {
    // t — a completed turn.
    const token = randomBytes(6).toString("hex");
    await born("goal-t");
    await turnOf("goal-t", `Reply with exactly this token and nothing else: ${token}`);
    const t = await recordOf("goal-t");
    const tSpend = t?.spend ?? null;
    evidence.push(`t: ${JSON.stringify(tSpend)} took ${t?.endedAt != null && t.at != null ? t.endedAt - t.at : "?"} ms`);
    if (t === undefined) failures.push("t: the turn left no record");
    else if (t.error !== null) failures.push(`t: the turn failed: ${t.error}`);
    if (tSpend === null) failures.push("t: the completed turn's record has no spend");
    else {
      if (tSpend.model === null) failures.push("t: the spend names no model");
      if ((tSpend.inputTokens ?? 0) + (tSpend.outputTokens ?? 0) <= 0) failures.push(`t: no tokens recorded (${tSpend.inputTokens} in, ${tSpend.outputTokens} out)`);
      if (!(typeof tSpend.costUsd === "number" && tSpend.costUsd > 0)) failures.push(`t: no charge recorded on an API-key run (costUsd ${tSpend.costUsd})`);
    }
    if (t !== undefined && (t.endedAt == null || t.at == null || t.endedAt < t.at)) failures.push(`t: endedAt ${t.endedAt} is not at or after the start ${t.at}`);

    // s — a turn stopped mid-run.
    await born("goal-s");
    const stop = new AbortController();
    const timer = setTimeout(() => stop.abort(new Error("stopped by the goal check")), STOP_AFTER_MS);
    await turnOf("goal-s", "Count from 1 to 3000, one number per line, with no other text.", stop.signal).catch(() => undefined);
    clearTimeout(timer);
    const s = await recordOf("goal-s");
    evidence.push(`s: stopped=${s?.stopped} error=${JSON.stringify(s?.error)} spend=${JSON.stringify(s?.spend ?? null)}`);
    if (s === undefined) failures.push("s: the stopped turn left no record");
    else if (s.spend == null) failures.push("s: the stopped turn's record has no spend");
    else if (s.spend.harness !== "claude-code") failures.push(`s: the stopped turn's spend names ${s.spend.harness}, not claude-code`);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  return { failures, evidence: evidence.join(" · ") };
});
