/**
 * Which coder a served Lab starts with, and what it says (V2; BR-6 to BR-12).
 *
 * Each profile names its default: DevTeam the scripted run, `fsd` Claude
 * Code. `DEVFORCE_LAB_HARNESS` overrides it. On Claude Code the Lab asks
 * Claude Code for an account before it listens, through a probe scripted here,
 * and refuses when there is none. There are two outcomes, run or refuse: no
 * answer from the probe ever yields the scripted run.
 */
import { describe, expect, it } from "vitest";
import type { ClaudeAccountProbe } from "@flow-state-dev/claude-code/sdk";
import type { CodexAccountProbe } from "@flow-state-dev/codex";
import type { CursorSignIn } from "@flow-state-dev/cursor";
import { HARNESS_ENV, RUN_MINUTES_ENV, SCRIPTED_RUN_TIMEOUT_MS, startHarness, type HarnessChoice } from "../teams/devteam/harness.mts";

/** Start with `value` as the variable and a probe that answers `answer`; report what happened. */
async function start(
  defaultChoice: HarnessChoice,
  value: string | undefined,
  answer?: ClaudeAccountProbe | CodexAccountProbe | CursorSignIn,
  runMinutes?: string,
) {
  const lines: string[] = [];
  let probed = 0;
  // One scripted answer serves whichever harness is asked; a case that names no answer must not ask.
  const probe = async (): Promise<any> => {
    probed += 1;
    if (answer === undefined) throw new Error("this case should not probe");
    return answer;
  };
  try {
    const harness = await startHarness(defaultChoice, {
      value,
      stepMs: "0",
      runMinutes,
      probe,
      probeCodex: probe,
      probeCursor: probe,
      log: (line) => lines.push(line),
    });
    return { harness, lines, probed, refused: undefined };
  } catch (error) {
    return { harness: undefined, lines, probed, refused: (error as Error).message };
  }
}

const ACCOUNT: ClaudeAccountProbe = { status: "account", tokenSource: "claude.ai" };
const NONE: ClaudeAccountProbe = { status: "none", reason: "Claude Code found no API key and no sign-in" };
const SDK_MISSING: ClaudeAccountProbe = { status: "sdk-missing", reason: "@anthropic-ai/claude-agent-sdk could not be loaded: not found" };

describe("the fsd profile's coder (default claude-code)", () => {
  it.each([undefined, "", "  "])("BR-6: %j with an account is Claude Code, and the start line says so", async (value) => {
    const started = await start("claude-code", value, ACCOUNT);
    expect(started.harness?.name).toBe("claude-code");
    expect(started.probed).toBe(1);
    expect(started.lines).toEqual([`Coder: Claude Code, on the credential from claude.ai; each run may take 20 minutes (${RUN_MINUTES_ENV}).`]);
  });

  it("names a subscription sign-in, which carries no key or token source, by its plan", async () => {
    const subscription: ClaudeAccountProbe = { status: "account", email: "a@b.c", subscriptionType: "Claude Max" };
    const started = await start("claude-code", undefined, subscription);
    expect(started.lines).toEqual([`Coder: Claude Code, on the credential from a Claude Max sign-in; each run may take 20 minutes (${RUN_MINUTES_ENV}).`]);
  });

  it("BR-7: with no account it refuses, naming what to set, and says nothing about a coder", async () => {
    const started = await start("claude-code", undefined, NONE);
    expect(started.harness).toBeUndefined();
    expect(started.refused).toContain("Claude Code found no API key and no sign-in");
    expect(started.refused).toContain("Sign in to Claude Code, or set ANTHROPIC_API_KEY");
    expect(started.refused).toContain(`${HARNESS_ENV}=stub`);
    expect(started.lines).toEqual([]);
  });

  it("BR-8: with the Agent SDK missing it refuses the same way, saying the SDK is missing", async () => {
    const started = await start("claude-code", undefined, SDK_MISSING);
    expect(started.harness).toBeUndefined();
    expect(started.refused).toContain("The Claude Code Agent SDK is missing");
    expect(started.refused).toContain(`${HARNESS_ENV}=stub`);
  });

  it("BR-9: stub is the scripted run with no credential check, and the start line names the script", async () => {
    const started = await start("claude-code", "stub");
    expect(started.harness?.name).toBe("stub");
    expect(started.probed).toBe(0);
    expect(started.lines).toEqual([`Coder: the scripted run, no model (${HARNESS_ENV}=stub).`]);
  });

  it("BR-10: claude-code is the same as unset: Claude Code, with the check", async () => {
    expect((await start("claude-code", "claude-code", ACCOUNT)).harness?.name).toBe("claude-code");
    const refused = await start("claude-code", "claude-code", NONE);
    expect(refused.probed).toBe(1);
    expect(refused.refused).toContain("ANTHROPIC_API_KEY");
  });

  it("BR-11: any other name is refused, naming the four choices", async () => {
    const started = await start("claude-code", "gemini");
    expect(started.refused).toBe(`${HARNESS_ENV}="gemini" names no harness this Lab can run; use one of stub, claude-code, codex, cursor.`);
    expect(started.probed).toBe(0);
  });

  it("BR-12: no probe answer but an account starts anything, and nothing falls back to the script", async () => {
    for (const answer of [NONE, SDK_MISSING]) {
      const started = await start("claude-code", undefined, answer);
      expect(started.harness).toBeUndefined();
      expect(started.refused).toBeDefined();
    }
  });
});

describe("DevTeam's coder (default stub)", () => {
  it("unset is the scripted run, as before, with no credential check", async () => {
    const started = await start("stub", undefined);
    expect(started.harness?.name).toBe("stub");
    expect(started.probed).toBe(0);
  });

  it("claude-code is checked the same way the fsd profile checks it", async () => {
    const started = await start("stub", "claude-code", NONE);
    expect(started.refused).toContain("ANTHROPIC_API_KEY");
  });
});

describe("Codex and Cursor as the coder", () => {
  it("codex with a sign-in is Codex, and the start line names where its credential comes from", async () => {
    const started = await start("claude-code", "codex", { status: "account", source: "login" });
    expect(started.harness?.name).toBe("codex");
    expect(started.probed).toBe(1);
    expect(started.lines).toEqual([`Coder: Codex, on its saved login; each run may take 20 minutes (${RUN_MINUTES_ENV}).`]);
  });

  it("cursor with a key is Cursor", async () => {
    const started = await start("stub", "cursor", { status: "key" });
    expect(started.harness?.name).toBe("cursor");
    expect(started.lines).toEqual([`Coder: Cursor, on CURSOR_API_KEY; each run may take 20 minutes (${RUN_MINUTES_ENV}).`]);
  });

  // A Lab that quietly ran the stub would report a model's work that no model did.
  it.each([
    ["codex", { status: "none", reason: "Codex found no sign-in" }, "codex login"],
    ["cursor", { status: "none", reason: "no CURSOR_API_KEY in the run's environment and no stored login" }, "CURSOR_API_KEY"],
  ] as const)("%s with no sign-in refuses, naming what to set, and never falls back to the script", async (value, answer, fix) => {
    const started = await start("claude-code", value, answer as never);
    expect(started.harness).toBeUndefined();
    expect(started.refused).toContain(answer.reason);
    expect(started.refused).toContain(fix);
    expect(started.lines).toEqual([]);
  });
});

describe("one run's budget", () => {
  it("is 20 minutes on a real harness and the stub's own minute when unset, so a real FSD issue isn't cut off at 10", async () => {
    expect((await start("claude-code", undefined, ACCOUNT)).harness?.runTimeoutMs).toBe(20 * 60_000);
    expect((await start("stub", undefined)).harness?.runTimeoutMs).toBe(SCRIPTED_RUN_TIMEOUT_MS);
  });

  it("takes the setting for every harness, and the start line says it", async () => {
    const started = await start("claude-code", undefined, ACCOUNT, "45");
    expect(started.harness?.runTimeoutMs).toBe(45 * 60_000);
    expect(started.lines[0]).toContain(`each run may take 45 minutes (${RUN_MINUTES_ENV})`);
    expect((await start("stub", undefined, undefined, "3")).harness?.runTimeoutMs).toBe(3 * 60_000);
  });

  it.each(["0", "-5", "1.5", "an hour"])("refuses %j at start rather than guess, before asking for a sign-in", async (raw) => {
    const started = await start("claude-code", undefined, ACCOUNT, raw);
    expect(started.refused).toBe(`${RUN_MINUTES_ENV}="${raw}" is not a positive whole number of minutes.`);
    expect(started.probed).toBe(0);
  });
});
