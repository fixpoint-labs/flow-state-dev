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

  it("a non-default port is another server, so another clone", () => {
    // The same path on two ports can be two unrelated repositories; sharing a
    // clone would reattach one's branch to the other's refs.
    expect(key("ssh://git@github.com:2222/acme/storefront.git")).not.toBe(key("ssh://git@github.com/acme/storefront.git"));
    expect(key("https://github.com:8443/acme/storefront")).not.toBe(key("https://github.com/acme/storefront"));
  });

  it("a default port is the same server as no port", () => {
    expect(key("ssh://git@github.com:22/acme/storefront.git")).toBe(key("git@github.com:acme/storefront.git"));
    expect(key("https://github.com:443/acme/storefront")).toBe(key("https://github.com/acme/storefront"));
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

  it("a malformed escape in a file:// path is an invalid remote, not a crash", () => {
    // A thrown URIError would escape the refusal path, and a caller could not
    // fail the run with a stable reason.
    expect(checkRemote("file:///tmp/%ZZ", allow)).toMatchObject({ reason: "invalid-remote" });
  });
});

describe("a credential is never shown", () => {
  it("drops userinfo from a URL", () => {
    expect(redactRemote("https://someone:hunter2@github.com/acme/x.git")).toBe("https://github.com/acme/x.git");
    expect(redactRemote("git@github.com:acme/x.git")).toBe("git@github.com:acme/x.git");
  });

  it("drops all of the userinfo when the credential itself holds an @", () => {
    // A URL parser splits the authority at the LAST @, so everything before it
    // is credential.
    expect(redactRemote("https://user:@hunter2@github.com/x")).toBe("https://github.com/x");
    expect(redactRemote("ssh://git:p@ss@github.com/x")).toBe("ssh://github.com/x");
  });

  it("a refusal never prints a credential that holds an @", () => {
    const judged = checkRemote("https://user:@hunter2@github.com/x", allow);
    expect(judged).toHaveProperty("reason");
    expect((judged as { message: string }).message).not.toContain("hunter2");
  });
});
