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
  row("One remove path (ER-19)", (out) => {
    const files = sources(["packages", "apps/kitchen-sink"]);
    const deletes = grep(files, /inventory\w*\s*\.\s*delete\(|\binventory\.delete\(/i);
    const removers = grep(files, /\b(removeHiredSeat|deleteOwnInventoryRow)\(/).filter((h) => !/^export (async )?function/.test(h.text));
    out.push(`$ grep inventory deletes in packages/ apps/kitchen-sink (non-test): ${deletes.length}`);
    for (const h of deletes) out.push(`  ${h.file}:${h.line}: ${h.text}`);
    out.push(`$ grep callers of removeHiredSeat / deleteOwnInventoryRow: ${removers.length}`);
    for (const h of removers) out.push(`  ${h.file}:${h.line}: ${h.text}`);
    const remove = "packages/workforce/src/roster/remove.ts";
    const blocks = "packages/workforce/src/seat-hire-blocks.ts";
    const strayDeletes = deletes.filter((h) => h.file !== remove);
    const [fireFrom, fireTo] = rangeOf(blocks, /const fireVerb\b/, /^  const \w+/);
    const [settleFrom, settleTo] = rangeOf(blocks, /const settle = async/, /^  const \w+/);
    const inBlocks = removers.filter((h) => h.file === blocks);
    const fireCalls = inBlocks.filter((h) => /removeHiredSeat\(/.test(h.text) && h.line >= fireFrom && h.line <= fireTo);
    const hireUndo = inBlocks.filter((h) => /deleteOwnInventoryRow\(/.test(h.text) && h.line >= settleFrom && h.line <= settleTo);
    const elsewhereInBlocks = inBlocks.filter((h) => !fireCalls.includes(h) && !hireUndo.includes(h));
    const appCallers = removers.filter((h) => h.file !== remove && h.file !== blocks);
    const appDirect = appCallers.filter((h) => !/removeHiredSeat\(/.test(h.text));
    out.push(`fire block ${blocks}:${fireFrom}-${fireTo} calls removeHiredSeat ${fireCalls.length} time(s)`);
    out.push(`a hire taking back its own just-published row (settle ${settleFrom}-${settleTo}): ${hireUndo.length} (an undo of the hire's own write, not a removal of a hired seat)`);
    out.push(`apps going through removeHiredSeat: ${appCallers.filter((h) => /removeHiredSeat\(/.test(h.text)).map((h) => `${h.file}:${h.line}`).join(", ") || "none"}`);
    if (strayDeletes.length > 0) out.push(`FAIL: an inventory row is deleted outside ${remove}`);
    if (fireCalls.length !== 1) out.push("FAIL: the fire block does not call the one removal exactly once");
    if (elsewhereInBlocks.length > 0) out.push("FAIL: the seat-hire blocks remove a seat outside fire");
    if (appDirect.length > 0) out.push("FAIL: an app deletes a seat's inventory row without the one removal");
    return strayDeletes.length === 0 && fireCalls.length === 1 && elsewhereInBlocks.length === 0 && appDirect.length === 0;
  });

  // ---- One orphan read (ER-5) ----------------------------------------------------
  row("One orphan read (ER-5)", (out) => {
    const files = sources(["packages", "apps/kitchen-sink", "labs", "goals/devforce-lab/lab"]);
    const classifies = grep(files, /reason:\s*"kind-gone"/);
    const callers = grep(files, /\bcheckHiredSeatRow\(/).filter((h) => !/^export (async )?function/.test(h.text));
    out.push(`$ grep 'reason: "kind-gone"': ${classifies.map((h) => `${h.file}:${h.line}`).join(", ")}`);
    out.push(`$ grep checkHiredSeatRow( callers: ${callers.map((h) => `${h.file}:${h.line}`).join(", ")}`);
    const blocks = "packages/workforce/src/seat-hire-blocks.ts";
    const [from, to] = rangeOf(blocks, /const brokenSeats = handler\(/, /^  const \w+/);
    const inBroken = callers.filter((h) => h.file === blocks && h.line >= from && h.line <= to);
    const host = readFileSync(join(REPO_ROOT, "goals/devforce-lab/lab/host.mts"), "utf8");
    const viaCapability = /createSeatHireCapability\(/.test(host);
    out.push(`brokenSeats (${blocks}:${from}-${to}) calls it ${inBroken.length} time(s); the DevTeam host installs createSeatHireCapability: ${viaCapability}`);
    const ok = classifies.length === 1 && classifies[0]!.file === "packages/workforce/src/roster/check.ts" && inBroken.length === 1 && viaCapability;
    if (!ok) out.push("FAIL: kind-gone is classified other than by roster/check.ts, or CoS's brokenSeats does not resolve to it");
    return ok;
  });

  // ---- The DevTeam tree and host -------------------------------------------------
  row("The DevTeam tree and host", (out) => {
    const tree = join(REPO_ROOT, "goals/devforce-lab/lab/workforce");
    const toolsOf = (file: string) => {
      const m = /^tools:\s*\[(.*)\]\s*$/m.exec(readFileSync(file, "utf8"));
      return m === null ? [] : m[1]!.split(",").map((t) => t.trim()).filter(Boolean);
    };
    const cos = toolsOf(join(tree, "org/workers/chief-of-staff/WORKER.md"));
    // PLAN's six, plus `post-to-mailbox`: FIX-1719's S6 gives CoS "discover, post to mailboxes".
    const want = ["hire", "fire", "rehire", "brokenSeats", "createProject", "setWorkstreams", "post-to-mailbox"];
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
        if (tools.some((t) => ["hire", "fire", "rehire", "brokenSeats"].includes(t))) hirers.push(`${team}.${w}`);
      }
    }
    if (hirers.length > 0) out.push(`FAIL: team seats naming a hire tool: ${hirers.join(", ")}`);
    return cosOk && hirers.length === 0;
  });

  // ---- Gap copy (ER-8) -------------------------------------------------------------
  row("Gap copy (ER-8)", (out) => {
    const files = sources(["labs/shift-manager/src"]);
    const stale = grep(files, /FIX-1650|arrives? with FIX-1(718|719|621)|once org seats ship|org seats ship|wait(s|ing)? (on|for) org seats/i);
    out.push(`$ grep labs/shift-manager/src for copy that something arrives with FIX-1650 or waits on org seats: ${stale.length}`);
    for (const h of stale) out.push(`  ${h.file}:${h.line}: ${h.text}`);
    const pick = (text: string) => text.split("\n").filter((l) => /FIX-165[12]/.test(l));
    const now = pick(readFileSync(join(REPO_ROOT, "labs/shift-manager/src/gaps.ts"), "utf8"));
    const then = pick(git("show", `${base}:labs/shift-manager/src/gaps.ts`));
    const added = now.filter((l) => !then.includes(l));
    const removed = then.filter((l) => !now.includes(l));
    out.push(`$ FIX-1651/FIX-1652 lines of gaps.ts, ${base.slice(0, 9)} → commit: ${then.length} → ${now.length}, added ${added.length}, removed ${removed.length}`);
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
      if (pathHit || (status === "A" && contentHits.length > 0) || contentHits.length > 0) naming.push(`${status} ${file}: ${pathHit ? "path names it; " : ""}${contentHits.slice(0, 3).map((l) => l.trim().slice(0, 120)).join(" | ")}`);
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

  // ---- Vocabulary (ER-13) ---------------------------------------------------------------
  const PAGES = [
    "apps/docs/docs/workforce/overview.md",
    "apps/docs/docs/workforce/mailboxes.md",
    "apps/docs/docs/workforce/projects.md",
    "apps/docs/docs/workforce/chief-of-staff.md",
    "apps/docs/docs/workforce/durable-hire.md",
    "labs/shift-manager/README.md",
  ];
  row("Vocabulary (ER-13)", (out) => {
    // The lines the set's own commits added to the pages it published, still on the commit.
    const commits = git("log", "--format=%H %s", "--no-merges", "-E", "--grep=FIX-(1621|1718|1719)\\b", `${base}..HEAD`, "--", ...PAGES)
      .split("\n")
      .filter(Boolean);
    const added = new Map<string, Set<string>>();
    for (const c of commits) {
      const sha = c.split(" ")[0]!;
      let file = "";
      for (const l of git("show", "--format=", "-U0", sha, "--", ...PAGES).split("\n")) {
        if (l.startsWith("+++ ")) file = l.slice(6);
        else if (l.startsWith("+") && !l.startsWith("+++")) (added.get(file) ?? added.set(file, new Set()).get(file)!).add(l.slice(1));
      }
    }
    const hits: string[] = [];
    for (const page of PAGES) {
      if (!existsSync(join(REPO_ROOT, page))) continue;
      let fenced = false;
      readFileSync(join(REPO_ROOT, page), "utf8")
        .split("\n")
        .forEach((line, i) => {
          if (/^\s*(```|~~~)/.test(line)) {
            fenced = !fenced;
            return;
          }
          if (fenced || !(added.get(page)?.has(line) ?? false)) return;
          // Prose only: inline code, links' targets and paths are not nouns.
          const prose = line
            .replace(/`[^`]*`/g, "")
            .replace(/\]\([^)]*\)/g, "]")
            .replace(/\S*workers?\/\S*/gi, "")
            .replace(/WORKER\.md/g, "");
          if (/\bworkers?\b/i.test(prose)) hits.push(`${page}:${i + 1}: ${line.trim().slice(0, 200)}`);
        });
    }
    out.push(`$ prose lines the FIX-1621/1718/1719 commits (${commits.length}) added to the published pages, still on the commit, saying "worker" outside a path or code: ${hits.length}`);
    for (const h of hits) out.push(`  ${h}`);
    if (hits.length > 0) out.push('FAIL: published prose calls a seat a "worker"');
    return hits.length === 0;
  });

  // ---- Docs published (ER-18) -------------------------------------------------------------
  row("Docs published (ER-18)", (out) => {
    const has = (page: string, re: RegExp) => existsSync(join(REPO_ROOT, page)) && re.test(readFileSync(join(REPO_ROOT, page), "utf8"));
    const owned: Array<[string, string, RegExp]> = [
      ["the shared section, projects and workstreams (FIX-1718)", "apps/docs/docs/workforce/overview.md", /^## Projects, workstreams, and the seats that run them\n[\s\S]*?\bproject groups workstreams\b/im],
      ["the shared section, org seat and mailbox (FIX-1719)", "apps/docs/docs/workforce/overview.md", /^## Projects, workstreams, and the seats that run them\n[\s\S]*?chief of staff[\s\S]*?(approve)/im],
      ["A room per project (FIX-1718)", "apps/docs/docs/workforce/mailboxes.md", /^## A room per project$/m],
      ["Asking CoS for a project (FIX-1718)", "apps/docs/docs/workforce/projects.md", /^# Projects$[\s\S]*chief of staff/m],
      ["Shift Manager's PROJECTS (FIX-1718)", "labs/shift-manager/README.md", /^## What you see$[\s\S]*?PROJECTS/m],
      ["The CoS page (FIX-1719)", "apps/docs/docs/workforce/chief-of-staff.md", /^# The chief of staff$[\s\S]*?^## Adding one$[\s\S]*?askBefore/m],
      ["Repairing a seat whose kind is gone (FIX-1621)", "apps/docs/docs/workforce/durable-hire.md", /^## Repairing a seat whose kind is gone$/m],
    ];
    let ok = true;
    for (const [what, page, re] of owned) {
      const found = has(page, re);
      ok &&= found;
      out.push(`${found ? "found" : "FAIL: missing"} ${what}: ${page} ${re.source.slice(0, 70)}`);
    }
    const notYet = /^## What isn't here yet$([\s\S]*?)^## /m.exec(readFileSync(join(REPO_ROOT, "labs/shift-manager/README.md"), "utf8"))?.[1] ?? "";
    const stillThere = /^\s*[-*]\s+\**Projects\b/im.test(notYet);
    out.push(`"What isn't here yet" ${stillThere ? "FAIL: still lists" : "no longer lists"} a Projects bullet`);
    return ok && !stillThere;
  });

  return rows;
}
