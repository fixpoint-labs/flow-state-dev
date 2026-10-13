/**
 * The harness gate: which Kitchen Sink modes can run on this host, and why not
 * (`specs/issues/FIX-1914/PLAN.md` V1, V2; BUSINESS-RULES BR-5 to BR-15).
 *
 * V1 runs each rule on real temporary directories made with `git init`, never
 * a stubbed filesystem: "the top level of a git checkout" is a fact about the
 * disk. V2 drives the real flow API router, so "not found" is what a caller of
 * `/api/flows/<kind>/…` actually gets, not only what the flow list holds.
 *
 * Red states produced before these were trusted:
 *   - let `KITCHEN_SINK_HARNESS_WORKSPACE` win over `VERCEL`: both Vercel cases fail.
 *   - accept any directory inside a checkout: the inside-a-checkout case fails.
 *   - read production as development: the unset-in-production case fails.
 *   - drop the "not built yet" step: the BR-9, BR-12 and gate-open cases fail, and V2 serves an unbuilt flow.
 *   - drop the memo: both once-per-start cases fail.
 *   - register a mode's flow whatever its availability: every V2 refusal case fails.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { defineFlow, handler } from "@flow-state-dev/core";
import { createFlowApiRouter, createFlowRegistry, createInMemoryStores } from "@flow-state-dev/engine";
import { z } from "zod";

import {
  availableHarnessFlows,
  decideAvailability,
  MODE_CHECKS,
  modeAvailability,
  NOT_BUILT_YET,
  resetModeAvailabilityForTests,
  type ModeCheck,
} from "@/lib/harness-gate";
import { readHarnessWorkspace } from "@/lib/harness-workspace";
import { MODES, type KitchenSinkMode } from "@/lib/modes";

const SETTING = "KITCHEN_SINK_HARNESS_WORKSPACE";

let scratch: string;
let checkout: string;
let inside: string;
let plain: string;

beforeAll(() => {
  scratch = mkdtempSync(join(tmpdir(), "ks-harness-gate-"));
  checkout = join(scratch, "repo");
  inside = join(checkout, "packages", "app");
  plain = join(scratch, "plain");
  mkdirSync(inside, { recursive: true });
  mkdirSync(plain);
  execFileSync("git", ["init", "-q", checkout]);
});

afterAll(() => rmSync(scratch, { recursive: true, force: true }));

afterEach(() => {
  vi.unstubAllEnvs();
  resetModeAvailabilityForTests();
});

/** The modes with every harness mode built, so the checks after "not built yet" are reached. */
const BUILT: readonly KitchenSinkMode[] = MODES.map((mode) =>
  mode.id === "flow-state" ? mode : { ...mode, flowKind: `${mode.id}-session` },
);

/** The modes with Codex not built, so "not built yet" has a mode to say it of. */
const UNBUILT_CODEX: readonly KitchenSinkMode[] = MODES.map((mode) =>
  mode.id === "codex" ? { id: mode.id, label: mode.label, href: mode.href } : mode,
);

describe("V1 · readHarnessWorkspace", () => {
  it("BR-6: off on Vercel, even when the setting names a checkout", () => {
    const read = readHarnessWorkspace({ VERCEL: "1", [SETTING]: checkout }, checkout);
    expect(read.ok).toBe(false);
    expect(!read.ok && read.reason).toMatch(/local machine/);
  });

  it("BR-7: unset in development, the top level of the checkout the server runs from", () => {
    expect(readHarnessWorkspace({ NODE_ENV: "development" }, inside)).toEqual({ ok: true, repository: checkout });
    expect(readHarnessWorkspace({}, checkout)).toEqual({ ok: true, repository: checkout });
  });

  it("BR-7: unset in development outside any checkout, off naming the setting", () => {
    const read = readHarnessWorkspace({ NODE_ENV: "development" }, plain);
    expect(read.ok).toBe(false);
    expect(!read.ok && read.reason).toMatch(/not running in a git checkout/);
    expect(!read.ok && read.reason).toContain(SETTING);
  });

  it("BR-7: unset in production, off naming the setting, even inside a checkout", () => {
    const read = readHarnessWorkspace({ NODE_ENV: "production" }, inside);
    expect(read.ok).toBe(false);
    expect(!read.ok && read.reason).toMatch(/production server/);
    expect(!read.ok && read.reason).toContain(SETTING);
  });

  it("set to a checkout's top level, that checkout, in production too", () => {
    expect(readHarnessWorkspace({ NODE_ENV: "production", [SETTING]: checkout }, plain)).toEqual({
      ok: true,
      repository: checkout,
    });
  });

  it("BR-8: set to a path that does not exist, off naming the path", () => {
    const missing = join(scratch, "gone");
    const read = readHarnessWorkspace({ [SETTING]: missing }, checkout);
    expect(!read.ok && read.reason).toContain(`${missing}, which does not exist`);
  });

  it("BR-8: set to a directory that is not a git repository, off naming the path", () => {
    const read = readHarnessWorkspace({ [SETTING]: plain }, checkout);
    expect(!read.ok && read.reason).toContain(`${plain}, which is not a git repository`);
  });

  it("BR-8: set to a file, off as not a git repository", () => {
    const file = join(plain, "notes.txt");
    writeFileSync(file, "");
    const read = readHarnessWorkspace({ [SETTING]: file }, checkout);
    expect(!read.ok && read.reason).toContain("not a git repository");
  });

  it("BR-8: set to a directory inside a checkout, off naming the top level to use", () => {
    const read = readHarnessWorkspace({ [SETTING]: inside }, plain);
    expect(!read.ok && read.reason).toContain(`${inside}, which is inside the checkout at ${checkout}, not its top level`);
  });
});

describe("V1 · decideAvailability", () => {
  const on = { ok: true, repository: "/repo" } as const;
  const off = { ok: false, reason: "host is off" } as const;

  it("BR-5: Flow State is available whatever the host", async () => {
    for (const workspace of [on, off]) {
      expect((await decideAvailability({ workspace, modes: BUILT, checks: {}, gateOpen: false }))["flow-state"]).toEqual({
        available: true,
      });
    }
  });

  it("BR-9: with the host on, a mode with no flow kind is not built yet", async () => {
    const decided = await decideAvailability({ workspace: on, modes: UNBUILT_CODEX, checks: {}, gateOpen: false });
    expect(decided.codex).toEqual({ available: false, reason: NOT_BUILT_YET });
    // Claude Code and Cursor modes are built: with no check of their own given here, they are available.
    expect(decided["claude-code"]).toEqual({ available: true });
    expect(decided.cursor).toEqual({ available: true });
  });

  it("BR-10: with the host on and the mode built, its own check decides, handed the repository", async () => {
    const seen: string[] = [];
    const decided = await decideAvailability({
      workspace: on,
      modes: BUILT,
      checks: {
        "claude-code": ({ repository }) => (seen.push(repository), { available: true }),
        codex: async () => ({ available: false, reason: "Sign in to Codex first." }),
      },
      gateOpen: false,
    });
    expect(decided["claude-code"]).toEqual({ available: true });
    expect(decided.codex).toEqual({ available: false, reason: "Sign in to Codex first." });
    expect(decided.cursor).toEqual({ available: true });
    expect(seen).toEqual(["/repo"]);
  });

  it("BR-11: a check that throws makes its mode unavailable with the message, and the others still decide", async () => {
    const decided = await decideAvailability({
      workspace: on,
      modes: BUILT,
      checks: {
        codex: () => {
          throw new Error("the SDK is not installed");
        },
      },
      gateOpen: false,
    });
    expect(decided.codex).toEqual({ available: false, reason: "the SDK is not installed" });
    expect(decided["claude-code"]).toEqual({ available: true });
    expect(decided["flow-state"]).toEqual({ available: true });
  });

  it("BR-12: only the first reason: the host before not-built-yet before the mode's own check", async () => {
    const failing: ModeCheck = () => ({ available: false, reason: "own check" });
    const hostOff = await decideAvailability({ workspace: off, modes: BUILT, checks: { codex: failing }, gateOpen: false });
    expect(hostOff.codex).toEqual({ available: false, reason: "host is off" });
    const unbuilt = await decideAvailability({ workspace: on, modes: UNBUILT_CODEX, checks: { codex: failing }, gateOpen: false });
    expect(unbuilt.codex).toEqual({ available: false, reason: NOT_BUILT_YET });
  });

  it("BR-12: on Vercel with a bad setting, the Vercel reason", async () => {
    const decided = await decideAvailability({
      workspace: readHarnessWorkspace({ VERCEL: "1", [SETTING]: plain }, plain),
      modes: BUILT,
      checks: {},
      gateOpen: false,
    });
    expect(decided.codex.available === false && decided.codex.reason).toMatch(/local machine/);
  });

  it("gate-open skips the host and each mode's own check, but not 'not built yet'", async () => {
    const failing: ModeCheck = () => ({ available: false, reason: "own check" });
    const built = await decideAvailability({ workspace: off, modes: BUILT, checks: { codex: failing }, gateOpen: true });
    expect(built.codex).toEqual({ available: true });
    const unbuilt = await decideAvailability({ workspace: off, modes: UNBUILT_CODEX, checks: {}, gateOpen: true });
    expect(unbuilt.codex).toEqual({ available: false, reason: NOT_BUILT_YET });
  });

  it("gate-open is read only in a test-mode build", async () => {
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("GOAL_CONTROL", "gate-open");
    vi.stubEnv("KITCHEN_SINK_TEST_MODE", "");
    const decided = await decideAvailability({ modes: BUILT, checks: {} });
    expect(decided.codex.available).toBe(false);
    vi.stubEnv("KITCHEN_SINK_TEST_MODE", "1");
    expect((await decideAvailability({ modes: BUILT, checks: {} })).codex.available).toBe(true);
  });
});

describe("V1 · BR-13 · decided once per server start", () => {
  it("reads the host once: a change to the setting shows only after a restart", async () => {
    vi.stubEnv("VERCEL", "");
    vi.stubEnv(SETTING, plain);
    await withUnbuiltCodex(async () => {
      const first = await modeAvailability();
      expect(first.codex.available === false && first.codex.reason).toContain("not a git repository");
      vi.stubEnv(SETTING, checkout);
      expect(await modeAvailability()).toBe(first);
      resetModeAvailabilityForTests(); // the restart
      expect((await modeAvailability()).codex).toEqual({ available: false, reason: NOT_BUILT_YET });
    });
  });

  it("runs a mode's own check once, however many readers ask", async () => {
    const check = vi.fn<ModeCheck>(() => ({ available: true }));
    vi.stubEnv("VERCEL", "");
    vi.stubEnv(SETTING, checkout);
    await withBuiltCodex(check, async () => {
      await Promise.all([modeAvailability(), modeAvailability(), availableHarnessFlows({})]);
      expect(check).toHaveBeenCalledTimes(1);
    });
  });
});

/**
 * Run one case with Codex's mode entry built or not, and `check` as its own
 * check (none when `undefined`); as shipped again after.
 */
async function withCodex(built: boolean, check: ModeCheck | undefined, run: () => Promise<void>): Promise<void> {
  const modes = MODES as KitchenSinkMode[];
  const index = modes.findIndex((mode) => mode.id === "codex");
  const shipped = modes[index]!;
  const shippedCheck = MODE_CHECKS.codex;
  modes[index] = built ? { ...shipped, flowKind: "codex-session" } : UNBUILT_CODEX[index]!;
  if (check !== undefined) MODE_CHECKS.codex = check;
  else delete MODE_CHECKS.codex;
  try {
    await run();
  } finally {
    modes[index] = shipped;
    if (shippedCheck !== undefined) MODE_CHECKS.codex = shippedCheck;
    else delete MODE_CHECKS.codex;
  }
}

/** Codex built, with `check` as its own check (none when `undefined`), for one case. */
const withBuiltCodex = (check: ModeCheck | undefined, run: () => Promise<void>) => withCodex(true, check, run);

/** Codex not built, for one case. */
const withUnbuiltCodex = (run: () => Promise<void>) => withCodex(false, undefined, run);

describe("V2 · BR-15 · an unavailable mode's flow is not served", () => {
  /** A stand-in harness flow, at the kind a built mode would have. */
  const standIn = () =>
    defineFlow({
      kind: "codex-session",
      actions: {
        run: {
          inputSchema: z.object({ message: z.string() }),
          block: handler({ name: "codex-standin", inputSchema: z.object({ message: z.string() }), execute: () => "ran" }),
        },
      },
    })();

  /** The real router over what the gate let through, and the status of creating a session on the stand-in. */
  async function served(): Promise<number> {
    const flows = await availableHarnessFlows({ codex: standIn });
    const registry = createFlowRegistry();
    for (const flow of Object.values(flows)) registry.register(flow);
    const router = createFlowApiRouter({ registry, stores: createInMemoryStores() });
    const res = await router.POST(
      new Request("http://localhost/api/flows/codex-session/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: "s-gate", userId: "devuser" }),
      }),
      { params: { path: ["codex-session", "sessions"] } },
    );
    return res.status;
  }

  it("serves the flow when the mode is available", async () => {
    vi.stubEnv("VERCEL", "");
    vi.stubEnv(SETTING, checkout);
    await withBuiltCodex(undefined, async () => {
      expect(await served()).toBe(201);
    });
  });

  it("does not serve it when the host is off", async () => {
    vi.stubEnv("VERCEL", "1");
    await withBuiltCodex(undefined, async () => {
      expect(await served()).toBe(404);
    });
  });

  it("does not serve it when the mode's own check fails, or throws, with the host on", async () => {
    vi.stubEnv("VERCEL", "");
    vi.stubEnv(SETTING, checkout);
    await withBuiltCodex(() => ({ available: false, reason: "not signed in" }), async () => {
      expect(await served()).toBe(404);
    });
    resetModeAvailabilityForTests();
    await withBuiltCodex(() => {
      throw new Error("probe crashed");
    }, async () => {
      expect(await served()).toBe(404);
    });
  });

  it("does not serve it while the mode is not built", async () => {
    vi.stubEnv("VERCEL", "");
    vi.stubEnv(SETTING, checkout);
    await withUnbuiltCodex(async () => {
      expect(await served()).toBe(404);
    });
  });
});
