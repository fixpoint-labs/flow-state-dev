/**
 * FIX-2900 POC · can each harness's own control make a run read-only, per run?
 *
 * Model-free and throwaway. Two probes against the real vendor code the repo pins:
 *
 * 1. Claude Code (`@anthropic-ai/claude-agent-sdk`): `query()` with the read-only
 *    options the spec names (`tools: ["Read","Grep","Glob"]`, `permissionMode:
 *    "dontAsk"`), and with a control that approximates the kit's options (the default
 *    tool set, `acceptEdits`; not the kit's exact option bag). It reads the `init`
 *    message the agent process sends before any model call, which lists the tools
 *    the run is offered, then aborts. No model is called; no sign-in is needed.
 * 2. Codex (`@openai/codex`, the CLI the SDK runs): `codex sandbox` under
 *    `sandbox_mode="read-only"` runs a file write, a `git commit` and an HTTPS
 *    request. Controls: `workspace-write` with network on, and `danger-full-access`,
 *    must reach the network, `workspace-write` must allow the same write and
 *    `danger-full-access` the same commit, so "refused" means the sandbox ran the command and refused it. Linux only (Landlock/seccomp); macOS Seatbelt is not
 *    probed here.
 *
 * Cursor is not probed: its local runtime needs a signed-in account. Its `tools`
 * allowlist is read from the SDK's types; the goal check settles it.
 *
 * Run:   pnpm tsx specs/issues/FIX-2900/poc/read-only-probes/run.mts
 * Needs: `pnpm install`, `git`, `curl`, outbound HTTPS. Nothing else.
 * Seen:  Agent SDK 0.3.316, Codex 0.164.0, Linux x64, 2026-11-25 — every line PASS.
 * Exit:  0 when every premise holds, 1 when one is refuted.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const repo = resolve(new URL("../../../../../", import.meta.url).pathname);
let failed = false;
const check = (name: string, ok: boolean, seen: string) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  (${seen})`);
  if (!ok) failed = true;
};

// --- 1. Claude Code: what tools a run is offered ---------------------------------
const sdk = await import(
  pathToFileURL(join(realpathSync(join(repo, "packages/claude-code/node_modules/@anthropic-ai/claude-agent-sdk")), "sdk.mjs")).href
);
async function offered(options: Record<string, unknown>): Promise<{ tools: string[]; mode: string }> {
  const ac = new AbortController();
  const cwd = mkdtempSync(join(tmpdir(), "fix2900-cc-"));
  const timer = setTimeout(() => ac.abort(), 30_000);
  try {
    for await (const m of sdk.query({
      prompt: "say hi",
      options: { ...options, cwd, abortController: ac, settingSources: [], env: { PATH: process.env.PATH, HOME: process.env.HOME } },
    })) {
      if (m.type === "system" && m.subtype === "init") {
        ac.abort();
        return { tools: m.tools, mode: m.permissionMode };
      }
    }
  } catch {
    /* the abort */
  } finally {
    clearTimeout(timer);
  }
  return { tools: [], mode: "none" };
}
const readOnly = await offered({
  tools: ["Read", "Grep", "Glob"],
  allowedTools: ["Read", "Grep", "Glob"],
  permissionMode: "dontAsk",
});
// Control: an approximation of the kit's options (default tool set, acceptEdits), not the kit's exact bag.
const full = await offered({ allowedTools: ["Read", "Write", "Edit", "Bash"], permissionMode: "acceptEdits" });
const writers = ["Write", "Edit", "NotebookEdit", "Bash", "Task"];
check("claude-code read-only offers no writing tool", readOnly.tools.length > 0 && !readOnly.tools.some((t) => writers.includes(t)), readOnly.tools.join(","));
check("claude-code read-only runs in dontAsk", readOnly.mode === "dontAsk", readOnly.mode);
check("control: claude-code full offers Write and Bash", full.tools.includes("Write") && full.tools.includes("Bash"), `${full.tools.length} tools`);

// --- 2. Codex: what the read-only sandbox refuses --------------------------------
const codexJs = join(realpathSync(join(repo, "packages/codex/node_modules/@openai/codex-sdk")), "../codex/bin/codex.js");
const work = mkdtempSync(join(tmpdir(), "fix2900-cx-"));
execFileSync("git", ["init", "-q"], { cwd: work });
execFileSync("git", ["-c", "user.email=a@b", "-c", "user.name=a", "commit", "-q", "--allow-empty", "-m", "first"], { cwd: work });
const sandboxed = (config: string[], script: string) => {
  const r = spawnSync("node", [codexJs, "sandbox", ...config.flatMap((c) => ["-c", c]), "--", "sh", "-c", script], {
    cwd: work,
    env: { ...process.env, CODEX_HOME: mkdtempSync(join(tmpdir(), "fix2900-ch-")) },
    encoding: "utf8",
  });
  if (r.error) throw r.error;
  return (r.stdout ?? "").trim();
};
const net = 'curl -sS -m 8 -o /dev/null -w "%{http_code}" https://api.github.com 2>/dev/null; true';
const ro = ['sandbox_mode="read-only"', "sandbox_workspace_write.network_access=true"];
check("codex read-only refuses a file write", sandboxed(ro, "echo x > f.txt 2>/dev/null && echo wrote || echo refused") === "refused", "write");
check("codex read-only refuses git commit", sandboxed(ro, "git -c user.email=a@b -c user.name=a commit -q --allow-empty -m 2 2>/dev/null && echo wrote || echo refused") === "refused", "commit");
check("codex read-only still reads git", sandboxed(ro, "git log --oneline | wc -l") === "1", "git log");
check("codex read-only refuses the network, even with the network flag on", sandboxed(ro, net) === "000", "https");
const ww = ['sandbox_mode="workspace-write"'];
check("control: codex workspace-write allows the same file write", sandboxed(ww, "echo x > g.txt 2>/dev/null && echo wrote || echo refused") === "wrote", "write");
// workspace-write keeps .git read-only too, so the commit's positive control is danger-full-access.
check("control: codex danger-full-access allows the same git commit", sandboxed(['sandbox_mode="danger-full-access"'], "git -c user.email=a@b -c user.name=a commit -q --allow-empty -m 3 2>/dev/null && echo wrote || echo refused") === "wrote", "commit");
check("control: codex workspace-write + network reaches it", sandboxed(['sandbox_mode="workspace-write"', "sandbox_workspace_write.network_access=true"], net) === "200", "https");
check("control: codex danger-full-access reaches it", sandboxed(['sandbox_mode="danger-full-access"'], net) === "200", "https");

process.exit(failed ? 1 : 0);
