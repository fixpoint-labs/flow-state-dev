#!/usr/bin/env node
/**
 * Guard: Workforce's retired words stay retired.
 *
 * One idea, one name. A worker is a worker, never a seat; a task board's entry
 * is an assignee; the flow a worker runs on is its worker flow; a user is a
 * user. This guard reads every line of every tracked file and fails on a
 * retired word (seat, hired seat, hired roster, mailbox and its members and
 * threads, room, talk session, and, on Workforce's ground, kind, owner pin,
 * flow instance and person) anywhere it isn't kept on purpose.
 *
 * ## Totality, twice
 *
 * Every tracked file lands in exactly one area, in scope or kept (history,
 * process, `goals/`, root configuration), or the run fails naming it: a new
 * folder nobody classified is the hole a remembered list can't see. Then every
 * match of a retired term on an in-scope line is either stripped by a named
 * exception or counted, and any counted match fails the run.
 *
 * ## Exceptions strip a token, never a line
 *
 * So a second retired word on an excepted line still counts. Each exception
 * names the terms it may strip and the rule behind it. An exception that strips
 * nothing fails the run: an exception nobody needs is a hole waiting for a
 * live use. "Seat" has no exception at all, a task board's included. Never
 * widen an exception to go green: rename the line.
 *
 * ## Ground is a surface, not a folder
 *
 * "Kind", "owner pin", "flow instance", "member", "thread" and "person" have
 * live meanings elsewhere (the engine's flow kind, a project's members, a chat
 * thread), so they are scanned on Workforce's ground only: Workforce's and
 * Shift Manager's packages and pages, any path that names Workforce (the
 * kitchen-sink app's `workforce/` tree, the React panels, the architecture
 * notes), the glossary's Workforce and Shift Manager sections, and any file
 * that imports Workforce or Shift Manager, wherever it sits.
 *
 * ## The glossary
 *
 * Each shipped vocabulary term is defined by exactly one glossary row. Shift
 * Manager's rows name its screens (its Roster screen beside Workforce's
 * roster), so they don't count toward a term.
 *
 * ## Collection item
 *
 * Stored collection data is an item, not a row
 * (`goals/vocabulary/one-word-per-thing` → `COLLECTION_ITEM`). The sweep does
 * not apply it: the existing tree keeps its names. This guard flags a line the
 * checkout adds against the base ref, and only that line. A `type` or
 * `interface` whose name ends in `Row` counts when it names collection data:
 * the file is a collection module, the line says collection, or the name
 * contains `Collection`. Docs prose that calls collection data a row counts.
 * A rendered table row does not: panels, the flow navigator, BoardColumns, a
 * table or grid path, a `TableRow`-style name, a DOM `<tr>`, or the words
 * "table row" / "grid row". Core's `OutputItem` and `getItems` are response
 * items and do not match. Record and entry do not match. History, process,
 * goals and root config stay out of scope, same as the other terms.
 *
 * Run: node scripts/check-retired-terms.mjs [--root <dir>] [--list [term]] [--control]
 *   --root     scan another checkout (default: this repository)
 *   --list     print every counted line, or only one term's
 *   --control  plant lines that must be refused into the tree (in memory) and
 *              require each refused; exits 1 if any slips through
 * Exits 1 on any counted line, unclassified file, stale exception or glossary
 * row out of place.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { COLLECTION_ITEM } from "../goals/vocabulary/one-word-per-thing/rules.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

/** This guard's own test plants retired words on purpose, so it is process tooling. */
const GUARD_TEST = "packages/core/test/retired-terms-check.test.ts";

/** First match wins. `scope: true` is swept; `false` keeps its words by design. */
export const AREAS = [
  { id: "history", scope: false, re: /^specs\/|^spec\/|^spec-poc|^docs\/internal\/|(^|\/)CHANGELOG\.md$|^\.changeset\/|^apps\/docs\/blog\/|^docs\/atlas\/|^docs\/superpowers\/|^pnpm-lock\.yaml$/, why: "dated records: no rewriting history" },
  { id: "process", scope: false, re: new RegExp(`^\\.agents\\/|^\\.husky\\/|^\\.omp\\/|^\\.github\\/|^\\.claude\\/|^\\.cursor\\/|^plugins\\/|^scripts\\/|^docs\\/contributing\\/|^docs\\/(philosophy|objectives|PROMPT_CACHING)\\.md$|^docs\\/assets\\/|^(CLAUDE|AGENTS|CONTRIBUTING|CODE_OF_CONDUCT|SECURITY|compound-engineering\\.local)\\.md$|^${GUARD_TEST.replace(/[./]/g, "\\$&")}$`), why: "process tooling and contributor instructions" },
  { id: "goals", scope: false, re: /^goals\//, why: "tests of behaviour: renamed identifiers reach them through typecheck, their words stay" },
  { id: "config", scope: false, re: /^[^/]+\.(json|ya?ml)$|^eslint\.config\.mjs$|^LICENSE$|^\.gitignore$|^\.ignore$/, why: "root configuration" },
  { id: "package-src", scope: true, re: /^packages\/[^/]+\/src\// },
  { id: "package-tests", scope: true, re: /^packages\/[^/]+\/(test|tests|e2e)\// },
  { id: "package-other", scope: true, re: /^packages\// },
  { id: "docs-site", scope: true, re: /^apps\/docs\// },
  { id: "apps", scope: true, re: /^apps\// },
  { id: "labs", scope: true, re: /^labs\// },
  { id: "examples", scope: true, re: /^examples\// },
  { id: "reference-docs", scope: true, re: /^docs\/architecture\/|^docs\/mechanisms\/|^README\.md$/ },
];

/** The area a path falls in, or undefined when none names it. */
export const areaOf = (path) => AREAS.find((a) => a.re.test(path));

/**
 * Workforce's paths. The bare `workforce` alternation is meant: a path that
 * names Workforce (kitchen-sink's `workforce/` tree, `lib/workforce-shell.ts`,
 * the architecture notes) is its surface wherever it sits.
 */
const WORKFORCE_PATHS = /^packages\/(workforce|shift-manager)\/|^apps\/docs\/docs\/(workforce|shift-manager)\/|^apps\/docs\/docs\/glossary\/(workforce|shift-manager)\.svg$|workforce/i;
const WORKFORCE_IMPORT = /["']@flow-state-dev\/(?:workforce|shift-manager)(?:\/[^"']*)?["']/;
const GLOSSARY = "apps/docs/docs/glossary.md";
/** The glossary is Workforce's ground from its Workforce section on. */
const GLOSSARY_WORKFORCE_HEADING = /^## Workforce\b/;

/**
 * Which lines of a file are on Workforce's ground.
 * @returns {(index: number) => boolean}
 */
export function workforceGround(path, text) {
  if (path === GLOSSARY) {
    const start = text.split("\n").findIndex((line) => GLOSSARY_WORKFORCE_HEADING.test(line));
    return (index) => start >= 0 && index >= start;
  }
  const on = WORKFORCE_PATHS.test(path) || WORKFORCE_IMPORT.test(text);
  return () => on;
}

/**
 * The retired terms and what each says instead. `ground: "workforce"` scans
 * Workforce's ground only. "Seat" matches at the start of a word part, so
 * `leaseAtClaim` and `closeAt` are not seats.
 */
export const TERMS = [
  { id: "seat", re: /(?<![a-z])[Ss]eat|(?<=[a-z0-9])Seat|SEAT/g, say: "worker; on a task board, assignee" },
  { id: "hired-roster", re: /hired[ _-]?roster/gi, say: "roster" },
  { id: "mailbox", re: /mailbox/gi, say: "coordinator; a member is a delegate" },
  { id: "member", re: /\b[Mm]embers?\b|\bMEMBERS?\b|[Mm]ember(?=[A-Z_])|(?<=[a-z])Members?\b/g, ground: "workforce", say: "delegate, where it means a mailbox member" },
  { id: "thread", re: /\bthreads?\b/gi, ground: "workforce", say: "the delegate's session, where it means a mailbox thread" },
  { id: "room", re: /\b[Rr]ooms?\b|room-(?:lines|seq|answers|deliveries)|Room[A-Z]\w*|\broom[A-Z]\w*|\bROOM_\w*/g, say: "the project coordinator" },
  { id: "talk-session", re: /talk[ _-]?sessions?|talk-?template|talkFor\b|\bTALK_\w+/gi, say: "the project coordinator" },
  { id: "person", re: /\bpersons?\b|\bperson's\b/gi, ground: "workforce", say: "user, where it means the signed-in user" },
  { id: "kind", re: /kind/gi, ground: "workforce", say: "worker flow, where it means the flow a worker runs on" },
  { id: "owner-pin", re: /owner[ _-]?pins?/gi, ground: "workforce", say: "access to the worker" },
  { id: "flow-instance", re: /flow[ _-]?instances?/gi, ground: "workforce", say: "worker, where it means a worker" },
];

/**
 * A person who isn't the signed-in user stays (BR-5), pinned by file and
 * phrase. Another "person" on the same line, or the phrase in another file,
 * still counts.
 */
export const PERSON_PINS = [
  // A support desk's example worker: a human on the support team, not the customer writing in.
  { path: "apps/docs/docs/workforce/coordinators.md", phrase: /\bhow to reach a person\b/g },
  // A triage worker's example: it escalates to a human, not back to the user who asked.
  { path: "apps/docs/docs/workforce/overview.md", phrase: /\bor to a person\b/g },
  { path: "apps/docs/docs/workforce/workers-on-disk.md", phrase: /\bhands off to a person\b/g },
];

/**
 * The projects surface, where "member" is a project's: Workforce's projects
 * modules, their tests, and the Projects page and its figure.
 */
const PROJECT_MODULES = /^packages\/workforce\/src\/projects\/|^packages\/workforce\/test\/(?:projects?|workstreams?)[\w-]*\.test\.ts$|^apps\/docs\/docs\/workforce\/(?:projects\.md|project-overview\.svg)$/;

/**
 * The tokens each exception strips. Only `terms` may be stripped by it. `where`
 * narrows an exception to the files it covers.
 */
export const EXCEPTIONS = [
  {
    id: "field-named-kind",
    terms: ["kind"],
    strip: /\bflowKinds?\b|\bkind\s*\??:\s*Kind\b|(?<=[!=]==\s*)kind\b|\bkinds?\s*\??:|\.kinds?\b|\bkind\s*[!=]==?|["'`]kinds?["'`]|\bdata-kind\b|\bkind=\{|\bkind="|(?<=[{(,]\s*)kind(?=\s*[,})=])|\$\{kind\}|\bconst kind\b|\bof kinds\b|\blastKind\b|\bflowsByKind\b|<kind>/g,
    why: "a field named kind: the engine's flow kind or a type discriminant (BR-10)",
  },
  {
    id: "kind-type-names",
    terms: ["kind"],
    strip: /\b\w+ErrorKind\b|\bEntryKind\b|\bTaskChangeKind\b|\bPathReport<Kind\b|\bKind extends\b|:\s*Kind\b|\b(?:WRITER|PLAIN)_KIND\b|\bworkerWriterKind\b|\b(?:suspendForUserKindOf|SuspendForUserKind)\b|`Kind`/g,
    why: "a type discriminant's own type, core's names for what a user's stop asks (FIX-2129), and the engine flow kinds a test registers (BR-10)",
  },
  {
    id: "engine-flow-kind",
    terms: ["kind"],
    strip: /\b(?:a |the |that |this |each |every |another |its |their |your )?flow(?:'s)? (?:own )?kinds?\b|\b(?:its|their) own kind\b|\bits kind is\b|\bis its kind\b|\b(?:under|at) (?:the flow's|its|their) (?:own )?kind\b|\bkind names?\b|\*\*Kind\.\*\*/gi,
    why: "the engine's flow kind: a flow's name to the engine (BR-10)",
  },
  {
    id: "english-kind",
    terms: ["kind"],
    strip: /\b(?:a|an|any|one|the same|this|that|what|which|some|every|each|another|other|same|no|either|second|different)\s+kinds?\s+of\b|\bkinds\s+of\b|\bof (?:any|that|this|each|either|one|the same) kind\b|\b(?:the same|same) kind\b|\bkindly\b|\bkinder\b|\bBe kind\b/gi,
    why: "the English word",
  },
  {
    id: "other-kinds",
    terms: ["kind"],
    strip: /\b(?:block|item|content|event|channel|part|tool|error|message|node|trace|step|manifest|change|ask|path|entry)[ -]kinds?\b/gi,
    why: "another subsystem's kind",
  },
  {
    id: "core-flow-instance-type",
    terms: ["flow-instance"],
    strip: /\b(?:Any)?FlowInstance\w*|\bisFlowInstance\b|\bcreateFlowInstance\b/g,
    why: "core's type for any registered flow; the engine keeps the term (BR-10)",
  },
  {
    id: "english-room",
    terms: ["room"],
    strip: /\b(?:make|makes|making|made|leave|leaves|leaving|left|have|has|had|ran out of|run out of|out of|given|give|gives|enough|reserve|reserves|reserved|no|more|less|little|plenty of)\s+room\b|\broom\s+(?:for|to)\b|room-temperature/gi,
    why: "the English 'room for'",
  },
  {
    id: "landing-room-metaphor",
    terms: ["room"],
    where: (path) => path === "apps/build-site/public/index.html",
    strip: /\binside their room\b|\brebuild the room\b/g,
    why: "flow-state.build's headline metaphor (an assistant's room you can rebuild), not the retired coordinator term",
  },
  {
    id: "project-member",
    terms: ["member"],
    strip: /\b(?:project|org|organization|team)(?:'s)?\s+members?\b|\b(?:project|org)Members?\b|\bmembers\??\s*:|\bmembers\?(?=,)|\bone of its members\b|\.members\b|["'`]members["'`]|\bisMember\b|\bnot-a-member\b|\bprivate-has-members\b|\bnon-members?\b|\b(?:is|are|aren't|isn't|they're|not) a member of\b|\ba member of any team\b|\bmembers? of (?:both|the default) projects\b|\bmembers?\s+of\s+(?:the |a |an |that |this |its |their |your |every )?(?:shared |private )?(?:project|org|organization|team)s?\b|\b[Mm]embers only\b|\bLAB_USERS\.member\b|\bas: "member"|\bmember(?=: \{ userId)|\bu_devforce_member\b|\bdevforce-lab-verified-member\b/g,
    why: "a project's or an org's member is a user (the project's `members`), not a mailbox's",
  },
  {
    id: "project-modules-member",
    terms: ["member"],
    where: (path) => PROJECT_MODULES.test(path),
    strip: /\b[Mm]embers?\b/g,
    why: "in the projects modules and page, a member is the project's: a user its `members` lists",
  },
  {
    id: "type-member",
    terms: ["member"],
    strip: /\b(?:inherited|prototype|required|union) member\b|\bany member of a union\b|\bObject\.prototype member\b/g,
    why: "a member of a type or an object, in TypeScript's sense",
  },
  {
    id: "chat-thread",
    terms: ["thread"],
    strip: /\bchat[ -]threads?\b|\bthread:\s*\{/gi,
    why: "a chat thread in the UI, and a coding harness's own `thread:` option, not a mailbox's",
  },
  {
    id: "claude-code-threads",
    terms: ["thread"],
    where: (path) => path.startsWith("labs/claude-code-style/"),
    strip: /\bthreads?\b/gi,
    why: "Claude Code's threads mode, which the Claude Code-style lab copies by name: a thread is a task in a session of its own, not a mailbox's",
  },
  {
    id: "subscription-modules",
    terms: ["thread", "member", "kind"],
    where: (path) => /^packages\/workforce\/(?:src\/subscriptions\/|test\/subscriptions-)/.test(path),
    strip: /\bthreads?\b|\bThreads?(?=[A-Z_]|\b)|(?<=[a-z])Threads?\b|\bmembers?\b|\bkinds?\b|(?<=\b|_)KINDS\b|(?<=[a-z])Kinds?\b/g,
    why: "an outside service's thread (a PR, an issue, a repository), a sender's `member` role there, and an event's kind: FIX-2471's signed subscription vocabulary, not a mailbox's thread or member, nor a worker flow",
  },
  {
    id: "subscription-docs",
    terms: ["thread", "member", "kind"],
    where: (path) => path === "packages/workforce/README.md" || path === "apps/docs/docs/workforce/messaging-workers.md",
    // Only on a line that names the outside service, so a mailbox's thread elsewhere on the page still counts.
    strip: /\bSCREEN_KINDS\b|(?:\bthreads?\b|\b[Mm]embers?\b|\bkinds?\b)(?=[^\n]*(?:subscri|provider|event|\bPR\b|pull request|repositor|outside|`thread`|canRead|github))|(?<=(?:subscri|provider|event|\bPR\b|pull request|repositor|outside|canRead|github)[^\n]*)(?:\bthreads?\b|\b[Mm]embers?\b|\bkinds?\b)/g,
    why: "the subscription pages' outside thread, a sender's member role and an event's kind (FIX-2471), on lines that name the outside service",
  },
  {
    id: "old-page-redirect",
    terms: ["mailbox"],
    where: (path) => path === "apps/docs/docusaurus.config.ts",
    strip: /(?<=from: ")\/docs\/workforce\/mailboxes(?=")/g,
    why: "a redirect from a removed page's address, so an old link still lands",
  },
  {
    id: "person-any-human",
    terms: ["person"],
    where: (path) => PERSON_PINS.some((pin) => pin.path === path),
    strip: (path, line) => PERSON_PINS.filter((pin) => pin.path === path).reduce((out, pin) => out.replace(pin.phrase, " "), line),
    why: "a person who isn't the signed-in user stays, pinned by file and phrase (BR-5)",
  },
];

const TERM_IDS = new Set(TERMS.map((t) => t.id));
for (const e of EXCEPTIONS) for (const t of e.terms) if (!TERM_IDS.has(t)) throw new Error(`exception ${e.id} names unknown term ${t}`);

const BINARY = /\.(png|jpe?g|gif|ico|webp|woff2?|ttf|otf|pdf|zip|gz|mp4|webm|wasm)$/i;

const count = (re, s) => {
  re.lastIndex = 0;
  return (s.match(re) ?? []).length;
};

const applyStrip = (e, path, line) => {
  if (typeof e.strip === "function") return e.strip(path, line);
  e.strip.lastIndex = 0;
  return line.replace(e.strip, " ");
};

/**
 * Scan one in-scope file.
 * @param {string} path
 * @param {string} text
 * @param {object[]} exceptions
 * @param {Record<string, number>} [stripped] counts per exception id, added to
 * @returns {{ term: string; line: number; text: string }[]} the counted lines
 */
export function scanFile(path, text, exceptions, stripped = {}) {
  const hits = [];
  const onGround = workforceGround(path, text);
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    for (const term of TERMS) {
      if (term.ground === "workforce" && !onGround(i)) continue;
      if (count(term.re, raw) === 0) continue;
      let line = raw;
      for (const e of exceptions) {
        if (!e.terms.includes(term.id)) continue;
        if (e.where && !e.where(path, text)) continue;
        const next = applyStrip(e, path, line);
        if (next === line) continue;
        const removed = count(term.re, line) - count(term.re, next);
        if (removed > 0) stripped[e.id] = (stripped[e.id] ?? 0) + removed;
        line = next;
      }
      if (count(term.re, line) > 0) hits.push({ term: term.id, line: i + 1, text: raw.trim().slice(0, 160) });
    }
  }
  return hits;
}

/**
 * A collection module: a `collection` directory, or a file whose name says collection.
 * `tasks/collection/types.ts` and `collections.md` both count. `overview.md` does not.
 */
const COLLECTION_FILE = /(?:^|\/)collections?(?:\/|$)|(?:^|\/)[^/]*collection[^/]*\.(?:[cm]?[jt]sx?|mdx?)$/i;

/**
 * Where a row is a rendered table, not stored collection data. Panels and the
 * flow navigator draw board and session rows; BoardColumns is one of those
 * components; a `table` or `grid` path is the same thing.
 */
const UI_ROW_PATH = /(?:^|\/)components\/(?:panels|flow-navigator)\/|BoardColumns|(?:^|\/)(?:table|grid)s?(?:\/|$)|\.(?:table|grid)\.[cm]?[jt]sx?$/i;

/** Type names that are table rows. `WidgetRow` does not match. `DataTableRow` does. */
const UI_ROW_NAME = /(?:Table|Grid|BoardCard|BoardColumn|RosterWorker|FlowNavigator|Panel)Row$/;

/** A declaration of a type whose name ends in Row. Uses of an existing name do not match. */
const TYPE_ROW = /\b(?:export\s+)?(?:declare\s+)?(?:type|interface)\s+(\w*Row)\b/g;

/**
 * Docs calling stored collection data a row: "collection row", "collection's row",
 * "collections' rows", or "the row of the collection".
 */
const PROSE_ROW = /\bcollection\s+rows?\b|\bcollection(?:'s|s')\s+rows?\b|\brows?\s+(?:in|of|from|inside|on)\s+(?:the\s+|a\s+|an\s+)?(?:[\w'-]+\s+){0,4}collection\b/i;

/** A line that is itself a rendered table row, so the collection-item rule leaves it. */
const UI_ROW_LINE = /<tr\b|<\/tr>|\b(?:table|grid)\s+rows?\b/i;

const DOC_FILE = /\.(?:md|mdx)$/;

/**
 * Whether a `*Row` declaration is stored collection data.
 * @param {string} path
 * @param {string} line
 * @param {string} name
 */
function inCollectionContext(path, line, name) {
  if (COLLECTION_FILE.test(path)) return true;
  if (/\bcollections?\b/i.test(line)) return true;
  if (name.includes("Collection")) return true;
  return false;
}

/**
 * Collection-item violations on lines a change adds. `added` is the 1-based
 * line numbers added in `path`. A line the change did not add is ignored, and
 * so is a file outside this guard's in-scope areas.
 * @param {string} path
 * @param {string} text
 * @param {Set<number>} added
 * @returns {{ term: string; line: number; text: string }[]}
 */
export function scanCollectionRows(path, text, added) {
  const area = areaOf(path);
  if (area === undefined || !area.scope) return [];
  if (added === undefined || added.size === 0) return [];
  const lines = text.split("\n");
  const hits = [];
  const isDoc = DOC_FILE.test(path);
  const uiPath = UI_ROW_PATH.test(path);
  for (const n of [...added].sort((a, b) => a - b)) {
    const raw = lines[n - 1];
    if (raw === undefined) continue;
    if (UI_ROW_LINE.test(raw)) continue;
    if (isDoc && PROSE_ROW.test(raw)) {
      hits.push({ term: COLLECTION_ITEM.id, line: n, text: raw.trim().slice(0, 160) });
      continue;
    }
    if (uiPath) continue;
    TYPE_ROW.lastIndex = 0;
    let match;
    while ((match = TYPE_ROW.exec(raw)) !== null) {
      const name = match[1];
      if (UI_ROW_NAME.test(name)) continue;
      if (!inCollectionContext(path, raw, name)) continue;
      hits.push({ term: COLLECTION_ITEM.id, line: n, text: raw.trim().slice(0, 160) });
      break;
    }
  }
  return hits;
}

/**
 * Added-line numbers from one unified diff (`git diff -U0`). Keys are repo-relative
 * paths. Context and deletions are not added lines. A `+++` header is read only
 * outside a hunk, so an added line whose text starts with `++` still counts.
 * @param {string} diff
 * @returns {Map<string, Set<number>>}
 */
export function parseUnifiedAddedLines(diff) {
  /** @type {Map<string, Set<number>>} */
  const map = new Map();
  let path = null;
  let newLine = 0;
  let inHunk = false;
  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ")) {
      path = null;
      inHunk = false;
      continue;
    }
    if (!inHunk && line.startsWith("+++ ")) {
      const raw = line.slice(4);
      if (raw === "/dev/null") path = null;
      else if (raw.startsWith("b/")) path = raw.slice(2);
      else path = raw;
      continue;
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk) {
      newLine = Number(hunk[1]);
      inHunk = path !== null;
      continue;
    }
    if (!inHunk || path === null || line === "") continue;
    if (line.startsWith("\\")) continue;
    if (line.startsWith("+")) {
      let set = map.get(path);
      if (set === undefined) map.set(path, (set = new Set()));
      set.add(newLine);
      newLine++;
      continue;
    }
    if (line.startsWith("-")) continue;
    newLine++;
  }
  return map;
}

/**
 * The ref added lines are measured against. CI's pull_request event sets
 * `GITHUB_BASE_REF`. A local checkout uses `origin/main` when it exists.
 * @param {string} root
 */
export function baseRef(root) {
  const fromEnv = process.env.GITHUB_BASE_REF;
  if (fromEnv !== undefined && fromEnv !== "") return `origin/${fromEnv}`;
  try {
    execFileSync("git", ["rev-parse", "--verify", "--quiet", "origin/main"], { cwd: root, stdio: "ignore" });
    return "origin/main";
  } catch {
    return "main";
  }
}

/**
 * Run git in `root` and return stdout.
 * @param {string} root
 * @param {string[]} args
 */
function git(root, args) {
  return execFileSync("git", ["-c", "color.ui=false", ...args], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/**
 * Lines this working tree adds relative to {@link baseRef}, plus every line of
 * an untracked file. One diff against the base, so the line numbers match the
 * files on disk (committed changes and uncommitted edits together).
 * @param {string} root
 * @returns {Map<string, Set<number>>}
 */
export function addedLines(root) {
  const base = baseRef(root);
  let diff;
  try {
    diff = git(root, ["diff", "-U0", "--no-color", base]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Could not diff against ${base} to find added lines. In CI this means the checkout is shallow. Locally, fetch the base branch first. ${message}`,
    );
  }
  const map = parseUnifiedAddedLines(diff);
  const untracked = git(root, ["ls-files", "--others", "--exclude-standard", "-z"]);
  for (const path of untracked.split("\0").filter(Boolean)) {
    if (BINARY.test(path)) continue;
    let text;
    try {
      text = readFileSync(join(root, path), "utf8");
    } catch {
      continue;
    }
    if (text.includes("\0")) continue;
    let set = map.get(path);
    if (set === undefined) map.set(path, (set = new Set()));
    const count = text.split("\n").length;
    for (let i = 1; i <= count; i++) set.add(i);
  }
  return map;
}

/**
 * Added lines, in scope, that name stored collection data as a row.
 * @param {string} [root]
 * @returns {{ path: string; term: string; line: number; text: string }[]}
 */
export function findAddedCollectionRows(root = ROOT) {
  const hits = [];
  for (const [path, lines] of addedLines(root)) {
    let text;
    try {
      text = readFileSync(join(root, path), "utf8");
    } catch {
      continue;
    }
    if (text.includes("\0")) continue;
    for (const hit of scanCollectionRows(path, text, lines)) hits.push({ path, ...hit });
  }
  return hits;
}

/** The vocabulary that has shipped: each is defined by exactly one glossary row. */
export const GLOSSARY_TERMS = [
  "User",
  "Assignee",
  "Hand-off",
  "Worker",
  "Worker flow",
  "Standard worker",
  "Fork",
  "Roster",
  "Coordinator",
  "Delegate",
  "Delegation",
  "Door",
  "Project",
  "Workstream",
  "Project coordinator",
  "Shift Coordinator",
];

/**
 * Count the glossary's rows per term, Shift Manager's screens left out.
 * @returns {{ missing: string[]; repeated: string[] }}
 */
export function checkGlossary(text) {
  const rows = new Map();
  for (const line of text.split("\n")) {
    const m = /^\|\s*\*\*(.+?)\*\*\s*\|\s*([^|]*?)\s*\|/.exec(line);
    if (m === null || m[2] === "Shift Manager") continue;
    rows.set(m[1], (rows.get(m[1]) ?? 0) + 1);
  }
  return {
    missing: GLOSSARY_TERMS.filter((t) => !rows.has(t)),
    repeated: [...rows].filter(([, n]) => n > 1).map(([t]) => t),
  };
}

/**
 * The census over a tree. Pure over its inputs, so a test hands it a fixture.
 * @param {{ files: Map<string, string>; paths: string[] }} tree every path, and
 *   the text of each one that reads as text
 * @param {{ extraExceptions?: object[] }} [options]
 */
export function census({ files, paths }, { extraExceptions = [] } = {}) {
  const exceptions = [...EXCEPTIONS, ...extraExceptions];
  const unscoped = [];
  const areaCounts = {};
  const stripped = {};
  const hits = [];
  for (const path of paths) {
    const area = areaOf(path);
    if (area === undefined) {
      unscoped.push(path);
      continue;
    }
    areaCounts[area.id] = (areaCounts[area.id] ?? 0) + 1;
    if (!area.scope) continue;
    // A file left under its old name can be silent in its text, so the path counts too.
    for (const hit of scanFile(path, path, exceptions, stripped)) hits.push({ path, area: area.id, ...hit, line: 0 });
    if (BINARY.test(path)) continue;
    const text = files.get(path);
    if (text === undefined) continue;
    for (const hit of scanFile(path, text, exceptions, stripped)) hits.push({ path, area: area.id, ...hit });
  }
  const stale = exceptions.filter((e) => !stripped[e.id]).map((e) => e.id);
  const glossaryText = files.get(GLOSSARY);
  const glossary = glossaryText === undefined ? { missing: [...GLOSSARY_TERMS], repeated: [] } : checkGlossary(glossaryText);
  const ok = unscoped.length === 0 && hits.length === 0 && stale.length === 0 && glossary.missing.length === 0 && glossary.repeated.length === 0;
  return { files: paths.length, unscoped, areaCounts, stripped, hits, stale, glossary, ok };
}

/** Every tracked path under `root`, and the text of each one that is text. */
export function readTrackedTree(root = ROOT) {
  const paths = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
    .split("\0")
    .filter(Boolean);
  const files = new Map();
  for (const path of paths) {
    if (BINARY.test(path)) continue;
    let text;
    try {
      text = readFileSync(join(root, path), "utf8");
    } catch {
      continue; // a tracked file deleted in the working tree
    }
    if (!text.includes("\0")) files.set(path, text);
  }
  return { files, paths };
}

/**
 * Lines planted into a tree, each hiding a retired word beside a token an
 * exception strips, or in a goal's path (a goal's name has no exception).
 * Every one must be refused. A line goes on the end of the
 * file when the tree already has it.
 */
export const PLANTS = [
  { path: "packages/workforce/src/zz-planted.ts", line: "// The researcher runs on the agent kind of flow; its flowKind is unchanged.", term: "kind" },
  { path: "packages/workforce/src/zz-planted.ts", line: "// as goals/workforce-seats/a-seat-shows/ proves", term: "seat" },
  { path: "packages/workforce/src/zz-planted.ts", line: "const leaseAtClaim = 1; // each seat is listed", term: "seat" },
  { path: "apps/docs/docs/zz-planted.md", line: "Run `goals/mailbox-boards/it-drains/run.mts`.", term: "mailbox" },
  { path: "packages/workforce/src/zz-planted.ts", line: "export const roomLineSchema = z.object({});", term: "room" },
  { path: "packages/workforce/src/zz-planted.ts", line: "// wakeMemberWorkers remembers the thread", term: "member" },
  { path: "packages/workforce/src/zz-planted.ts", line: "// a project member wakes each member of the mailbox's thread", term: "thread" },
  { path: "packages/workforce/src/zz-planted.ts", line: 'export const domains = ["seats", "skills"];', term: "seat" },
  { path: "apps/kitchen-sink/components/zz-planted-pane.tsx", line: 'import { openRoster } from "@flow-state-dev/workforce";', term: null },
  { path: "apps/kitchen-sink/components/zz-planted-pane.tsx", line: "const slot: TaskAssignee = pick(row); // the seat this pane opens", term: "seat" },
  { path: "apps/kitchen-sink/components/zz-planted-pane.tsx", line: "// the pane shows the worker's kind beside its flow kind", term: "kind" },
  { path: "packages/orchestration/src/task-board/zz-planted.ts", line: "// a dispatcher seat hands this row to a hired seat", term: "seat" },
  { path: "apps/kitchen-sink/flows/zz-board/flow.ts", line: 'const board = taskBoard({ name: "triage", workers }); // each seat runs inline', term: "seat" },
  { path: "apps/kitchen-sink/flows/zz-board/flow.ts", line: "if (envelope.seat === name) return;", term: "seat" },
  { path: "apps/kitchen-sink/flows/zz-board/flow.ts", line: "// a hired seat answers elsewhere", term: "seat" },
  { path: PERSON_PINS[0].path, line: "If you can't help, say how to reach a person, and tell the person who signed in.", term: "person" },
  { path: GLOSSARY, line: "| **Worker** | workforce | A second definition. | Worker |", term: null },
  { path: "zz-planted-folder/notes.md", line: "Nothing retired here.", term: null },
  // Stored collection data named as a row. In memory, so the control does not need a dirty tree.
  { path: "packages/orchestration/src/tasks/collection/zz-planted.ts", line: "export type WidgetRow = { id: string };", term: COLLECTION_ITEM.id },
  { path: "apps/docs/docs/zz-collection-planted.md", line: "Each collection row is stored beside the worker.", term: COLLECTION_ITEM.id },
];

/** An exception that matches nothing, which the run must report stale. */
export const STALE_PLANT = { id: "zz-planted-stale", terms: ["seat"], strip: /zz-never-matches/g, why: "planted" };

/**
 * Plant {@link PLANTS} and {@link STALE_PLANT} into a tree and report, for
 * each, whether the census refused it.
 * @param {{ files: Map<string, string>; paths: string[] }} tree
 */
export function control(tree) {
  const files = new Map(tree.files);
  const paths = [...tree.paths];
  const lineOf = new Map();
  for (const plant of PLANTS) {
    const before = files.get(plant.path);
    if (before === undefined) paths.push(plant.path);
    const text = before === undefined ? plant.line : `${before.replace(/\n$/, "")}\n${plant.line}`;
    files.set(plant.path, `${text}\n`);
    lineOf.set(plant, text.split("\n").length);
  }
  const r = census({ files, paths }, { extraExceptions: [STALE_PLANT] });
  const results = PLANTS.filter((p) => p.term !== null).map((p) => {
    const line = lineOf.get(p);
    const refused = p.term === COLLECTION_ITEM.id
      ? scanCollectionRows(p.path, files.get(p.path) ?? "", new Set([line])).some((h) => h.line === line)
      : r.hits.some((h) => h.path === p.path && h.line === line && h.term === p.term);
    return { what: `${p.path}:${line} (${p.term})`, refused };
  });
  results.push({ what: "a second glossary row for Worker", refused: r.glossary.repeated.includes("Worker") });
  results.push({ what: "an exception that strips nothing", refused: r.stale.includes(STALE_PLANT.id) });
  results.push({ what: "a folder no area names", refused: r.unscoped.includes("zz-planted-folder/notes.md") });
  return { results, ok: results.every((x) => x.refused) };
}

/**
 * @param {ReturnType<typeof census>} r
 * @param {{ path: string; term: string; line: number; text: string }[]} rowHits
 */
function print(r, rowHits) {
  console.log(`tracked files: ${r.files}`);
  console.log("areas: " + AREAS.map((a) => `${a.id}${a.scope ? "" : " (kept)"} ${r.areaCounts[a.id] ?? 0}`).join(" · "));
  for (const e of EXCEPTIONS.map((x) => x.id)) console.log(`exception ${e}: ${r.stripped[e] ?? 0} stripped`);
  const byTerm = {};
  for (const h of r.hits) byTerm[h.term] = (byTerm[h.term] ?? 0) + 1;
  for (const t of TERMS) if (byTerm[t.id]) console.log(`  ${t.id}: ${byTerm[t.id]} counted (say ${t.say})`);
  if (rowHits.length > 0) {
    console.error(`  ${COLLECTION_ITEM.id}: ${rowHits.length} added line(s) name stored collection data as a row (say ${COLLECTION_ITEM.say}: ${COLLECTION_ITEM.anchor.join(", ")})`);
    for (const h of rowHits) console.error(`  ${h.path}:${h.line}  ${h.text}`);
  }
  if (r.unscoped.length > 0) console.error(`UNSCOPED (no area): ${r.unscoped.join(", ")}`);
  if (r.stale.length > 0) console.error(`STALE EXCEPTIONS (remove them): ${r.stale.join(", ")}`);
  if (r.glossary.missing.length > 0) console.error(`GLOSSARY: no row for ${r.glossary.missing.join(", ")}`);
  if (r.glossary.repeated.length > 0) console.error(`GLOSSARY: more than one row for ${r.glossary.repeated.join(", ")}`);
  const lines = new Set(r.hits.map((h) => `${h.path}:${h.line}`));
  const inFiles = new Set(r.hits.map((h) => h.path));
  if (r.hits.length > 0) console.error(`FAIL · ${lines.size} lines in ${inFiles.size} files use a retired term`);
  if (rowHits.length > 0) console.error(`FAIL · ${rowHits.length} added line(s) name stored collection data as a row`);
  if (r.ok && rowHits.length === 0) console.log("check-retired-terms: PASS · no retired term outside its exceptions, every exception strips something, every file has an area, one glossary row per term, no added line names collection data as a row");
}

function main() {
  const at = process.argv.indexOf("--root");
  const root = at >= 0 ? process.argv[at + 1] : ROOT;
  const tree = readTrackedTree(root);
  if (process.argv.includes("--control")) {
    const { results, ok } = control(tree);
    for (const x of results) console.log(`plant ${x.what}: ${x.refused ? "refused" : "SLIPPED THROUGH"}`);
    console.log(ok ? "CONTROL PASS · every plant was refused" : "CONTROL FAIL");
    process.exitCode = ok ? 0 : 1;
    return;
  }
  const r = census(tree);
  let rowHits = [];
  let rowError = null;
  try {
    rowHits = findAddedCollectionRows(root);
  } catch (error) {
    rowError = error instanceof Error ? error.message : String(error);
  }
  if (process.argv.includes("--list")) {
    const which = process.argv[process.argv.indexOf("--list") + 1];
    for (const h of r.hits) if (which === undefined || which.startsWith("--") || h.term === which) console.log(`${h.path}:${h.line}  [${h.term}]  ${h.text}`);
    for (const h of rowHits) if (which === undefined || which.startsWith("--") || h.term === which) console.log(`${h.path}:${h.line}  [${h.term}]  ${h.text}`);
  }
  print(r, rowHits);
  if (rowError !== null) {
    console.error(rowError);
    process.exitCode = 1;
    return;
  }
  process.exitCode = r.ok && rowHits.length === 0 ? 0 : 1;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) main();
