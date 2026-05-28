#!/usr/bin/env node
// Programmatic wrapper around `claude --remote` for the fsd:dispatch-remote
// skill. The CLI's dispatch banner ("Created remote session: …") is only
// written when stdout is a TTY — running claude as a normal subprocess auto-
// engages `--print` mode (because stdout is a pipe) and suppresses the banner
// entirely, which also makes claude reject the call with "Input must be
// provided … when using --print" because --remote consumed the positional
// argument. We work around this by running claude under script(1), which
// allocates a pseudo-terminal so claude believes it has a TTY.
//
// The dispatch prompt is read from stdin (heredoc-friendly) and the result is
// emitted as a single JSON line on stdout. The parent's CLAUDECODE / CLAUDE_*
// environment is scrubbed so the child doesn't inherit interactive/resume
// state from the parent claude session.

import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TIMEOUT_MS = 120_000;
const CLAUDE_ENV_PREFIXES = ['CLAUDE_', 'CLAUDECODE'];

function scrubEnv(env) {
  const out = {};
  for (const [key, value] of Object.entries(env)) {
    if (CLAUDE_ENV_PREFIXES.some((p) => key === p || key.startsWith(p))) continue;
    out[key] = value;
  }
  return out;
}

async function readStdin() {
  let data = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) data += chunk;
  return data;
}

// Strip ANSI/VT control sequences and normalize CR so the regexes can match
// cleanly. PTYs emit CRLF and a lot of terminal setup sequences around the
// actual content; BSD script(1) also writes a literal "^D" marker on EOF.
function stripAnsi(s) {
  return s
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')   // OSC … BEL / ST
    .replace(/\x1b\[[0-?]*[ -\/]*[@-~]/g, '')             // CSI sequences
    .replace(/\x1b[PX^_][^\x1b]*\x1b\\/g, '')             // DCS/SOS/PM/APC
    .replace(/\x1b[\x30-\x7E]/g, '')                      // 2-byte ESC (incl. ESC 7/8)
    .replace(/\^[A-Z@\[\\\]^_]/g, '')                     // script(1) caret-letter EOF markers
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '');
}

// Match on the unique banner phrases without requiring start-of-line — the
// pty output can prefix the first line with terminal setup artifacts even
// after ANSI stripping.
function parseOutput(raw) {
  const name = raw.match(/Created remote session:\s*([^\r\n]+?)\s*$/m)?.[1]?.trim();
  const url = raw.match(/View:\s*(https?:\/\/\S+)/)?.[1]?.trim();
  const sessionId = raw.match(/Resume with:\s*claude --teleport\s+(\S+)/)?.[1]?.trim();
  if (!name || !url || !sessionId) return null;
  return { name, url, sessionId };
}

function buildScriptArgs(outFile, claudeArgs) {
  // BSD script (macOS): script [-aeFkpqr] file command [args...]
  //   -q : quiet
  //   -e : propagate child exit status
  // util-linux script: script [options] -c <command-string> [file]
  //   Needs `-c` and a single shell-quoted command string.
  if (process.platform === 'linux') {
    const shellCmd = claudeArgs
      .map((a) => `'${a.replace(/'/g, "'\\''")}'`)
      .join(' ');
    return ['-q', '-e', '-c', shellCmd, outFile];
  }
  return ['-q', '-e', outFile, ...claudeArgs];
}

function spawnRemote(prompt) {
  return new Promise((resolve) => {
    const dir = mkdtempSync(join(tmpdir(), 'fsd-dispatch-'));
    const outFile = join(dir, 'typescript');
    const args = buildScriptArgs(outFile, ['claude', '--remote', prompt]);
    const child = spawn('script', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: scrubEnv(process.env),
    });

    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 2_000);
    }, TIMEOUT_MS);

    child.stdout.on('data', () => {}); // drain; real output lives in outFile
    child.stderr.on('data', (c) => (stderr += c));

    const finish = (exitCode, spawnError) => {
      clearTimeout(timer);
      let raw = '';
      try { raw = readFileSync(outFile, 'utf8'); } catch {}
      try { rmSync(dir, { recursive: true, force: true }); } catch {}
      resolve({ exitCode, raw: stripAnsi(raw), stderr, spawnError });
    };

    child.on('error', (err) => finish(null, err.message));
    child.on('close', (exitCode) => finish(exitCode, null));
  });
}

function emit(obj, exitCode) {
  process.stdout.write(JSON.stringify(obj) + '\n');
  process.exit(exitCode);
}

async function main() {
  const prompt = (await readStdin()).trim();
  if (!prompt) emit({ ok: false, error: 'No prompt provided on stdin.' }, 2);

  const { exitCode, raw, stderr, spawnError } = await spawnRemote(prompt);

  if (spawnError) {
    emit({ ok: false, error: `Failed to spawn script/claude: ${spawnError}`, raw: raw.trim(), stderr: stderr.trim() }, 1);
  }

  const parsed = parseOutput(raw);

  if (exitCode !== 0 && !parsed) {
    emit({ ok: false, error: `claude --remote exited ${exitCode}`, stderr: stderr.trim(), raw: raw.trim() }, 1);
  }
  if (!parsed) {
    emit({ ok: false, error: 'Could not parse dispatch output.', raw: raw.trim(), stderr: stderr.trim() }, 1);
  }

  emit({ ok: true, ...parsed, raw: raw.trim() }, 0);
}

main().catch((err) => {
  process.stderr.write(`${err?.stack ?? err}\n`);
  process.exit(1);
});
