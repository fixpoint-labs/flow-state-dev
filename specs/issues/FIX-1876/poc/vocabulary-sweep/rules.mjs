/**
 * FIX-1876 vocabulary sweep — what is retired, where it is looked for, and what is kept.
 *
 * The implementer extends KEEP (never RETIRED) as it classifies the hits a rename leaves;
 * every KEEP entry carries its reason. A line that names a retired name on purpose (a legacy
 * reader, or FIX-1872's refusal of a worker file naming `handOff`) is not kept here: it carries
 * the `retired-name-refusal` marker on that line, so a reviewer sees it in the diff. It is the
 * marker FIX-1875's sweep uses, so the repository has one spelling for a deliberate old name.
 */

/** The roots the sweep owns. Every tracked file under one is scanned or excluded by name. */
export const ROOTS = ["packages", "apps", "docs/architecture", ".changeset", "goals"];

/** FIX-1875's marker, under FIX-1875's name, so the two sweeps share one spelling. */
export const REFUSAL_MARKER = "retired-name-refusal";

const CODE = /^(packages|apps)\/.*\.(ts|tsx|mts|cts|js|mjs|cjs|jsx)$/;
const PUBLISHED = /^(apps\/docs\/(docs|guides)\/.*\.(md|mdx|svg)|packages\/[^/]+\/README\.md|docs\/architecture\/.*\.md)$/;
const CODE_OR_PUBLISHED = new RegExp(`${CODE.source}|${PUBLISHED.source}`);
const PENDING_NOTES = /^(\.changeset\/.*\.md|goals\/.*\.(md|mts|ts))$/;

/** Each retired name or meaning (epic D3): an id, the files it is looked for in, the pattern. */
export const RETIRED = [
  {
    id: "ask-symbol",
    files: CODE,
    // Any identifier built on "ask" that isn't "task": parkOnAsk, AskEndedError, hasAskSweeper,
    // ASK_GATE_REASON, askGateId. Shift Manager's and the harness's person asks are KEEP.
    pattern: /\b(?!\w*[Tt]ask)(ask[A-Z]\w*|\w*Ask\w*|ASK_\w+|\w+_ASK\w*)\b/,
    pathName: /(^|\/)(ask-|[^/]*-ask[-.])[^/]*$/
  },
  {
    id: "ask-symbol-in-docs",
    files: PUBLISHED,
    // The same identifiers where a page or README names them in backticks.
    pattern: /`[^`]*\b(?!\w*[Tt]ask)(ask[A-Z]\w*|\w*Ask\w*|ASK_\w+)\b[^`]*`/
  },
  {
    id: "ask-mark",
    files: CODE_OR_PUBLISHED,
    // The persisted marks: a row's `ask` field, the run-once keys, the notice flag.
    pattern: /(\??\.ask\b(?!\w)|\bask\??:\s*(z\.|\{|undefined)|fsd\.ask\.|\basked:\s*true\b)/
  },
  {
    id: "handoff-symbol",
    files: CODE,
    // Any identifier built on "hand off": createHandOff, handedOffTaskPredicate, abortHandoff.
    pattern: /\b\w*(HandOff|Handoff|handOff|handoff|HandedOff|handedOff)\w*\b|["'`]handed-off["'`]/,
    pathName: /(^|\/)[^/]*hand-?off[^/]*$/
  },
  {
    id: "handoff-symbol-in-docs",
    files: PUBLISHED,
    pattern: /`[^`]*(\w*(HandOff|Handoff|handOff|handedOff)\w*|handed-off)[^`]*`/
  },
  {
    id: "handoff-prose",
    files: CODE_OR_PUBLISHED,
    // "hand-off" for delivering new work. Mid-work hand-off is the only meaning kept (KEEP).
    pattern: /\bhand(-| )?offs?\b|\bhanded[- ]off\b|\bhand(s|ing)? (it |them |the \w+ |a \w+ |work )?off\b/i
  },
  {
    id: "ask-prose",
    files: CODE_OR_PUBLISHED,
    // "ask" for delivering work. A question to a person is the only meaning kept (KEEP).
    pattern: /\b(an|every|each) ask\b|\basks? (gate|resume|binding|marker|option)s?\b|\basked (task|row|worker|turn|colleague)s?\b|\basker\b|\bthe ask\b(?! (card|inbox))/i
  },
  {
    id: "post-to-mailbox",
    files: new RegExp(`${CODE_OR_PUBLISHED.source}|${PENDING_NOTES.source}`),
    pattern: /post-to-mailbox|postToMailbox/
  }
];

/** Tracked files under ROOTS that are deliberately not swept, each with its reason. */
export const EXCLUDE = [
  { path: /(^|\/)CHANGELOG\.md$/, over: true, why: "release history: records what shipped under the old names" },
  { path: /^apps\/docs\/blog\//, over: true, why: "dated blog posts: history, not reference" },
  {
    path: /^goals\/hand-offs\//,
    over: true, why: "the FIX-1816 and FIX-1820 regression checks: ER-11 allows names only, and the closure renames them by map"
  },
  { path: /^goals\/coordinators\/(task-session-stays-open|hands-each-post-to-its-delegates|files-tasks-down-the-owners-chain)\//, over: true, why: "epic regression and coordinator checks: renamed only by the closure's map (ER-11)" },
  { path: /^goals\/workforce-mailboxes\/a-routed-post-gets-one-answer\//, over: true, why: "epic coordinator check: renamed only by the closure's map (ER-11)" },
  {
    path: /\.(png|jpe?g|gif|webp|ico|woff2?|ttf|otf|json|jsonl|ya?ml|lock|css|scss|html|txt|toml|sh|py|sql|snap|map|gitignore|npmignore|env|example|d\.ts\.map)$|(^|\/)\.[^/]+$|(^|\/)(LICENSE|Dockerfile)$/,
    why: "no prose or symbols in scope (data, assets, config)"
  },
  { path: /^(apps|packages)\/.*\.(md|mdx|svg)$/, why: "markdown outside the published docs and package READMEs (fixtures, worker files, app notes)" },
  { path: /^goals\/.*$/, why: "other goal files: only the post-to-mailbox rule reads them, see RETIRED" }
];

/** Hits that keep their word, each with its reason (D3: ask = a question to a person; hand-off = mid-work). */
export const KEEP = [
  {
    path: /^apps\/docs\/docs\/(shift-manager\/|glossary\.md$|glossary\/)/,
    line: /Shift Manager|AskCard|Inbox|approval|question|suspended|\bAsks?\b \|/i,
    rules: ["ask-prose", "ask-symbol", "ask-symbol-in-docs", "ask-mark"],
    why: "Shift Manager's Ask: an approval or question to a person"
  },
  {
    path: /^apps\/docs\/docs\/workforce\/chief-of-staff\.md$/,
    rules: ["ask-prose", "ask-symbol", "ask-symbol-in-docs", "ask-mark"],
    why: "the chief of staff's approval ask: a question to a person"
  },
  {
    path: /^apps\/docs\/docs\/workforce\/chief-of-staff\.md$/,
    // FIX-1872's exact sentence, and only on a line naming `handOff` once: a stale mention beside it stays open.
    line: /^(?!.*`handOff`.*`handOff`).*A file that still names `handOff` is refused\b/,
    rules: ["handoff-symbol-in-docs", "handoff-prose"],
    why: "WR-25b: FIX-1872's sentence that a worker file still naming handOff is refused; a page can't carry the marker"
  },
  {
    path: /^(packages\/shift-manager\/|apps\/docs\/docs\/shift-manager\/)/,
    rules: ["ask-prose", "ask-symbol", "ask-symbol-in-docs", "ask-mark"],
    why: "Shift Manager's Ask and Inbox: a suspended run waiting on a person"
  },
  {
    path: /^packages\/harness-manager\//,
    line: /question|marker|inbox/i,
    rules: ["ask-prose", "ask-symbol", "ask-symbol-in-docs", "ask-mark"],
    why: "the harness question inbox: a coding run asking a person"
  },
  {
    path: /^packages\/engine\/src\/context\/request-principal\.ts$/,
    rules: ["handoff-symbol"],
    why: "a local variable for a request record passed to its holder; not a delivery of work"
  },
  {
    path: /^packages\//,
    line: /\babortHandoff\b/,
    rules: ["handoff-symbol", "handoff-prose"],
    why: "WR-5: the engine's abort of a request record handed to its holder; not a delivery of work"
  },
  {
    path: /^packages\/(orchestration|engine)\/(src|test)\//,
    line: /fsd\.ask\.(step|plan|file)/,
    rules: ["ask-mark"],
    why: "D2: the run-once keys are a process-internal wire value, kept so a replay across the upgrade finds its record (WR-11)"
  },
  {
    path: /^packages\/(orchestration\/(src\/tasks\/notice\/task-notice\.ts|test\/tasks\/task-notice\.test\.ts)|workforce\/src\/conversation-board\/task-settled\.ts)$/,
    line: /\basked\??:/,
    rules: ["ask-mark", "ask-prose"],
    why: "D2: a notice's asked flag is a process-internal wire value, kept so a notice owed across the upgrade is taken (WR-13)"
  }
];
