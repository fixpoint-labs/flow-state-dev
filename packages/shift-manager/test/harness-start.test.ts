/**
 * Which coder a served Lab starts with, and what it says (V2; BR-6 to BR-12;
 * FIX-2391).
 *
 * Each profile names its default: DevTeam the scripted run, `fsd` Claude
 * Code. `DEVFORCE_LAB_HARNESS` overrides it. Whether Claude Code can run here
 * never stops a start: the Lab logs which harnesses can run, with what to run
 * for one that can't, through a check scripted here, and serves the same rows
 * on request. No answer from the check ever yields the scripted run.
 *
 * Red states produced before these were trusted:
 *   - throw on a not-ready Claude Code (the old refusal): the BR-7 and BR-8 cases fail.
 *   - keep the start's rows for a refresh: the re-check case fails.
 */
import { describe, expect, it } from "vitest";
import type { HarnessReadiness } from "@flow-state-dev/core/types";
import { HARNESS_ENV, RUN_MINUTES_ENV, SCRIPTED_RUN_TIMEOUT_MS, startHarness, type HarnessChoice } from "../teams/devteam/harness.mts";

/** Start with `value` as the variable and a check that answers `answers` in turn; report what happened. */
async function start(
  defaultChoice: HarnessChoice,
  value: string | undefined,
  answers: HarnessReadiness[] = [],
  runMinutes?: string,
) {
  const lines: string[] = [];
  let checked = 0;
  const check = async () => {
    const answer = answers[Math.min(checked, answers.length - 1)];
    checked += 1;
    if (answer === undefined) throw new Error("this case should not check");
    return answer;
  };
  try {
    const harness = await startHarness(defaultChoice, {
      value,
      stepMs: "0",
      runMinutes,
      check,
      log: (line) => lines.push(line),
    });
    return { harness, lines, checked: () => checked, refused: undefined };
  } catch (error) {
    return { harness: undefined, lines, checked: () => checked, refused: (error as Error).message };
  }
}

const READY: HarnessReadiness = { ready: true };
const NONE: HarnessReadiness = {
  ready: false,
  reason: "Claude Code has no credential: Claude Code found no API key and no sign-in",
  remedy: "Run `claude` and sign in, or set ANTHROPIC_API_KEY.",
};
const SDK_MISSING: HarnessReadiness = {
  ready: false,
  reason: "The Claude Code SDK is not installed: not found",
  remedy: "Install @anthropic-ai/claude-agent-sdk",
};

describe("the fsd profile's coder (default claude-code)", () => {
  it.each([undefined, "", "  "])("BR-6: %j is Claude Code, and the start says so with the readiness table", async (value) => {
    const started = await start("claude-code", value, [READY]);
    expect(started.harness?.name).toBe("claude-code");
    expect(started.checked()).toBe(1);
    expect(started.lines[0]).toBe(`Coder: Claude Code; each run may take 20 minutes (${RUN_MINUTES_ENV}).`);
    expect(started.lines[1]).toContain("✓ Claude Code");
  });

  it("BR-7: with no credential it still starts, and logs what to run before the Lab listens", async () => {
    const started = await start("claude-code", undefined, [NONE]);
    expect(started.refused).toBeUndefined();
    expect(started.harness?.name).toBe("claude-code");
    const row = started.lines.find((line) => line.includes("✗ Claude Code"));
    expect(row).toContain("found no API key and no sign-in");
    expect(row).toContain("ANTHROPIC_API_KEY");
  });

  it("BR-8: with the Agent SDK missing it starts the same way, saying the SDK is missing", async () => {
    const started = await start("claude-code", undefined, [SDK_MISSING]);
    expect(started.harness?.name).toBe("claude-code");
    expect(started.lines.find((line) => line.includes("✗ Claude Code"))).toContain("Install @anthropic-ai/claude-agent-sdk");
  });

  it("the read the Lab serves carries the reason and remedy, and checks again on refresh", async () => {
    const started = await start("claude-code", undefined, [NONE, READY]);
    expect(await started.harness!.readiness.read()).toEqual([
      expect.objectContaining({ harness: "claude-code", ready: false, remedy: NONE.ready ? null : NONE.remedy }),
    ]);
    expect(started.checked()).toBe(1);
    expect(await started.harness!.readiness.read({ refresh: true })).toEqual([expect.objectContaining({ harness: "claude-code", ready: true })]);
  });

  it("BR-9: stub is the scripted run, and the start line names the script without waiting on the check", async () => {
    const started = await start("claude-code", "stub", [NONE]);
    expect(started.harness?.name).toBe("stub");
    expect(started.lines[0]).toBe(`Coder: the scripted run, no model (${HARNESS_ENV}=stub).`);
  });

  it("BR-10: claude-code is the same as unset: Claude Code, with the check", async () => {
    const started = await start("claude-code", "claude-code", [NONE]);
    expect(started.harness?.name).toBe("claude-code");
    expect(started.checked()).toBe(1);
  });

  it("BR-11: any other name is refused, naming the four choices", async () => {
    const started = await start("claude-code", "gemini");
    expect(started.refused).toBe(`${HARNESS_ENV}="gemini" names no harness this Lab can run; use one of stub, claude-code, codex, cursor.`);
    expect(started.checked()).toBe(0);
  });

  it("BR-12: nothing falls back to the script when Claude Code can't run", async () => {
    for (const answer of [NONE, SDK_MISSING]) {
      expect((await start("claude-code", undefined, [answer])).harness?.name).toBe("claude-code");
    }
  });
});

describe("DevTeam's coder (default stub)", () => {
  it("unset is the scripted run, as before", async () => {
    const started = await start("stub", undefined, [READY]);
    expect(started.harness?.name).toBe("stub");
  });

  it("logs Claude Code's row once its check answers, since the Error Reporter runs on it", async () => {
    const started = await start("stub", undefined, [NONE]);
    await started.harness!.readiness.read();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(started.lines.some((line) => line.includes("✗ Claude Code"))).toBe(true);
  });
});

describe("Codex and Cursor as the coder", () => {
  // Readiness for every harness is reported, not refused (FIX-2391): no sign-in check is added here.
  it.each([
    ["codex", "Codex"],
    ["cursor", "Cursor"],
  ] as const)("%s starts without asking for a sign-in, and the start line says it wasn't checked", async (value, label) => {
    const started = await start("claude-code", value, [NONE]);
    expect(started.harness?.name).toBe(value);
    expect(started.lines[0]).toBe(`Coder: ${label}, not checked for a sign-in at start; each run may take 20 minutes (${RUN_MINUTES_ENV}).`);
    expect(await started.harness!.readiness.read()).toEqual([
      expect.objectContaining({ harness: "claude-code", ready: false }),
    ]);
  });
});

describe("one run's budget", () => {
  it("is 20 minutes on a real harness and the stub's own minute when unset, so a real FSD issue isn't cut off at 10", async () => {
    expect((await start("claude-code", undefined, [READY])).harness?.runTimeoutMs).toBe(20 * 60_000);
    expect((await start("stub", undefined, [READY])).harness?.runTimeoutMs).toBe(SCRIPTED_RUN_TIMEOUT_MS);
  });

  it.each(["claude-code", "codex", "cursor"] as const)("takes the setting for %s, and the start line says it", async (choice) => {
    const started = await start("claude-code", choice, [READY], "45");
    expect(started.harness?.runTimeoutMs).toBe(45 * 60_000);
    expect(started.lines[0]).toContain(`each run may take 45 minutes (${RUN_MINUTES_ENV})`);
    expect((await start("stub", undefined, [READY], "3")).harness?.runTimeoutMs).toBe(3 * 60_000);
  });

  it.each(["0", "-5", "1.5", "an hour"])("refuses %j at start rather than guess, before asking for a sign-in", async (raw) => {
    const started = await start("claude-code", undefined, [READY], raw);
    expect(started.refused).toBe(`${RUN_MINUTES_ENV}="${raw}" is not a positive whole number of minutes.`);
    expect(started.checked()).toBe(0);
  });
});

// The label is what the Shift Coordinator reads a coder runs on ("have Cursor do it"), so it must
// be the name a user types, one per choice (FIX-2487).
describe("each coder's label", () => {
  it.each([
    ["stub", "the scripted coder (no model)"],
    ["claude-code", "Claude Code"],
    ["codex", "Codex"],
    ["cursor", "Cursor"],
  ] as const)("%s is called %s", async (value, label) => {
    const started = await start("stub", value, [READY]);
    expect(started.harness?.label).toBe(label);
  });
});
