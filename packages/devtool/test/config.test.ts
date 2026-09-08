import { describe, it, expect, afterEach } from "vitest";
import {
  readUserId,
  writeUserId,
  readBearerToken,
  hasInjectedUserId,
  readSessionHint,
  writeSessionHint,
  readLegacySingletonSessionHint,
  clearLegacySingletonSessionHint,
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

  describe("session hint", () => {
    const east = { baseUrl: undefined, userId: "u1", flowId: "review-east" };
    const west = { baseUrl: undefined, userId: "u1", flowId: "review-west" };

    it("returns null when nothing stored", () => {
      expect(readSessionHint(east)).toBeNull();
    });

    it("clears when set to null", () => {
      writeSessionHint(east, "sess-1");
      writeSessionHint(east, null);
      expect(readSessionHint(east)).toBeNull();
    });

    // The defect the scope exists to prevent: two copies of one kind must not
    // share a saved session, or opening the second offers the first's work.
    it("keeps two same-kind instances' hints apart", () => {
      writeSessionHint(east, "sess-east");
      writeSessionHint(west, "sess-west");

      expect(readSessionHint(east)).toBe("sess-east");
      expect(readSessionHint(west)).toBe("sess-west");
    });

    // A hint saved against one backend addresses sessions that do not exist on
    // another, and one operator's session is not another's to be offered.
    it("does not offer a hint across backends or operators", () => {
      writeSessionHint(east, "sess-east");

      expect(readSessionHint({ ...east, baseUrl: "https://other.example" })).toBeNull();
      expect(readSessionHint({ ...east, userId: "u2" })).toBeNull();
    });

    // Ids are opaque, so the key must not be forgeable by choosing one that
    // contains the separator.
    it("does not let a crafted id collide with another scope", () => {
      writeSessionHint({ baseUrl: undefined, userId: "u1", flowId: "a" }, "sess-a");
      expect(readSessionHint({ baseUrl: undefined, userId: "u1|a", flowId: "" })).toBeNull();
    });

    it("reads and clears a legacy kind-keyed hint", () => {
      localStorage.setItem("fsd.devtool.activeSession.reports", "sess-legacy");
      expect(readLegacySingletonSessionHint("reports")).toBe("sess-legacy");

      clearLegacySingletonSessionHint("reports");
      expect(readLegacySingletonSessionHint("reports")).toBeNull();
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
