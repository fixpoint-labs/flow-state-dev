/**
 * `probeClaudeAccount`: whether Claude Code has a credential to run on, asked
 * before anything is started on it, with no model turn.
 *
 * The scripted cases pin each outcome and that the probe never sends a
 * message. The installed-SDK cases ask the real Claude Code with an empty home,
 * so the answer is the SDK's own, not a fake's: no credential reads as `none`,
 * and a key in the environment the caller passes reads as `account`.
 */
import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkClaudeCodeReadiness, CLAUDE_SIGN_IN_REMEDY, probeClaudeAccount } from "../../src/sdk/account-probe";

/** A scripted SDK whose `query` answers `accountInfo` with `info`, recording what it was handed. */
function scriptedSdk(info: () => Promise<Record<string, unknown>>) {
  const seen = { env: undefined as unknown, messagesSent: 0, closed: false };
  return {
    seen,
    importSdk: async () => ({
      query: (args: { prompt: AsyncIterable<unknown>; options?: { env?: unknown } }) => {
        seen.env = args.options?.env;
        // Read the input the way the SDK does: anything it yields is a user message.
        void (async () => {
          for await (const _message of args.prompt) seen.messagesSent += 1;
        })();
        return {
          async *[Symbol.asyncIterator]() {},
          accountInfo: info,
          close: () => {
            seen.closed = true;
          },
        };
      },
    }),
  };
}

describe("probeClaudeAccount, scripted", () => {
  it("says account when an API key source comes back, sends no message, and closes", async () => {
    const sdk = scriptedSdk(async () => ({ apiKeySource: "ANTHROPIC_API_KEY", apiProvider: "firstParty" }));
    const env = { PATH: "/bin", ANTHROPIC_API_KEY: "k" };
    const result = await probeClaudeAccount({ env, importSdk: sdk.importSdk });
    expect(result).toEqual({ status: "account", apiKeySource: "ANTHROPIC_API_KEY" });
    expect(sdk.seen.env).toEqual(env);
    expect(sdk.seen.messagesSent).toBe(0);
    expect(sdk.seen.closed).toBe(true);
  });

  it("says account when only a token source comes back", async () => {
    const sdk = scriptedSdk(async () => ({ tokenSource: "claude.ai" }));
    expect(await probeClaudeAccount({ env: {}, importSdk: sdk.importSdk })).toEqual({ status: "account", tokenSource: "claude.ai" });
  });

  it("says account for a subscription sign-in, which names no key or token source", async () => {
    // The shape the SDK returns for a `claude` login (keychain / ~/.claude) with no API key set.
    const sdk = scriptedSdk(async () => ({ email: "a@b.c", organization: "o", subscriptionType: "Claude Max", apiProvider: "firstParty" }));
    expect(await probeClaudeAccount({ env: {}, importSdk: sdk.importSdk })).toEqual({
      status: "account",
      email: "a@b.c",
      subscriptionType: "Claude Max",
    });
  });

  it("says account for an email alone, and for a subscription type alone", async () => {
    // The SDK documents accountInfo() as the logged-in user's account, so either
    // field present means a sign-in was found. The probe still does not check
    // that the credential works (see the file header).
    const emailOnly = scriptedSdk(async () => ({ email: "a@b.c", apiProvider: "firstParty" }));
    expect(await probeClaudeAccount({ env: {}, importSdk: emailOnly.importSdk })).toEqual({ status: "account", email: "a@b.c" });
    const planOnly = scriptedSdk(async () => ({ subscriptionType: "Claude Pro" }));
    expect(await probeClaudeAccount({ env: {}, importSdk: planOnly.importSdk })).toEqual({
      status: "account",
      subscriptionType: "Claude Pro",
    });
  });

  it("says none, with the reason, when neither source comes back", async () => {
    // The shape the SDK returns with no credential: subscriptionType "Claude API", its no-plan label.
    const sdk = scriptedSdk(async () => ({ apiProvider: "firstParty", subscriptionType: "Claude API" }));
    const result = await probeClaudeAccount({ env: {}, importSdk: sdk.importSdk });
    expect(result.status).toBe("none");
    expect(result.status === "none" && result.reason).toMatch(/no API key and no sign-in/);
    expect(sdk.seen.closed).toBe(true);
  });

  it("says none when the plan is null or absent", async () => {
    for (const info of [{ apiProvider: "firstParty", subscriptionType: null }, { apiProvider: "firstParty" }]) {
      const sdk = scriptedSdk(async () => info);
      expect((await probeClaudeAccount({ env: {}, importSdk: sdk.importSdk })).status).toBe("none");
    }
  });

  it("says none when Claude Code does not answer within timeoutMs", async () => {
    const sdk = scriptedSdk(() => new Promise(() => {}));
    const result = await probeClaudeAccount({ env: {}, timeoutMs: 50, importSdk: sdk.importSdk });
    expect(result).toEqual({ status: "none", reason: "Claude Code did not report an account within 50 ms", unanswered: true });
    expect(sdk.seen.closed).toBe(true);
  });

  it("stops and closes Claude Code when its signal aborts, without waiting out timeoutMs", async () => {
    // A usage refresh that gives up must not leave the probe's process running.
    const sdk = scriptedSdk(() => new Promise(() => {}));
    const stop = new AbortController();
    const started = Date.now();
    setTimeout(() => stop.abort(), 20);
    const result = await probeClaudeAccount({ env: {}, timeoutMs: 60_000, signal: stop.signal, importSdk: sdk.importSdk });
    expect(result.status).toBe("none");
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(sdk.seen.closed).toBe(true);
  });

  it("says none, with Claude Code's own error, when accountInfo fails", async () => {
    const sdk = scriptedSdk(async () => {
      throw new Error("spawn claude ENOENT");
    });
    expect(await probeClaudeAccount({ env: {}, importSdk: sdk.importSdk })).toEqual({
      status: "none",
      reason: "Claude Code could not be asked for its account: spawn claude ENOENT",
      unanswered: true,
    });
  });

  it("says sdk-missing when the Agent SDK can't be loaded", async () => {
    const result = await probeClaudeAccount({
      env: {},
      importSdk: async () => {
        throw new Error("Cannot find package '@anthropic-ai/claude-agent-sdk'");
      },
    });
    expect(result.status).toBe("sdk-missing");
    expect(result.status === "sdk-missing" && result.reason).toMatch(/@anthropic-ai\/claude-agent-sdk/);
  });
});

describe("probeClaudeAccount, on the installed Agent SDK", () => {
  const emptyHome = () => mkdtempSync(join(tmpdir(), "account-probe-home-"));
  const base = () => ({ PATH: process.env.PATH ?? "", HOME: emptyHome() });

  it("says none for an empty home with no credential variable", async () => {
    const result = await probeClaudeAccount({ env: base() });
    expect(result.status).toBe("none");
  }, 30_000);

  it("says account for the ANTHROPIC_API_KEY in the environment it is handed, without checking the key", async () => {
    const result = await probeClaudeAccount({ env: { ...base(), ANTHROPIC_API_KEY: "sk-ant-api03-not-a-real-key" } });
    expect(result).toMatchObject({ status: "account", apiKeySource: "ANTHROPIC_API_KEY" });
  }, 30_000);
});

describe("checkClaudeCodeReadiness, scripted", () => {
  it("is ready when the probe finds an account", async () => {
    const sdk = scriptedSdk(async () => ({ apiKeySource: "ANTHROPIC_API_KEY" }));
    expect(await checkClaudeCodeReadiness({ env: {}, importSdk: sdk.importSdk })).toEqual({ ready: true });
  });

  it("is not ready with the sign-in remedy when there is no credential", async () => {
    const sdk = scriptedSdk(async () => ({ apiProvider: "firstParty" }));
    const answer = await checkClaudeCodeReadiness({ env: {}, importSdk: sdk.importSdk });
    expect(answer).toMatchObject({ ready: false, remedy: CLAUDE_SIGN_IN_REMEDY });
    expect(answer).not.toHaveProperty("unanswered");
  });

  it("asks once more when the first probe went unanswered, and is ready if the second finds an account", async () => {
    let asked = 0;
    const sdk = scriptedSdk(() => (asked++ === 0 ? new Promise(() => {}) : Promise.resolve({ tokenSource: "claude.ai" })));
    expect(await checkClaudeCodeReadiness({ env: {}, timeoutMs: 50, importSdk: sdk.importSdk })).toEqual({ ready: true });
    expect(asked).toBe(2);
  });

  it("is unanswered, with Re-check as the remedy, when neither probe answers", async () => {
    const sdk = scriptedSdk(() => new Promise(() => {}));
    expect(await checkClaudeCodeReadiness({ env: {}, timeoutMs: 50, importSdk: sdk.importSdk })).toMatchObject({
      ready: false,
      remedy: "Re-check",
      unanswered: true,
    });
  });

  it("names the SDK to install when it can't be loaded", async () => {
    const answer = await checkClaudeCodeReadiness({
      env: {},
      importSdk: async () => {
        throw new Error("Cannot find package '@anthropic-ai/claude-agent-sdk'");
      },
    });
    expect(answer).toMatchObject({ ready: false, remedy: "Install @anthropic-ai/claude-agent-sdk" });
  });
});
