/**
 * GitHub on the operator's own token: the token is read once, from
 * `GITHUB_TOKEN` first, and lent to nobody. A routine the operator asks for
 * reads GitHub with it; one asked for by anyone else, or with no token, is
 * refused naming `GITHUB_TOKEN`, before GitHub is asked anything.
 */
import { describe, expect, it } from "vitest";
import type { BlockContext } from "@flow-state-dev/core/types";
import { operatorGitHub, operatorGitHubToken } from "../src/index";

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
});

describe("GitHub on the operator's token", () => {
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
