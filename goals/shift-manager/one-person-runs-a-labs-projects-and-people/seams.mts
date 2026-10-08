/**
 * Part 4: the epic's seams and its Layer 1 fence, each a scripted assertion
 * (a grep, a parse or a `git diff` from the today's-main control to the
 * commit), never a reading. Only what parts 1 to 3 don't grade.
 *
 * Every row prints what it executed and what it found, so the report quotes
 * the output, not a summary of it.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { REPO_ROOT } from "../../lib/index.mts";

export interface SeamRow {
  check: string;
  ok: boolean;
  output: string[];
}

const git = (...args: string[]) => execFileSync("git", ["-C", REPO_ROOT, ...args], { encoding: "utf8", maxBuffer: 1 << 26 });

/** Every non-test source file under `dirs`, as repo-relative paths. */
function sources(dirs: string[], exts = [".ts", ".tsx", ".mts"]): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (name === "node_modules" || name === "dist" || name === ".next" || name.startsWith(".")) continue;
      const path = join(dir, name);
      if (statSync(path).isDirectory()) {
        if (name === "test" || name === "tests" || name === "__tests__") continue;
        walk(path);
      } else if (exts.some((e) => name.endsWith(e)) && !/\.(test|spec)\.[cm]?tsx?$/.test(name)) out.push(relative(REPO_ROOT, path));
    }
  };
  for (const d of dirs) if (existsSync(join(REPO_ROOT, d))) walk(join(REPO_ROOT, d));
  return out;
}

/** `file:line: text` for every line of `files` matching `re`. */
function grep(files: string[], re: RegExp): Array<{ file: string; line: number; text: string }> {
  const hits: Array<{ file: string; line: number; text: string }> = [];
  for (const file of files) {
    readFileSync(join(REPO_ROOT, file), "utf8")
      .split("\n")
      .forEach((text, i) => {
        if (re.test(text)) hits.push({ file, line: i + 1, text: text.trim() });
      });
  }
  return hits;
}

/** The line range of the block that starts at the first line matching `start` and ends before the next line matching `end`. */
function rangeOf(file: string, start: RegExp, end: RegExp): [number, number] {
  const lines = readFileSync(join(REPO_ROOT, file), "utf8").split("\n");
  const from = lines.findIndex((l) => start.test(l));
  if (from < 0) return [0, -1];
  const to = lines.findIndex((l, i) => i > from && end.test(l));
  return [from + 1, to < 0 ? lines.length : to];
}

export function seams(base: string): SeamRow[] {
  const rows: SeamRow[] = [];
  const row = (check: string, run: (out: string[]) => boolean) => {
    const output: string[] = [];
    let ok = false;
    try {
      ok = run(output);
    } catch (error) {
      output.push(`threw: ${(error as Error).message}`);
    }
    rows.push({ check, ok, output });
  };

  // ---- One remove path (ER-19) --------------------------------------------------
  // A worker the person hires is a row on their own roster (FIX-1788). The one
  // place a row is deleted is Workforce's fire block, which both the roster
  // flow's `fire` and the chief of staff's `fire` tool run.
  row("One remove path (ER-19)", (out) => {
    const files = sources(["packages", "apps/kitchen-sink"]).filter((f) => /WORKERS_RESOURCE|WORKERS_PATTERN|workforceWorkers|workforce\/workers\//.test(readFileSync(join(REPO_ROOT, f), "utf8")));
    const deletes = grep(files, /\.delete\(/);
    out.push(`$ files that reach a person's worker rows (packages/, apps/kitchen-sink, non-test): ${files.join(", ")}`);
    out.push(`$ grep .delete( in them: ${deletes.length}`);
    for (const h of deletes) out.push(`  ${h.file}:${h.line}: ${h.text}`);
    const blocks = "packages/workforce/src/workers/hire-blocks.ts";
    const [fireFrom, fireTo] = rangeOf(blocks, /const fire = handler\(/, /^  return \{/);
    const inFire = deletes.filter((h) => h.file === blocks && h.line >= fireFrom && h.line <= fireTo);
    out.push(`the fire block (${blocks}:${fireFrom}-${fireTo}) deletes ${inFire.length} time(s)`);
    if (inFire.length !== 1) out.push("FAIL: the fire block does not delete the worker's row exactly once");
    if (deletes.length !== inFire.length) out.push("FAIL: a worker's row is deleted outside the fire block");
    return inFire.length === 1 && deletes.length === inFire.length;
  });

  // ---- One load path (ER-5) ------------------------------------------------------
  // There is no orphan to read: a stored worker that can't run is refused when
  // its turn loads it (FIX-1788 BR-19, BR-22). One path decides it, so a hire's
  // check and a turn refuse the same things: every refusal is thrown by
  // `resolveWorker`, and the hire's check and the turn both go through `mint`.
  row("One load path (ER-5)", (out) => {
    const refusals = grep(sources(["packages", "apps/kitchen-sink"]), /new WorkerTurnRefusedError\(/);
    const model = "packages/workforce/src/workers/installation.ts";
    const [turnFrom, turnTo] = rangeOf(model, /const resolveWorker = async/, /^  const \w+ = /);
    const [checkFrom, checkTo] = rangeOf(model, /const configurationProblems = /, /^  const \w+ = /);
    const mints = grep([model], /\bmint\(/);
    const inTurn = mints.filter((h) => h.line >= turnFrom && h.line <= turnTo);
    const inCheck = mints.filter((h) => h.line >= checkFrom && h.line <= checkTo);
    out.push(`$ grep 'new WorkerTurnRefusedError(' (packages/, apps/kitchen-sink, non-test): ${refusals.map((h) => `${h.file}:${h.line}`).join(", ")}`);
    out.push(`resolveWorker (${model}:${turnFrom}-${turnTo}) calls mint ${inTurn.length} time(s); configurationProblems (${checkFrom}-${checkTo}) ${inCheck.length}`);
    const stray = refusals.filter((h) => h.file !== model || h.line < turnFrom || h.line > turnTo);
    if (refusals.length === 0 || stray.length > 0) out.push("FAIL: a turn's worker is refused somewhere other than resolveWorker");
    if (inTurn.length !== 1 || inCheck.length !== 1) out.push("FAIL: the hire's check and the turn don't both decide through mint");
    return refusals.length > 0 && stray.length === 0 && inTurn.length === 1 && inCheck.length === 1;
  });

  // ---- The DevTeam tree and host -------------------------------------------------
  row("The DevTeam tree and host", (out) => {
    const tree = join(REPO_ROOT, "packages/shift-manager/teams/devteam/workforce");
    const toolsOf = (file: string) => {
      const m = /^tools:\s*\[(.*)\]\s*$/m.exec(readFileSync(file, "utf8"));
      return m === null ? [] : m[1]!.split(",").map((t) => t.trim()).filter(Boolean);
    };
    const cos = toolsOf(join(tree, "org/workers/chief-of-staff/WORKER.md"));
    // PLAN's six less `rehire` and `brokenSeats`, which FIX-1788 retired; `post-to-mailbox` (FIX-1719's S6
    // gives CoS "discover, post to mailboxes"); and `setRepository` (FIX-1762).
    const want = ["hire", "fire", "createProject", "setWorkstreams", "setRepository", "post-to-mailbox"];
    out.push(`CoS tools: [${cos.join(", ")}]`);
    const cosOk = JSON.stringify([...cos].sort()) === JSON.stringify([...want].sort());
    if (!cosOk) out.push(`FAIL: wanted [${want.join(", ")}]`);
    const teams = join(tree, "teams");
    const hirers: string[] = [];
    for (const team of readdirSync(teams)) {
      const workers = join(teams, team, "workers");
      if (!existsSync(workers)) continue;
      for (const w of readdirSync(workers)) {
        const doc = join(workers, w, "WORKER.md");
        if (!existsSync(doc)) continue;
        const tools = toolsOf(doc);
        out.push(`${team}.${w} tools: [${tools.join(", ")}]`);
        if (tools.some((t) => ["hire", "fire"].includes(t))) hirers.push(`${team}.${w}`);
      }
    }
    if (hirers.length > 0) out.push(`FAIL: team seats naming a hire tool: ${hirers.join(", ")}`);
    return cosOk && hirers.length === 0;
  });

  // ---- Gap copy (ER-8) -------------------------------------------------------------
  row("Gap copy (ER-8)", (out) => {
    const files = sources(["packages/shift-manager/src"]);
    const stale = grep(files, /FIX-1650|arrives? with FIX-1(718|719|621)|once org seats ship|org seats ship|wait(s|ing)? (on|for) org seats/i);
    out.push(`$ grep packages/shift-manager/src for copy that something arrives with FIX-1650 or waits on org seats: ${stale.length}`);
    for (const h of stale) out.push(`  ${h.file}:${h.line}: ${h.text}`);
    // Only this epic's own commits are graded: another epic (FIX-1737's v2 look) may reword these entries.
    // The file moved with Shift Manager (labs/ to packages/); the epic's earlier commits touched the old path.
    const gaps = "packages/shift-manager/src/gaps.ts";
    const gapPaths = ["labs/shift-manager/src/gaps.ts", gaps];
    const epicCommits = git("log", "--format=%H %s", "--no-merges", "-E", "--grep=FIX-(1621|1718|1719|1720|1722|1723|175[2-8])\\b", `${base}..HEAD`, "--", ...gapPaths)
      .split("\n")
      .filter(Boolean);
    const added: string[] = [];
    const removed: string[] = [];
    for (const c of epicCommits) {
      for (const l of git("show", "--format=", "-U0", c.split(" ")[0]!, "--", ...gapPaths).split("\n")) {
        if (!/FIX-165[12]/.test(l)) continue;
        if (l.startsWith("+") && !l.startsWith("+++")) added.push(l.slice(1));
        else if (l.startsWith("-") && !l.startsWith("---")) removed.push(l.slice(1));
      }
    }
    out.push(`$ FIX-1651/FIX-1652 lines of ${gaps} the epic's own commits (${epicCommits.length}: ${epicCommits.map((c) => c.slice(0, 9)).join(", ")}) since ${base.slice(0, 9)} added ${added.length}, removed ${removed.length}`);
    for (const l of [...added.map((x) => `+ ${x.trim()}`), ...removed.map((x) => `- ${x.trim()}`)]) out.push(`  ${l}`);
    if (stale.length > 0) out.push("FAIL: gap copy still says something waits on this epic");
    if (added.length + removed.length > 0) out.push("FAIL: FIX-1651's or FIX-1652's entries changed");
    return stale.length === 0 && added.length + removed.length === 0;
  });

  // ---- Layer fence (ER-10, ER-11, ER-22) ----------------------------------------------
  row("Layer fence (ER-10, ER-11, ER-22)", (out) => {
    const changed = git("diff", "--name-status", `${base}`, "HEAD", "--", "packages/core", "packages/engine")
      .split("\n")
      .filter(Boolean)
      .map((l) => l.split("\t"));
    const naming: string[] = [];
    for (const [status, file] of changed) {
      if (file === undefined) continue;
      const pathHit = /project|workstream|chief.?of.?staff|admin.?seat/i.test(file);
      const addedLines = git("diff", base, "HEAD", "-U0", "--", file)
        .split("\n")
        .filter((l) => l.startsWith("+") && !l.startsWith("+++"));
      // Type-cased `Project`/`Workstream` (a lowercase `project` is a projection function here), and any CoS or admin-seat name.
      const contentHits = addedLines.filter((l) => /\b(Project|Workstream)s?\b/.test(l) || /chief.?of.?staff|admin.?seat/i.test(l));
      if (pathHit || contentHits.length > 0) naming.push(`${status} ${file}: ${pathHit ? "path names it; " : ""}${contentHits.slice(0, 3).map((l) => l.trim().slice(0, 120)).join(" | ")}`);
    }
    out.push(`$ git diff ${base.slice(0, 9)}..HEAD packages/core packages/engine: ${changed.length} file(s) changed; naming a Project, Workstream, CoS or admin seat: ${naming.length}`);
    for (const n of naming) out.push(`  ${n}`);
    const addedPaths = git("diff", "--name-only", "--diff-filter=A", base, "HEAD").split("\n").filter(Boolean);
    // A Lab tree's `workforce/projects/` or `workforce/agents/` folder; `packages/workforce/src/projects/`
    // is the package's own source module, not a tree folder.
    const all = addedPaths.filter((p) => (/(^|\/)workforce\/(projects|agents)\//.test(p) && !p.startsWith("packages/")) || /(^|\/)MAILBOXES\.md$/.test(p));
    out.push(`$ added paths under a tree's workforce/projects/ or workforce/agents/, or named MAILBOXES.md: ${all.length}`);
    for (const p of all) out.push(`  ${p}`);
    const keysOf = (text: string) => {
      const m = /const DECLARABLE_KEYS = \[([\s\S]*?)\] as const;/.exec(text);
      // The boards key's constant was renamed with the mailbox; it is the same key.
      return m === null ? undefined : m[1]!.split(",").map((k) => k.trim().replace(/^\w+_BOARDS_KEY$/, "BOARDS_KEY")).filter(Boolean);
    };
    // The binder moved with the mailbox rename: the base's is found by name, not spelled.
    const baseBinder = git("ls-tree", "-r", "--name-only", base, "packages/workforce/src").split("\n").find((p) => /\/\w+-binder\.ts$/.test(p));
    const binder = "packages/workforce/src/mailbox/mailbox-binder.ts";
    const before = baseBinder === undefined ? undefined : keysOf(git("show", `${base}:${baseBinder}`));
    const after = keysOf(readFileSync(join(REPO_ROOT, binder), "utf8"));
    const gained = (after ?? []).filter((k) => !(before ?? []).includes(k));
    const lost = (before ?? []).filter((k) => !(after ?? []).includes(k));
    out.push(`$ MAILBOX.md DECLARABLE_KEYS ${base.slice(0, 9)} → commit: [${before?.join(", ")}] → [${after?.join(", ")}]; gained [${gained.join(", ")}], lost [${lost.join(", ")}]`);
    const keysOk = before !== undefined && after !== undefined && JSON.stringify(gained) === JSON.stringify(["MINT_FOR_KEY"]) && lost.length === 0;
    if (naming.length > 0) out.push("FAIL: core or engine gained a Project, Workstream, CoS or admin-seat name");
    if (all.length > 0) out.push("FAIL: a forbidden tree folder or MAILBOXES.md was added");
    if (!keysOk) out.push("FAIL: MAILBOX.md's key list gained something other than mintFor");
    return naming.length === 0 && all.length === 0 && keysOk;
  });

  // ---- Docs published (ER-18) -------------------------------------------------------------
  row("Docs published (ER-18)", (out) => {
    const has = (page: string, re: RegExp) => existsSync(join(REPO_ROOT, page)) && re.test(readFileSync(join(REPO_ROOT, page), "utf8"));
    const owned: Array<[string, string, RegExp]> = [
      ["the shared section, projects and workstreams (FIX-1718)", "apps/docs/docs/workforce/overview.md", /^## Projects and the chief of staff\n[\s\S]*?\bproject\b\W* groups workstreams\b/im],
      ["the shared section, org seat and mailbox (FIX-1719)", "apps/docs/docs/workforce/overview.md", /^## Projects and the chief of staff\n[\s\S]*?chief of staff[\s\S]*?(approve)/im],
      ["A room per project (FIX-1718)", "apps/docs/docs/workforce/mailboxes.md", /^## A room per project$/m],
      ["Asking CoS for a project (FIX-1718)", "apps/docs/docs/workforce/projects.md", /^# Projects$[\s\S]*chief of staff/m],
      ["Shift Manager's PROJECTS (FIX-1718)", "packages/shift-manager/README.md", /^## What you see$[\s\S]*?PROJECTS/m],
      ["The CoS page (FIX-1719)", "apps/docs/docs/workforce/chief-of-staff.md", /^# The chief of staff$[\s\S]*?^## Adding one$[\s\S]*?^## What asks first$[\s\S]*?"reason": "human_approval"/m],
      // FIX-1621's repair of a seat whose kind is gone was retired by FIX-1788: a worker is a row its owner fires or edits.
      ["Changing or firing a worker (FIX-1788, in place of FIX-1621)", "apps/docs/docs/workforce/durable-hire.md", /^## Changing or firing a worker$[\s\S]*?`fire` deletes the row/m],
    ];
    let ok = true;
    for (const [what, page, re] of owned) {
      const found = has(page, re);
      ok &&= found;
      out.push(`${found ? "found" : "FAIL: missing"} ${what}: ${page} ${re.source.slice(0, 70)}`);
    }
    const notYet = /^## What isn't here yet$([\s\S]*?)^## /m.exec(readFileSync(join(REPO_ROOT, "packages/shift-manager/README.md"), "utf8"))?.[1] ?? "";
    const stillThere = /^\s*[-*]\s+\**Projects\b/im.test(notYet);
    out.push(`"What isn't here yet" ${stillThere ? "FAIL: still lists" : "no longer lists"} a Projects bullet`);
    return ok && !stillThere;
  });

  return rows;
}
