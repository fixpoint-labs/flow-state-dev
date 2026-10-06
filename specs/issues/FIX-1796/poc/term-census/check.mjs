#!/usr/bin/env node
/**
 * FIX-1796 · count and classify every retired Workforce term.
 *
 * Experimental evidence for the spec's factual base and the shape of its goal
 * check, not production code. Run from the repository root:
 *
 *   node specs/issues/FIX-1796/poc/term-census/check.mjs              # the census
 *   node specs/issues/FIX-1796/poc/term-census/check.mjs --list seat  # every unswept line of one term
 *   node specs/issues/FIX-1796/poc/term-census/check.mjs --control    # must print CONTROL PASS
 *
 * TOTALITY, twice over. Every tracked file lands in exactly one area, in scope
 * or out of it, or the run fails naming it: a new top-level folder nobody
 * classified is the hole a remembered list can't see. Then every match of a
 * retired term on a line of an in-scope file is either removed by a named
 * exception or counted as unswept, and any unswept match fails the run.
 *
 * Exceptions STRIP a token from the line; they never pass a whole line or a
 * whole file. So a second retired word on an excepted line still counts, and
 * a stored key strips alone, never the rest of the quoted literal it opens.
 * Each exception names the terms it may strip, and the rule or decision
 * behind it. An exception that strips nothing fails the run: an exception
 * nobody needs is a hole waiting for a live use.
 *
 * Ground is decided by SURFACE, not by folder. Workforce's ground is its own
 * packages and pages, plus any file that imports Workforce or Shift Manager.
 * The task board keeps "seat" (D1): its named types strip anywhere, and its
 * bare word strips only in the board's own files, a closed list that may
 * never touch Workforce's ground. "Hired seat" counts everywhere.
 *
 * `--control` adds planted files to the scan (in memory; the tree is not
 * touched) and requires each planted line to fail for the term it hides, and a
 * planted folder to fail totality. A green run nobody has seen go red proves
 * nothing (tenet 7).
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

/** First match wins. `scope: true` is swept; `false` keeps its words by design. */
const AREAS = [
  { id: "history", scope: false, re: /^specs\/|^spec\/|^spec-poc|^docs\/internal\/|(^|\/)CHANGELOG\.md$|^\.changeset\/|^apps\/docs\/blog\/|^docs\/atlas\/|^docs\/superpowers\/|^pnpm-lock\.yaml$/, why: "dated records: no rewriting history" },
  { id: "process", scope: false, re: /^\.agents\/|^\.omp\/|^\.github\/|^\.claude\/|^\.cursor\/|^plugins\/|^scripts\/|^docs\/contributing\/|^docs\/(philosophy|objectives|PROMPT_CACHING)\.md$|^docs\/assets\/|^(CLAUDE|AGENTS|CONTRIBUTING|CODE_OF_CONDUCT|SECURITY|compound-engineering\.local)\.md$/, why: "process tooling and contributor instructions" },
  { id: "goals", scope: false, re: /^goals\//, why: "tests of behaviour: renamed identifiers reach them through typecheck, their words stay" },
  { id: "config", scope: false, re: /^[^/]+\.(json|ya?ml)$|^LICENSE$|^\.gitignore$|^\.ignore$/, why: "root configuration" },
  { id: "package-src", scope: true, re: /^packages\/[^/]+\/src\// },
  { id: "package-tests", scope: true, re: /^packages\/[^/]+\/(test|tests|e2e)\// },
  { id: "package-other", scope: true, re: /^packages\// },
  { id: "docs-site", scope: true, re: /^apps\/docs\// },
  { id: "apps", scope: true, re: /^apps\// },
  { id: "labs", scope: true, re: /^labs\// },
  { id: "examples", scope: true, re: /^examples\// },
  { id: "reference-docs", scope: true, re: /^docs\/architecture\/|^README\.md$/ },
];

/**
 * Where a word also has a live meaning elsewhere, it is retired only on Workforce's ground:
 * Workforce's own paths, or any file that imports Workforce or Shift Manager (a consumer such as
 * kitchen-sink's seat pane, or a React panel, is Workforce's surface wherever it sits).
 */
const WORKFORCE_PATHS = /^packages\/(workforce|shift-manager)\/|^apps\/docs\/docs\/(workforce|shift-manager)\/|^apps\/docs\/docs\/glossary|workforce/i;
const WORKFORCE_IMPORT = /["']@flow-state-dev\/(?:workforce|shift-manager)(?:\/[^"']*)?["']/;
const onWorkforceGround = (path, text) => WORKFORCE_PATHS.test(path) || WORKFORCE_IMPORT.test(text);

/**
 * The task board's own files (D1: the board keeps "seat"). A closed list, by module, never by a
 * folder a Workforce consumer could fall into; a listed file on Workforce's ground fails the run.
 */
const BOARD_FILES = /^packages\/orchestration\/(?:src|test)\/task-board\/|^packages\/core\/src\/types\/dispatch\.ts$|^apps\/docs\/docs\/orchestration\/(?:task-board\.md|task-board-parts\.svg|configuration\.md)$/;

/** The retired terms (the epic concept's table). `ground: "workforce"` scans only WORKFORCE_GROUND. */
const TERMS = [
  { id: "seat", re: /seat/gi, say: "worker; on a task board, assignee" },
  { id: "hired-roster", re: /hired[ _-]?roster/gi, say: "roster" },
  { id: "mailbox", re: /mailbox/gi, say: "coordinator; a member is a delegate" },
  { id: "member", re: /\b[Mm]embers?\b|\bMEMBERS?\b|[Mm]ember(?=[A-Z_])|(?<=[a-z])Members?\b/g, ground: "workforce", say: "delegate, where it means a mailbox member" },
  { id: "thread", re: /\bthreads?\b/gi, ground: "workforce", say: "the delegate's session, where it means a mailbox thread" },
  { id: "room", re: /\b[Rr]ooms?\b|room-(?:lines|seq|answers|deliveries)|Room[A-Z]\w*|\broom[A-Z]\w*|\bROOM_\w*/g, say: "the project coordinator" },
  { id: "talk-session", re: /talk[ _-]?sessions?|talk-?template|talkFor\b|\bTALK_\w+/gi, say: "the project coordinator" },
  { id: "person", re: /\bpersons?\b|\bperson's\b/gi, say: "user, where it means the signed-in user" },
  { id: "kind", re: /kind/gi, ground: "workforce", say: "worker flow, where it means the flow a worker runs on" },
  { id: "owner-pin", re: /owner[ _-]?pins?/gi, ground: "workforce", say: "access to the worker resource" },
  { id: "flow-instance", re: /flow[ _-]?instances?|cardinality:\s*"collection"/gi, ground: "workforce", say: "worker resource, run by the singleton flow it names" },
];

/**
 * Tokens stripped before matching. `terms` bounds what each may hide.
 * Only the first group is decided today; the rest is the implementer's to add,
 * one pinned token at a time (PLAN.md, the exception classes).
 */
const EXCEPTIONS = [
  { id: "field-named-kind", terms: ["kind"], strip: /\bflowKinds?\b|\bkind\s*\??:|\.kind\b|\bkind\s*[!=]==?|["']kind["']/g, why: "a field named kind: the engine's flow kind or a type discriminant (ER-22)" },
  { id: "english-kind-of", terms: ["kind"], strip: /\b(?:a|an|any|one|the same|this|that|what|which|some|every|each|another|other|same|no)\s+kinds?\s+of\b|\bkinds\s+of\b|\bkindly\b/gi, why: "the English 'a kind of'" },
  { id: "other-kinds", terms: ["kind"], strip: /\b(?:block|item|content|event|channel|part|tool|error|message|node|trace|step)[ -]kinds?\b/gi, why: "another subsystem's kind" },
  { id: "core-flow-instance-type", terms: ["flow-instance"], strip: /\b(?:Any)?FlowInstance\w*|\bisFlowInstance\b|\bcreateFlowInstance\b/g, why: "core's type for any registered flow; the engine keeps the term (FIX-1798)" },
  { id: "mailbox-md-refusal", terms: ["mailbox"], strip: /MAILBOX\.md(?=.*WORKER\.md)|(?<=WORKER\.md.*)MAILBOX\.md/g, why: "ER-6: the refusal and the conversion name the old file" },
  { id: "english-room", terms: ["room"], strip: /\b(?:make|makes|making|made|leave|leaves|leaving|left|have|has|had|ran out of|run out of|out of|given|give|gives|enough|reserve|reserves|reserved|no|more|less|little|plenty of)\s+room\b|\broom\s+(?:for|to)\b|room-temperature/gi, why: "the English 'room for'" },
  { id: "stored-key-names", terms: ["seat", "mailbox", "room", "hired-roster", "member"], strip: /(?<=["'`])(?:inventory\/(?:seats|mailboxes|members)|workforce\/roster|room-(?:lines|seq|answers|deliveries)|hiredRoster(?:Private)?)[\w\/*.:${}-]*/g, why: "D2: a name only storage sees keeps its string; the key strips, never the rest of its literal" },
  { id: "board-seat-names", terms: ["seat"], strip: /\b(?:TaskSeat|HandOffSeat)\w*|\b\w*ToolSeats?\w*|\btoolSeat\w*|\btool[ -]seats?\b|\bhandOffBySeat\b|\binlineSeats\b/g, why: "D1: the task board's named types keep seat, wherever they are used" },
  { id: "board-seat-words", terms: ["seat"], files: BOARD_FILES, strip: /(?<!hired[ _-]?|[Ww]orkforce[ _-]?)\b[Ss]eats?\b/g, why: "D1: the board's own word, in the board's own files; a hired seat still counts" },
  { id: "manifest-domain-names", terms: ["seat", "mailbox"], strip: /(?<=(?:MANIFEST_DOMAINS|\bdomains?\b)[^\n]*?)["'](?:seats|mailboxes)["']/g, why: "D1: the discovery tool's domain names are pinned, model-facing strings (ER-22)" },
  { id: "project-member", terms: ["member"], strip: /\b(?:project|org|organization|team)(?:'s)?\s+members?\b|\b(?:project|org)Members?\b/gi, why: "a project's or an org's member is a user, not a mailbox's" },
  { id: "chat-thread", terms: ["thread"], strip: /\bchat[ -]threads?\b/gi, why: "a chat thread in the UI, not a mailbox's" },
];

const TERM_IDS = new Set(TERMS.map((t) => t.id));
for (const e of EXCEPTIONS) for (const t of e.terms) if (!TERM_IDS.has(t)) throw new Error(`exception ${e.id} names unknown term ${t}`);

const BINARY = /\.(png|jpe?g|gif|ico|webp|woff2?|ttf|otf|pdf|zip|gz)$/i;

function trackedFiles() {
  return execFileSync("git", ["ls-files"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
    .split("\n")
    .filter(Boolean);
}

function areaOf(path) {
  return AREAS.find((a) => a.re.test(path));
}

/** Scan one in-scope file. Returns [{ term, line, text }] unswept, and counts exemptions. */
function scanFile(path, text, exemptCounts, totals) {
  const unswept = [];
  const workforce = onWorkforceGround(path, text);
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    for (const term of TERMS) {
      if (term.ground === "workforce" && !workforce) continue;
      const raw = lines[i];
      term.re.lastIndex = 0;
      const before = (raw.match(term.re) ?? []).length;
      if (before === 0) continue;
      let line = raw;
      for (const e of EXCEPTIONS) {
        if (!e.terms.includes(term.id)) continue;
        if (e.files && !e.files.test(path)) continue;
        e.strip.lastIndex = 0;
        const stripped = line.replace(e.strip, " ");
        if (stripped !== line) {
          term.re.lastIndex = 0;
          const left = (stripped.match(term.re) ?? []).length;
          term.re.lastIndex = 0;
          const had = (line.match(term.re) ?? []).length;
          if (left < had) exemptCounts[e.id] = (exemptCounts[e.id] ?? 0) + (had - left);
          line = stripped;
        }
      }
      term.re.lastIndex = 0;
      const after = (line.match(term.re) ?? []).length;
      const t = (totals[term.id] ??= { lines: 0, files: new Set(), unsweptLines: 0, unsweptFiles: new Set(), byArea: {} });
      t.lines += 1;
      t.files.add(path);
      if (after > 0) {
        t.unsweptLines += 1;
        t.unsweptFiles.add(path);
        unswept.push({ term: term.id, line: i + 1, text: raw.trim().slice(0, 160) });
      }
    }
  }
  return unswept;
}

function census(extra = {}) {
  const files = [...trackedFiles(), ...Object.keys(extra)];
  const unscoped = [];
  const areaCounts = {};
  const exemptCounts = {};
  const totals = {};
  const unsweptByFile = new Map();
  const boardOnWorkforce = [];
  for (const path of files) {
    const area = areaOf(path);
    if (!area) {
      unscoped.push(path);
      continue;
    }
    areaCounts[area.id] = (areaCounts[area.id] ?? 0) + 1;
    if (!area.scope || BINARY.test(path)) continue;
    let text;
    try {
      text = extra[path] ?? readFileSync(path, "utf8");
    } catch {
      continue; // a tracked file deleted in the working tree
    }
    if (BOARD_FILES.test(path) && onWorkforceGround(path, text)) boardOnWorkforce.push(path);
    const hits = scanFile(path, text, exemptCounts, totals);
    if (hits.length > 0) unsweptByFile.set(path, hits);
    for (const h of hits) {
      const byArea = totals[h.term].byArea;
      byArea[area.id] = (byArea[area.id] ?? 0) + 1;
    }
  }
  const stale = EXCEPTIONS.filter((e) => !exemptCounts[e.id]).map((e) => e.id);
  return { files: files.length, unscoped, areaCounts, exemptCounts, totals, unsweptByFile, boardOnWorkforce, stale };
}

function print(r) {
  console.log(`tracked files: ${r.files}`);
  console.log(
    "areas: " +
      AREAS.map((a) => `${a.id}${a.scope ? "" : " (kept)"} ${r.areaCounts[a.id] ?? 0}`).join(" · ")
  );
  console.log("");
  console.log("term".padEnd(15) + "lines".padStart(7) + "files".padStart(7) + "unswept".padStart(9) + "files".padStart(7) + "   unswept lines by area");
  let unsweptTotal = 0;
  for (const term of TERMS) {
    const t = r.totals[term.id];
    if (!t) {
      console.log(term.id.padEnd(15) + "0".padStart(7) + "0".padStart(7) + "0".padStart(9) + "0".padStart(7));
      continue;
    }
    unsweptTotal += t.unsweptLines;
    const areas = Object.entries(t.byArea)
      .sort((a, b) => b[1] - a[1])
      .map(([a, n]) => `${a} ${n}`)
      .join(", ");
    console.log(
      term.id.padEnd(15) +
        String(t.lines).padStart(7) +
        String(t.files.size).padStart(7) +
        String(t.unsweptLines).padStart(9) +
        String(t.unsweptFiles.size).padStart(7) +
        "   " +
        areas
    );
  }
  console.log("");
  for (const e of EXCEPTIONS) {
    const n = r.exemptCounts[e.id] ?? 0;
    console.log(`exception ${e.id}: ${n} stripped${n === 0 ? " (STALE: strips nothing)" : ""}`);
  }
  console.log("");
  if (r.unscoped.length > 0) console.log(`UNSCOPED (no area): ${r.unscoped.join(", ")}`);
  if (r.stale.length > 0) console.log(`STALE EXCEPTIONS (remove them): ${r.stale.join(", ")}`);
  if (r.boardOnWorkforce.length > 0) console.log(`BOARD FILE ON WORKFORCE GROUND: ${r.boardOnWorkforce.join(", ")}`);
  const files = r.unsweptByFile.size;
  if (unsweptTotal > 0) console.log(`FAIL · ${unsweptTotal} unswept lines in ${files} files`);
  const ok = r.unscoped.length === 0 && unsweptTotal === 0 && r.stale.length === 0 && r.boardOnWorkforce.length === 0;
  if (ok) console.log("PASS · every in-scope match is swept or excepted, every exception strips something, and every file has an area");
  return ok;
}

const PLANTS = {
  // Each line hides a retired word behind an exception that covers a neighbour.
  "packages/workforce/src/zz-planted.ts": [
    "// The researcher runs on the agent kind of flow; its flowKind is unchanged.", // kind: 'agent kind' must count; flowKind and 'kind of' are not English here
    'export const refusal = "MAILBOX.md is refused: rename it to WORKER.md and post to the mailbox";', // mailbox: the file name strips, 'the mailbox' must count
    'const key = "inventory/seats/x"; // each seat is listed', // seat: the stored name strips, 'each seat' must count
    'const note = "inventory/seats/x belongs to this mailbox";', // mailbox: two terms in one quote; only the key strips
    "export const roomLineSchema = z.object({});", // room: a lower-camel identifier
    "// wakeMemberWorkers remembers the thread", // member and thread: mailbox leftovers once 'mailbox' is gone
  ].join("\n"),
  // Outside Workforce's folders, on its surface by import: a board's seat beside a Workforce one.
  "apps/kitchen-sink/components/zz-planted-pane.tsx": [
    'import { openRoster } from "@flow-state-dev/workforce";',
    "const slot: TaskSeat = pick(row); // the seat this pane opens", // seat: TaskSeat strips, 'the seat' must count
    "// the pane shows the worker's kind", // kind: on Workforce's ground by its import
  ].join("\n"),
  // Inside the board's own files, its bare word strips; a hired seat still counts.
  "packages/orchestration/src/task-board/zz-planted.ts": "// a dispatcher seat hands this row to a hired seat\n",
  "zz-planted-folder/notes.md": "Nothing retired here.\n", // totality: no area
};

if (process.argv.includes("--control")) {
  const r = census(PLANTS);
  const want = [
    { file: "packages/workforce/src/zz-planted.ts", line: 1, term: "kind" },
    { file: "packages/workforce/src/zz-planted.ts", line: 2, term: "mailbox" },
    { file: "packages/workforce/src/zz-planted.ts", line: 3, term: "seat" },
    { file: "packages/workforce/src/zz-planted.ts", line: 4, term: "mailbox" },
    { file: "packages/workforce/src/zz-planted.ts", line: 5, term: "room" },
    { file: "packages/workforce/src/zz-planted.ts", line: 6, term: "member" },
    { file: "packages/workforce/src/zz-planted.ts", line: 6, term: "thread" },
    { file: "apps/kitchen-sink/components/zz-planted-pane.tsx", line: 2, term: "seat" },
    { file: "apps/kitchen-sink/components/zz-planted-pane.tsx", line: 3, term: "kind" },
    { file: "packages/orchestration/src/task-board/zz-planted.ts", line: 1, term: "seat" },
  ];
  const caught = want.map((w) => (r.unsweptByFile.get(w.file) ?? []).some((h) => h.line === w.line && h.term === w.term));
  const folder = r.unscoped.includes("zz-planted-folder/notes.md");
  for (const [i, w] of want.entries()) console.log(`plant ${w.file}:${w.line} (${w.term}): ${caught[i] ? "refused" : "SLIPPED THROUGH"}`);
  console.log(`plant folder (totality): ${folder ? "refused" : "SLIPPED THROUGH"}`);
  const ok = caught.every(Boolean) && folder;
  console.log(ok ? "CONTROL PASS · every plant was refused" : "CONTROL FAIL");
  process.exitCode = ok ? 0 : 1;
} else if (process.argv.includes("--list")) {
  const which = process.argv[process.argv.indexOf("--list") + 1];
  const r = census();
  for (const [path, hits] of [...r.unsweptByFile.entries()].sort()) {
    for (const h of hits) if (!which || h.term === which) console.log(`${path}:${h.line}  [${h.term}]  ${h.text}`);
  }
} else {
  process.exitCode = print(census()) ? 0 : 1;
}
