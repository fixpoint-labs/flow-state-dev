import { describe, it, expect } from "vitest";
import {
  readUserId,
  writeUserId,
  readActiveSession,
  writeActiveSession,
  readLastAction,
  writeLastAction,
  readDebugMode,
} from "@/config";

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
