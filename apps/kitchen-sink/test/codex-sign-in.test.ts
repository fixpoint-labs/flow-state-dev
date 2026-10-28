/**
 * How Codex mode learns which way Codex is signed in, on the real Codex
 * program: `codex login status` over a fresh Codex home for each sign-in.
 * No network: `login status` reads the home's `auth.json` and nothing else.
 *
 * It matters because a ChatGPT sign-in is refused some models (a 400 on the
 * first turn), so New session must know which sign-in it is offering for.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { findCodexProgram } from "@flow-state-dev/codex";

import { codexSignIn } from "@/lib/codex-mode";

let scratch: string;

/** A Codex home of its own, with `auth.json` when given. */
function home(name: string, auth?: unknown): Record<string, string> {
  const dir = join(scratch, name);
  mkdirSync(dir);
  if (auth !== undefined) writeFileSync(join(dir, "auth.json"), JSON.stringify(auth));
  return { PATH: process.env.PATH ?? "", HOME: dir, CODEX_HOME: dir };
}

/** An unsigned token with the claims Codex reads off a ChatGPT sign-in. */
function chatgptToken(): string {
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const claims = {
    email: "someone@example.com",
    exp: Math.floor(Date.now() / 1000) + 86_400,
    "https://api.openai.com/auth": { chatgpt_plan_type: "plus", chatgpt_account_id: "acct", chatgpt_user_id: "user" },
  };
  return `${part({ alg: "none", typ: "JWT" })}.${part(claims)}.sig`;
}

beforeAll(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), "ks-codex-sign-in-")));
});

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

// A cold first start of the Codex program can take seconds, as in `codex-mode.test.ts`.
describe("codexSignIn, on the real Codex program", { timeout: 30_000 }, () => {
  it("a ChatGPT sign-in reads as chatgpt", async () => {
    const token = chatgptToken();
    const env = home("chatgpt", {
      OPENAI_API_KEY: null,
      tokens: { id_token: token, access_token: token, refresh_token: "refresh", account_id: "acct" },
      last_refresh: new Date().toISOString(),
    });
    expect(await codexSignIn(env)).toBe("chatgpt");
  });

  it("an API key saved with `codex login --with-api-key` reads as api-key", async () => {
    const env = home("key");
    const program = await findCodexProgram(env);
    execFileSync(program.path, ["login", "--with-api-key"], { env: env as NodeJS.ProcessEnv, input: "sk-not-a-real-key\n", stdio: ["pipe", "ignore", "ignore"] });
    expect(await codexSignIn(env)).toBe("api-key");
  });

  it("CODEX_API_KEY in the run's environment signs the run in with that key, whatever the home says", async () => {
    expect(await codexSignIn({ ...home("env-key"), CODEX_API_KEY: "sk-not-a-real-key" })).toBe("api-key");
  });

  it("no sign-in reads as unknown, so New session offers the whole list", async () => {
    expect(await codexSignIn(home("none"))).toBe("unknown");
  });
});
