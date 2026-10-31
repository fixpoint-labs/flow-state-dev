/**
 * `probeCodexAccount` with the Codex CLI's process mocked: a key answers
 * without starting Codex (a run given one uses it whatever login is saved),
 * `codex login status`'s exit code is the answer otherwise, and a Codex that
 * never answers is told apart from one that said "not signed in", so a host
 * can say which.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const execFile = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:child_process")>()),
  execFile,
}));
const findCodexProgram = vi.hoisted(() => vi.fn());
vi.mock("../src/usage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/usage")>()),
  findCodexProgram,
}));

import { checkCodexReadiness, CODEX_SIGN_IN_REMEDY, probeCodexAccount } from "../src/account-probe";

const program = { path: "/sdk/bin/codex", pathDirs: ["/sdk/bin"] };
type Callback = (error: (Error & Record<string, unknown>) | null, stdout: string, stderr: string) => void;

/** Codex answers `login status` with `error` (null for exit 0) and what it printed. */
function codexAnswers(error: (Error & Record<string, unknown>) | null, stdout = "", stderr = "") {
  execFile.mockImplementation((_file: string, _args: string[], _options: unknown, callback: Callback) => {
    callback(error, stdout, stderr);
  });
}

function failure(fields: Record<string, unknown>, message = "Command failed"): Error & Record<string, unknown> {
  return Object.assign(new Error(message), fields);
}

beforeEach(() => {
  findCodexProgram.mockResolvedValue(program);
});

afterEach(() => {
  vi.resetAllMocks();
});

describe("probeCodexAccount", () => {
  it("reads a saved login from `codex login status`, run as the SDK's program over the run's env", async () => {
    codexAnswers(null, "Logged in using ChatGPT\n");
    const env = { PATH: "/usr/bin", HOME: "/home/me", CODEX_HOME: "/codex" };

    expect(await probeCodexAccount({ env })).toEqual({ status: "account", source: "login" });

    expect(findCodexProgram).toHaveBeenCalledWith(env);
    const [file, args, options] = execFile.mock.calls[0]!;
    expect(file).toBe("/sdk/bin/codex");
    expect(args).toEqual(["login", "status"]);
    // Only the run's env, with the SDK's own directories put first on PATH.
    expect(options.env).toEqual({ PATH: "/sdk/bin:/usr/bin", HOME: "/home/me", CODEX_HOME: "/codex" });
    expect(options.timeout).toBe(10_000);
  });

  it("counts a CODEX_API_KEY as an account without starting Codex, though no login is saved", async () => {
    codexAnswers(failure({ code: 1 }), "", "Not logged in\n");
    expect(await probeCodexAccount({ env: { CODEX_API_KEY: "sk-key" } })).toEqual({ status: "account", source: "api-key" });
    expect(execFile).not.toHaveBeenCalled();
    expect(findCodexProgram).not.toHaveBeenCalled();
  });

  it("an empty CODEX_API_KEY is no key", async () => {
    codexAnswers(failure({ code: 1 }), "", "Not logged in\n");
    expect(await probeCodexAccount({ env: { CODEX_API_KEY: "" }, program })).toMatchObject({ status: "none" });
  });

  it("reads a failing `codex login status` as no account, with Codex's last line as the reason", async () => {
    codexAnswers(failure({ code: 1 }), "", "WARNING: something unrelated\nNot logged in\n");
    expect(await probeCodexAccount({ env: {}, program })).toEqual({ status: "none", reason: "Not logged in" });
  });

  it("names the exit code when Codex said nothing", async () => {
    codexAnswers(failure({ code: 2 }));
    expect(await probeCodexAccount({ env: {}, program })).toEqual({
      status: "none",
      reason: "`codex login status` exited with code 2",
    });
  });

  it("reads a Codex that didn't answer in time as unanswered, not signed out", async () => {
    codexAnswers(failure({ code: null, killed: true, signal: "SIGTERM" }));
    const probe = await probeCodexAccount({ env: {}, program, timeoutMs: 2_000 });
    expect(probe).toEqual({ status: "none", reason: "Codex did not answer within 2 s", unanswered: true });
    expect(execFile.mock.calls[0]![2].timeout).toBe(2_000);
  });

  it("reads a Codex that could not be started as unanswered", async () => {
    codexAnswers(failure({ code: "ENOENT" }, "spawn /sdk/bin/codex ENOENT"));
    expect(await probeCodexAccount({ env: {}, program })).toEqual({
      status: "none",
      reason: "The Codex CLI could not be started: spawn /sdk/bin/codex ENOENT",
      unanswered: true,
    });
  });

  it("reads a stopped check as unanswered, and hands the signal to the process", async () => {
    const stop = new AbortController();
    codexAnswers(Object.assign(failure({ code: "ABORT_ERR" }), { name: "AbortError" }));
    expect(await probeCodexAccount({ env: {}, program, signal: stop.signal })).toEqual({
      status: "none",
      reason: "The check was stopped before Codex answered",
      unanswered: true,
    });
    expect(execFile.mock.calls[0]![2].signal).toBe(stop.signal);
  });

  it("starts nothing when the signal is already aborted", async () => {
    const stop = new AbortController();
    stop.abort();
    expect(await probeCodexAccount({ env: {}, program, signal: stop.signal })).toMatchObject({ status: "none", unanswered: true });
    expect(execFile).not.toHaveBeenCalled();
  });

  it("is sdk-missing when the SDK can't say where its program is", async () => {
    findCodexProgram.mockRejectedValue(new Error("Cannot find package '@openai/codex-sdk'"));
    expect(await probeCodexAccount({ env: {} })).toEqual({
      status: "sdk-missing",
      reason: "Cannot find package '@openai/codex-sdk'",
    });
    expect(execFile).not.toHaveBeenCalled();
  });
});

describe("checkCodexReadiness", () => {
  it("is ready on a key, without starting Codex", async () => {
    expect(await checkCodexReadiness({ env: { CODEX_API_KEY: "k" } })).toEqual({ ready: true });
    expect(execFile).not.toHaveBeenCalled();
  });

  it("is ready on a login `codex login status` accepts", async () => {
    codexAnswers(null, "Logged in using ChatGPT\n");
    expect(await checkCodexReadiness({ env: {} })).toEqual({ ready: true });
  });

  it("is not ready with Codex's reason and the sign-in remedy when it says not logged in", async () => {
    codexAnswers(failure({ code: 1 }), "Not logged in\n");
    expect(await checkCodexReadiness({ env: {} })).toEqual({
      ready: false,
      reason: "Codex has no credential: Not logged in",
      remedy: CODEX_SIGN_IN_REMEDY,
    });
  });

  it("is unanswered, with Re-check as the remedy, when Codex never answered", async () => {
    codexAnswers(failure({ killed: true, signal: "SIGTERM" }));
    expect(await checkCodexReadiness({ env: {}, timeoutMs: 2_000 })).toEqual({
      ready: false,
      reason: "Codex did not answer within 2 s, so Codex's sign-in is unknown",
      remedy: "Re-check",
      unanswered: true,
    });
  });

  it("names the SDK to install when it can't be loaded", async () => {
    findCodexProgram.mockRejectedValue(new Error("Cannot find package '@openai/codex-sdk'"));
    expect(await checkCodexReadiness({ env: {} })).toEqual({
      ready: false,
      reason: "The Codex SDK could not be loaded: Cannot find package '@openai/codex-sdk'",
      remedy: "Install @openai/codex-sdk",
    });
  });
});
