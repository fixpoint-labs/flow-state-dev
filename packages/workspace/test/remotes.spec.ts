/**
 * Judging a remote, as data, before git ever sees it.
 */
import { describe, expect, it } from "vitest";
import { allowedProtocols, checkRemote, redactRemote } from "../src/remotes";

const allow = ["github.com", "file"];
const key = (remote: string) => {
  const judged = checkRemote(remote, allow);
  if ("reason" in judged) throw new Error(judged.message);
  return judged.cloneKey;
};

describe("one repository, one clone, however it is spelled", () => {
  it("https with and without .git, and both ssh spellings, share a clone", () => {
    const spellings = [
      "https://github.com/acme/storefront",
      "https://github.com/acme/storefront.git",
      "https://GitHub.com/acme/storefront.git/",
      "git@github.com:acme/storefront.git",
      "ssh://git@github.com/acme/storefront.git",
    ];
    expect(new Set(spellings.map(key)).size).toBe(1);
  });

  it("two repositories never share one", () => {
    expect(key("https://github.com/acme/storefront")).not.toBe(key("https://github.com/acme/storefront-v2"));
    expect(key("https://github.com/acme/a-b")).not.toBe(key("https://github.com/acme/a/b"));
  });

  it("a file:// path keeps its .git, because x and x.git are two directories", () => {
    expect(key("file:///srv/x")).not.toBe(key("file:///srv/x.git"));
  });

  it("names a clone with nothing a directory cannot hold", () => {
    expect(key("ssh://git@github.com/acme/../storefront")).toMatch(/^[A-Za-z0-9._-]+$/);
  });
});

describe("what the allowlist lets git speak", () => {
  it("network hosts get https and ssh; file only when listed", () => {
    expect(allowedProtocols(["github.com"])).toBe("https:ssh");
    expect(allowedProtocols(["github.com", "file"])).toBe("https:ssh:file");
    expect(allowedProtocols(["file"])).toBe("file");
    expect(allowedProtocols([])).toBe("");
  });

  it("an ssh remote's login name is fine; a password is not", () => {
    expect(checkRemote("ssh://git@github.com/acme/x.git", allow)).not.toHaveProperty("reason");
    expect(checkRemote("ssh://git:pw@github.com/acme/x.git", allow)).toMatchObject({ reason: "invalid-remote" });
  });
});

describe("a credential is never shown", () => {
  it("drops userinfo from a URL", () => {
    expect(redactRemote("https://someone:hunter2@github.com/acme/x.git")).toBe("https://github.com/acme/x.git");
    expect(redactRemote("git@github.com:acme/x.git")).toBe("git@github.com:acme/x.git");
  });
});
