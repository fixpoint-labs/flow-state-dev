/**
 * GitHub on the operator's own token: the token is read once, from
 * `GITHUB_TOKEN` first, and lent to nobody. A routine the operator asks for
 * reads GitHub with it; one asked for by anyone else, or with no token, is
 * refused naming `GITHUB_TOKEN`, before GitHub is asked anything.
 */
import { describe, expect, it } from "vitest";
import type { BlockContext } from "@flow-state-dev/core/types";
import { checkGitHubToken, operatorGitHub, operatorGitHubToken, readOperatorGitHubToken } from "../src/index";

const as = (userId: string) => ({ session: { identity: { userId } } }) as unknown as BlockContext;

/** A fetch that records each GitHub call's bearer and answers the repository readable. */
function github() {
  const bearers: string[] = [];
  const fetch = (async (_url: string, init?: RequestInit) => {
    bearers.push(new Headers(init?.headers).get("authorization") ?? "");
    return new Response(JSON.stringify({ id: 1, full_name: "acme/app", private: false }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof globalThis.fetch;
  return { bearers, fetch };
}

describe("the operator's GitHub token", () => {
  it("is GITHUB_TOKEN when set, trimmed", () => {
    expect(operatorGitHubToken({ GITHUB_TOKEN: "  ghp_operator \n" })).toBe("ghp_operator");
  });

  // A stale GITHUB_TOKEN in the server's environment wins over a working `gh` sign-in, and `gh` runs under
  // the server's PATH and keychain: a host logs where the token came from, and why there is none.
  it("says it came from GITHUB_TOKEN when that is set, without asking gh", () => {
    const gh = () => expect.unreachable("gh is not asked when GITHUB_TOKEN is set");
    expect(readOperatorGitHubToken({ GITHUB_TOKEN: "ghp_env" }, gh)).toEqual({ token: "ghp_env", source: "GITHUB_TOKEN" });
  });

  it("says it came from gh, and why gh gave none", () => {
    expect(readOperatorGitHubToken({}, () => "gho_signed_in\n")).toEqual({ token: "gho_signed_in", source: "gh auth token" });
    const failing = (error: object) => (): string => { throw Object.assign(new Error("failed"), error); };
    expect(readOperatorGitHubToken({}, failing({ code: "ENOENT" })).problem).toMatch(/not on this server's PATH/);
    expect(readOperatorGitHubToken({}, failing({ code: "ETIMEDOUT" })).problem).toMatch(/took longer than 10s/);
    expect(readOperatorGitHubToken({}, failing({ status: 1 }))).toMatchObject({ token: undefined, source: undefined, problem: expect.stringMatching(/exit 1/) });
  });
});

describe("checking the operator's token at start", () => {
  const answering = (status: number, body: object = {}) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

  it("names who GitHub says the token is", async () => {
    expect(await checkGitHubToken("ghp_ok", { fetch: answering(200, { login: "jhoffner" }) })).toEqual({ ok: true, login: "jhoffner" });
  });

  it("says why GitHub refused it, never throwing", async () => {
    expect(await checkGitHubToken("ghp_stale", { fetch: answering(401) })).toEqual({ ok: false, reason: expect.stringMatching(/401 \(the token is invalid or expired\)/) });
    const offline = (async () => { throw new Error("getaddrinfo ENOTFOUND"); }) as unknown as typeof fetch;
    expect(await checkGitHubToken("ghp_ok", { fetch: offline })).toEqual({ ok: false, reason: expect.stringMatching(/couldn't reach GitHub/) });
  });

  it("redacts the token when a failed fetch includes its request headers", async () => {
    const token = "ghp_private_token_in_request";
    const failed = (async () => { throw new Error(`getaddrinfo ENOTFOUND; authorization: Bearer ${token}`); }) as typeof fetch;
    const check = await checkGitHubToken(token, { fetch: failed });
    expect(check).toMatchObject({ ok: false, reason: expect.stringContaining("ENOTFOUND") });
    expect(JSON.stringify(check)).not.toContain(token);
  });
});

describe("GitHub on the operator's token", () => {
  it("keeps a failed poll's token out of the error the scheduler logs", async () => {
    const token = "ghp_private_token_in_request";
    const real = globalThis.fetch;
    globalThis.fetch = (async () => { throw new Error(`getaddrinfo ENOTFOUND; authorization: Bearer ${token}`); }) as typeof fetch;
    try {
      const poll = operatorGitHub({ operator: "u_op", token }).poll!("github:acme/app#1", {}, as("u_op"));
      await expect(poll).rejects.toThrow("ENOTFOUND");
      await expect(poll).rejects.not.toThrow(token);
    } finally {
      globalThis.fetch = real;
    }
  });

  it("reads GitHub with the token for the operator", async () => {
    const calls = github();
    const real = globalThis.fetch;
    globalThis.fetch = calls.fetch;
    try {
      await operatorGitHub({ operator: "u_op", token: "ghp_op" }).canRead("github:acme/app#1", as("u_op"));
    } finally {
      globalThis.fetch = real;
    }
    expect(calls.bearers.length).toBeGreaterThan(0);
    expect(new Set(calls.bearers)).toEqual(new Set(["Bearer ghp_op"]));
  });

  it("refuses anyone else's routine, naming the token, and asks GitHub nothing", async () => {
    const calls = github();
    const real = globalThis.fetch;
    globalThis.fetch = calls.fetch;
    try {
      await expect(operatorGitHub({ operator: "u_op", token: "ghp_op" }).canRead("github:acme/app#1", as("u_other"))).rejects.toThrow(/GITHUB_TOKEN, which serves only u_op/);
    } finally {
      globalThis.fetch = real;
    }
    expect(calls.bearers).toEqual([]);
  });

  it("refuses every routine with no token, naming GITHUB_TOKEN", async () => {
    await expect(operatorGitHub({ operator: "u_op", token: undefined }).canRead("github:acme/app#1", as("u_op"))).rejects.toThrow(/need GITHUB_TOKEN/);
  });
});
