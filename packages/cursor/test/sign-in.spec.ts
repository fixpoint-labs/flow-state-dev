/**
 * `cursorSignIn`: a key in the run's environment answers without the SDK, and
 * no key with no stored login is `none` with its reason.
 *
 * The SDK is mocked so the answer never depends on this machine's own stored
 * login. The `login` path needs a real stored login and is not covered here.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const authStatus = vi.fn<() => Promise<{ status: string }>>();
vi.mock("@cursor/sdk", () => ({ Cursor: { auth: { status: authStatus } } }));

import { cursorSignIn } from "../src/sign-in";

describe("cursorSignIn", () => {
  beforeEach(() => {
    authStatus.mockReset();
  });

  it("is `key` for a non-empty CURSOR_API_KEY, without asking the SDK", async () => {
    expect(await cursorSignIn({ CURSOR_API_KEY: "k" })).toEqual({ status: "key" });
    // The key alone answers: a host signed in by key never loads the SDK for this.
    expect(authStatus).not.toHaveBeenCalled();
  });

  it("is `login` when there is no key and the SDK reports a stored login", async () => {
    authStatus.mockResolvedValue({ status: "logged-in" });
    expect(await cursorSignIn({})).toEqual({ status: "login" });
  });

  it("is `none` with its reason when there is no key and the SDK reports no stored login", async () => {
    authStatus.mockResolvedValue({ status: "logged-out" });
    expect(await cursorSignIn({})).toEqual({
      status: "none",
      reason: "no CURSOR_API_KEY in the run's environment and no stored login",
    });
  });

  it("treats an empty CURSOR_API_KEY as no key", async () => {
    authStatus.mockResolvedValue({ status: "logged-out" });
    expect(await cursorSignIn({ CURSOR_API_KEY: "" })).toMatchObject({ status: "none" });
    expect(authStatus).toHaveBeenCalledOnce();
  });
});
