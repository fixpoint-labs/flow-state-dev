import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { executeServeCommand } from "../src/commands/serve";
import { CliError } from "../src/resolve-block";
import { EXIT_CONFIG_ERROR } from "../src/exit-codes";

const unauthDir = resolve(import.meta.dirname, "fixtures-config", "serve-unauth");
const noConfigDir = resolve(import.meta.dirname, "fixtures-config", "serve-no-config");
const initFailDir = resolve(import.meta.dirname, "fixtures-config", "serve-init-fail");

// Every case here errors before `serve()` binds a port. The "guard passes"
// behavior (loopback / authenticated flow) would start a long-lived server whose
// shutdown calls process.exit and would kill the runner, so it is covered by the
// bind-guard unit tests in @flow-state-dev/node instead.

describe("fsdev serve", () => {
  it("rejects an invalid --port before loading any config", async () => {
    const err = await executeServeCommand({ cwd: unauthDir, port: "notaport" }).catch((e) => e);
    expect(err).toBeInstanceOf(CliError);
    expect(err.exitCode).toBe(EXIT_CONFIG_ERROR);
  });

  it.each(["3000abc", "1e3", "80.5", " 80", "0x50"])(
    "rejects a non-decimal --port (%s) instead of truncating it",
    async (port) => {
      // parseInt would silently accept these (3000abc→3000, 1e3→1); the command
      // must reject the whole string so a typo can't bind an unintended port.
      const err = await executeServeCommand({ cwd: unauthDir, port }).catch((e) => e);
      expect(err).toBeInstanceOf(CliError);
      expect(err.exitCode).toBe(EXIT_CONFIG_ERROR);
      expect(err.message).toContain(`Invalid port: ${port}`);
    },
  );

  it("rejects an out-of-range --port", async () => {
    const err = await executeServeCommand({ cwd: unauthDir, port: "70000" }).catch((e) => e);
    expect(err).toBeInstanceOf(CliError);
    expect(err.exitCode).toBe(EXIT_CONFIG_ERROR);
  });

  it("validates $PORT too (not just --port) so a malformed env fails fast", async () => {
    // serve()'s resolvePort would otherwise truncate PORT=abc→3000 / 1e3→1000.
    const saved = process.env.PORT;
    process.env.PORT = "1e3";
    try {
      const err = await executeServeCommand({ cwd: unauthDir }).catch((e) => e);
      expect(err).toBeInstanceOf(CliError);
      expect(err.exitCode).toBe(EXIT_CONFIG_ERROR);
      expect(err.message).toContain("Invalid port: 1e3");
    } finally {
      if (saved === undefined) delete process.env.PORT;
      else process.env.PORT = saved;
    }
  });

  it("--port overrides a malformed $PORT", async () => {
    // An explicit valid --port wins; the guard rejects on host (unauth), proving
    // resolution got past port validation with the good value.
    const saved = process.env.PORT;
    process.env.PORT = "abc";
    try {
      const err = await executeServeCommand({ cwd: unauthDir, port: "8080", host: "0.0.0.0" }).catch(
        (e) => e,
      );
      expect(err).toBeInstanceOf(CliError);
      expect(err.message).toContain("Refusing to bind 0.0.0.0");
    } finally {
      if (saved === undefined) delete process.env.PORT;
      else process.env.PORT = saved;
    }
  });

  it("requires a committed config — no directory discovery fallback", async () => {
    const err = await executeServeCommand({ cwd: noConfigDir }).catch((e) => e);
    expect(err).toBeInstanceOf(CliError);
    expect(err.exitCode).toBe(EXIT_CONFIG_ERROR);
    expect(err.message).toContain("requires a committed fsdev.config");
  });

  it("refuses a non-loopback bind for an unauthenticated flow and disposes the FlowState", async () => {
    const g = globalThis as unknown as { __fsdevServeDisposeCalls: number };
    g.__fsdevServeDisposeCalls = 0;
    const err = await executeServeCommand({ cwd: unauthDir, host: "0.0.0.0" }).catch((e) => e);
    expect(err).toBeInstanceOf(CliError);
    expect(err.exitCode).toBe(EXIT_CONFIG_ERROR);
    expect(err.message).toContain("Refusing to bind 0.0.0.0");
    expect(err.message).toContain('"open"');
    // The guard-failure path released the store adapter rather than leaking it.
    expect(g.__fsdevServeDisposeCalls).toBeGreaterThan(0);
  });

  it("reads $HOST when --host is omitted", async () => {
    // A distinctive non-loopback $HOST proves the env var flows into host
    // resolution: the guard's message names it (the default would say 0.0.0.0).
    const saved = process.env.HOST;
    process.env.HOST = "192.168.5.9";
    try {
      const err = await executeServeCommand({ cwd: unauthDir }).catch((e) => e);
      expect(err).toBeInstanceOf(CliError);
      expect(err.message).toContain("Refusing to bind 192.168.5.9");
    } finally {
      if (saved === undefined) delete process.env.HOST;
      else process.env.HOST = saved;
    }
  });

  it("treats an empty $HOST as unset (falls back to 0.0.0.0)", async () => {
    const saved = process.env.HOST;
    process.env.HOST = "";
    try {
      const err = await executeServeCommand({ cwd: unauthDir }).catch((e) => e);
      expect(err).toBeInstanceOf(CliError);
      // Without the empty-guard the message would read "Refusing to bind " (blank).
      expect(err.message).toContain("Refusing to bind 0.0.0.0");
    } finally {
      if (saved === undefined) delete process.env.HOST;
      else process.env.HOST = saved;
    }
  });

  it("fails with EXIT_CONFIG_ERROR when router init fails after the socket binds", async () => {
    // Loopback host passes the bind guard, so serve() binds; store init then
    // rejects. The command must map that to a config error and close the handle,
    // not announce "Server running" and keep a zombie process alive.
    const err = await executeServeCommand({ cwd: initFailDir, host: "127.0.0.1", port: "0" }).catch(
      (e) => e,
    );
    expect(err).toBeInstanceOf(CliError);
    expect(err.exitCode).toBe(EXIT_CONFIG_ERROR);
    expect(err.message).toContain("Server failed to initialize");
    expect(err.message).toContain("store boom");
  });

  it("--host wins over $HOST", async () => {
    const saved = process.env.HOST;
    process.env.HOST = "192.168.5.9";
    try {
      const err = await executeServeCommand({ cwd: unauthDir, host: "10.0.0.7" }).catch((e) => e);
      expect(err).toBeInstanceOf(CliError);
      expect(err.message).toContain("Refusing to bind 10.0.0.7");
    } finally {
      if (saved === undefined) delete process.env.HOST;
      else process.env.HOST = saved;
    }
  });
});
