import { describe, it, expect, afterEach } from "vitest";
import {
  readUserId,
  writeUserId,
  readBearerToken,
  hasInjectedUserId,
  readActiveSession,
  writeActiveSession,
  readLastAction,
  writeLastAction,
  readDebugMode,
} from "../src/react/config";

type WindowWithConfig = Window & {
  __FSD_DEVTOOL_CONFIG__?: { userId?: string; bearerToken?: string };
};
function setInjected(config: { userId?: string; bearerToken?: string } | undefined) {
  if (config === undefined) delete (window as WindowWithConfig).__FSD_DEVTOOL_CONFIG__;
  else (window as WindowWithConfig).__FSD_DEVTOOL_CONFIG__ = config;
}

describe("config — localStorage helpers", () => {
  describe("userId", () => {
    it("returns default when nothing stored", () => {
      expect(readUserId()).toBe("devuser");
    });

    it("returns stored value after write", () => {
      writeUserId("alice");
      expect(readUserId()).toBe("alice");
    });

    it("trims whitespace", () => {
      writeUserId("  bob  ");
      expect(readUserId()).toBe("bob");
    });

    it("falls back to default for blank string", () => {
      localStorage.setItem("fsd.devtool.userId", "   ");
      expect(readUserId()).toBe("devuser");
    });
  });

  describe("activeSession", () => {
    it("returns null when nothing stored", () => {
      expect(readActiveSession("chat")).toBeNull();
    });

    it("persists per flowKind", () => {
      writeActiveSession("chat", "sess-1");
      writeActiveSession("agent", "sess-2");

      expect(readActiveSession("chat")).toBe("sess-1");
      expect(readActiveSession("agent")).toBe("sess-2");
    });

    it("clears when set to null", () => {
      writeActiveSession("chat", "sess-1");
      writeActiveSession("chat", null);
      expect(readActiveSession("chat")).toBeNull();
    });
  });

  describe("lastAction", () => {
    it("returns null when nothing stored", () => {
      expect(readLastAction("chat")).toBeNull();
    });

    it("reads back what was written", () => {
      writeLastAction("chat", "sendMessage");
      expect(readLastAction("chat")).toBe("sendMessage");
    });
  });

  describe("injected config (window.__FSD_DEVTOOL_CONFIG__)", () => {
    afterEach(() => setInjected(undefined));

    it("an injected userId wins over localStorage on boot", () => {
      writeUserId("alice");
      setInjected({ userId: "owner" });
      expect(readUserId()).toBe("owner");
    });

    it("falls back to localStorage/default when no userId is injected", () => {
      setInjected({ bearerToken: "t" });
      expect(readUserId()).toBe("devuser");
      writeUserId("alice");
      expect(readUserId()).toBe("alice");
    });

    it("readBearerToken returns the injected token, else undefined", () => {
      expect(readBearerToken()).toBeUndefined();
      setInjected({ bearerToken: "s3cret" });
      expect(readBearerToken()).toBe("s3cret");
    });

    it("ignores a blank injected token", () => {
      setInjected({ bearerToken: "   " });
      expect(readBearerToken()).toBeUndefined();
    });

    it("hasInjectedUserId is true only for a non-blank injected userId", () => {
      expect(hasInjectedUserId()).toBe(false);
      setInjected({ bearerToken: "t" });
      expect(hasInjectedUserId()).toBe(false);
      setInjected({ userId: "owner" });
      expect(hasInjectedUserId()).toBe(true);
      setInjected({ userId: "  " });
      expect(hasInjectedUserId()).toBe(false);
    });
  });

  describe("debugMode", () => {
    it("defaults to false", () => {
      expect(readDebugMode()).toBe(false);
    });

    it('returns true when localStorage has "true"', () => {
      localStorage.setItem("fsd.devtool.debugMode", "true");
      expect(readDebugMode()).toBe(true);
    });

    it("returns false for any other value", () => {
      localStorage.setItem("fsd.devtool.debugMode", "yes");
      expect(readDebugMode()).toBe(false);
    });
  });
});
