/** The Error Reporter's fingerprint and redaction (FIX-1983). */
import { describe, expect, it } from "vitest";
import { fingerprintOf, normalizeErrorMessage } from "../src/error-reporter/fingerprint";
import { redact, secretsFromEnv } from "../src/error-reporter/redact";

const base = {
  flowKind: "coordinator",
  actionName: "run",
  blockPath: "root/step[2]",
  code: "BLOCK_FAILED",
  message: 'Project "storefront" has no repository (request req_8f2c1a9e, session s_1234abcd, at /srv/app/src/x.ts:12:4)'
};

describe("fingerprintOf", () => {
  it("is the same for two failures that differ only in ids, numbers and paths", async () => {
    const other = {
      ...base,
      message: 'Project "storefront" has no repository (request req_77aa00bb11, session s_99ffeedd, at /home/u/app/src/y.ts:90:1)'
    };
    expect(await fingerprintOf(other)).toBe(await fingerprintOf(base));
  });

  it("differs when the block, the code, the action or the message's words differ", async () => {
    const one = await fingerprintOf(base);
    expect(await fingerprintOf({ ...base, blockPath: "root/step[3]" })).not.toBe(one);
    expect(await fingerprintOf({ ...base, code: "TIMEOUT" })).not.toBe(one);
    expect(await fingerprintOf({ ...base, actionName: "other" })).not.toBe(one);
    expect(await fingerprintOf({ ...base, message: 'Project "storefront" has no owner' })).not.toBe(one);
  });

  it("strips uuids, prefixed ids, long hex, numbers and paths from the message", () => {
    expect(
      normalizeErrorMessage("Task task_ab12cd34 failed after 3 tries: 0f1e2d3c-4b5a-6978-8899-aabbccddeeff in /tmp/x/y.ts:4:2 — 0xdeadbeef")
    ).toBe("task <id> failed after <n> tries: <id> in <path> — <id>");
  });
});

describe("redact", () => {
  it("removes every listed secret, bearer token and key-shaped value, however deep", () => {
    const secret = "sk-live-1234567890abcdefghij";
    const value = {
      note: `called with ${secret} and Authorization: Bearer abc.def.ghi`,
      nested: [{ env: `LINEAR=lin_api_ZZZZZZZZZZZZZZZZZZZZ`, keep: "storefront" }],
      plain: "nothing to hide"
    };
    const out = redact(value, [secret]);
    const text = JSON.stringify(out);
    expect(text).not.toContain(secret);
    expect(text).not.toContain("abc.def.ghi");
    expect(text).not.toContain("lin_api_ZZZZZZZZZZZZZZZZZZZZ");
    expect(text).toContain("storefront");
    expect(text).toContain("nothing to hide");
  });

  it("takes secrets from environment variables whose names say they hold one", () => {
    const found = secretsFromEnv({ LINEAR_API_KEY: "lin_api_secretvalue123", PATH: "/usr/bin:/bin", GITHUB_TOKEN: "ghp_abcdefghij1234", SHORT_KEY: "abc" });
    expect(found).toContain("lin_api_secretvalue123");
    expect(found).toContain("ghp_abcdefghij1234");
    expect(found).not.toContain("/usr/bin:/bin");
    expect(found).not.toContain("abc");
  });
});
