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
    // Any identifier built on "ask": parkOnAsk, AskEndedError, hasAskSweeper, ASK_GATE_REASON,
    // askGateId, parkTaskOnAsk, asked_task, gate_ask_1. Each alternative needs a capital A, a
    // word start or an underscore before "ask", so "task" never matches. Shift Manager's and the
    // harness's person asks are KEEP.
    pattern: /\b(ask[A-Z]\w*|\w*Ask\w*|ASK_\w+|\w+_ASK\w*|asked?_\w+|\w+_ask(ed)?(_\w+)?)\b/,
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
    pattern: /\b\w*(HandOff|Handoff|handOff|handoff|HandedOff|handedOff|hand_off|handed_off|HAND_OFF|HANDED_OFF)\w*\b|["'`]handed-off["'`]/,
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
    pattern: /\b(an|every|each) ask\b|\basks? (gate|resume|binding|marker|option)s?\b|\basked (task|row|worker|turn|colleague)s?\b|\basker\b|\bthe ask\b(?! (card|inbox))|\b(task|work|row)s? (it|they|you|a turn|the turn) asked for\b/i
  },
  {
    id: "hold-names",
    files: CODE_OR_PUBLISHED,
    // FIX-2183: hold keeps one meaning, the filer's hold before a start. A task's open asks are its
    // questions, what keeps a running task open is keptOpenBy, a request's right on its task is its claim.
    pattern: /\b(TaskHold|taskHoldSchema|RowHold|rowHoldSchema|SuspensionHold|suspensionHoldSchema|RowHoldSource|SuspensionHoldSource|InboxHold|HoldAsk|HoldReleaser|HoldAnswer|MAX_HOLD_PROMPT|openHolds|hasOpenHold|openRowHolds|isRowHold|isSuspensionHold|suspensionHoldOf|holdsDue|nextHoldDue|newRowHolds|holdWrite|HoldChange|HoldWriteResult|payHoldDeadlines|holdDueMs|holdOfSuspension|openUserHolds|whileHoldOpen|refuseWhenHeld|answerHold|done_without_question|waitingOn|TaskWaitingOn|setWaitingOn|filedWorkHolds|holdsItsFiler|heldTask|heldTaskId|heldRowOf|ticketHoldsRow|holderSessionId|holderOf)\b|\bno-such-hold\b/
  },
  {
    id: "hold-prose",
    files: PUBLISHED,
    // FIX-2183: a task waits on its questions; no question holds it.
    pattern: /\bheld on (a|its|the) questions?\b|\bheld on questions\b|\bquestions? holds?\b|\b(a|the|one|its|open) (row|suspension) holds?\b|\bopen holds\b/i
  },
  {
    id: "task-tool-names",
    files: CODE_OR_PUBLISHED,
    // FIX-2243: the collection files with the filer tool's name, createTask; getTask reads, updateTask
    // cancels; the old task tools and the question and review parks are gone with no new name.
    pattern: /\b(addTasks?|readTask|cancelTask|dispatchTask|assignTask|failTask|blockTask|completeTask|answerTask\w*|(create)?[Pp]arkOnQuestion|parkedOnQuestion|awaitReview|unparkAndDrain|onReview|answerQuestion)(_\w+)?\b/
  },
  {
    id: "dispatcher-names",
    files: CODE_OR_PUBLISHED,
    // FIX-2245: "dispatcher" is the dispatcher block. A board's rule for the next task is a ClaimOrder;
    // what decides where a flow action runs is a FlowRunner. Both pick up their old helpers and files.
    pattern: /\b(TaskDispatcher|(fifo|topological|priority|runOwner)Dispatcher|TaskBoardDispatcherInput|resolveDispatcher|FlowDispatcher|InProcessDispatcher(Deps)?|(create|is)InProcessDispatcher|(create|Create)WorkerDispatcher(Options)?|WorkerDispatcher|usesExternalDispatcher)\b|tasks\/dispatchers\/|in-process-dispatcher/,
    pathName: /(^|\/)(in-process-dispatcher\.ts|run-owner-dispatcher\.spec\.ts)$|\/tasks\/dispatchers\/|^packages\/engine\/src\/transports\/dispatcher\.ts$|^packages\/bullmq\/(src|test)\/dispatcher\.(test\.)?ts$/
  },
  {
    id: "routed-task-names",
    files: CODE_OR_PUBLISHED,
    // FIX-2246: a coordinator's post is a routed task. The message it routes is named by the request that
    // carried it (messageRequestId); the post entries, the post-row reader and the old row id are gone.
    pattern: /\b(onDelegatedPost|isPostRow|onPostSettled|postCancelled|RoundPost|postId|legacyPostRowId)\b/
  },
  {
    id: "entry-name-upgrade",
    files: CODE_OR_PUBLISHED,
    // FIX-2246: the board's pass is dispatch, with no host-start rewrite of the old entry names and no
    // retired retry marker left to strip.
    pattern: /\b(runTaskBoard|upgradeWorkerEntryNames|EntryNameFlow|EntryNameRequest|EntryNameUpgradeOptions|EntryNameUpgradeStores|RETRY_OF)\b|upgrade-entry-names/
  },
  {
    id: "wait-mark-spellings",
    files: CODE_OR_PUBLISHED,
    // FIX-2246: a wait gate's id and resolver say wait:, a notice says waitedOn, and no reader takes the
    // spellings from before the wait rename.
    pattern: /(?<=["'`])ask:|\b(LEGACY_WAIT_GATE_REASON|withMigratedWait)\b|\bnotice\.asked\b/
  },
  {
    id: "message-budget",
    files: CODE_OR_PUBLISHED,
    // FIX-2246: hireWorkforce's messages.budget caps the one budget a user's line starts; it was a hop limit.
    pattern: /\b(hopLimit|DEFAULT_MESSAGE_HOP_LIMIT|hop_limit)\b/
  },
  {
    id: "split-leftovers",
    files: CODE_OR_PUBLISHED,
    // FIX-2246: the split's board, settle and cancel, gone with no new name.
    pattern: /\b(delegationBoard|settleSplitTask|cancelSplitPieces)\b/
  },
  {
    id: "session-factory",
    files: CODE_OR_PUBLISHED,
    // FIX-2246: what defineSessionBoard builds is the factory, never the kit.
    pattern: /\b(filing|session|task-filing|manager) kits?\b|\bthe kit('s)?\b|\b(const|this) kit\b|\bkit\.\w+/i
  },
  {
    id: "worker-run-door",
    files: /^(packages\/workforce\/(src\/.*\.ts|README\.md)|apps\/docs\/docs\/workforce\/.*\.mdx?)$/,
    // FIX-2246: a Workforce worker flow's door is respond, the one the worker contract requires.
    pattern: /\bactions: \{ ?run:|`run` \(public\)|wrapped turn for `run`/
  },
  {
    id: "message-door",
    files: CODE_OR_PUBLISHED,
    // FIX-2246: the harness message door and the row mark it kept are gone; harnessSessionDoor replaced it.
    pattern: /\b(parkedForTurn|messageDoor|harnessMessageDoor)\b/
  },
  {
    id: "reopened-shape",
    files: CODE_OR_PUBLISHED,
    // FIX-2246: a finished task takes a follow-up (followUpOf); the reopened row is a retired shape, read
    // only on its marked lines. Exact identifiers, never a reopen prefix: the Inbox's reopened stays.
    pattern: /\bREOPENED_STEER\b|\brow\.reopened\b|\breopened: (true|\{)|"reopened"/
  },
  {
    id: "human-reasons",
    files: new RegExp(`${CODE_OR_PUBLISHED.source}|${PENDING_NOTES.source}`),
    // FIX-2151: the suspension reasons say user. SuspensionReason's open `string & {}` arm compiles a
    // missed one, which then silently becomes a custom reason, so the exact strings are retired.
    pattern: /\bhuman_(approval|input)\b/
  },
  {
    id: "post-to-mailbox",
    files: new RegExp(`${CODE_OR_PUBLISHED.source}|${PENDING_NOTES.source}`),
    pattern: /post-to-mailbox|postToMailbox/
  },
  {
    id: "shift-coordinator-names",
    files: CODE_OR_PUBLISHED,
    // FIX-2244: the worker id is `shift-coordinator`, and the names built on it follow.
    pattern: /chief-of-staff|chiefOfStaff|ChiefOfStaff|CHIEF_OF_STAFF|chief_of_staff/,
    pathName: /chief-of-staff|ChiefOfStaff/
  },
  {
    id: "shift-coordinator-cos",
    files: CODE,
    // FIX-2244: Shift Manager's `cos` route, test ids and names (`cos-panel`, `openCos`, `COS_FLOW`).
    // `Cost`, `COST`, `cosine` and `Math.cos` are other words. Kept matching COS_RULES in
    // scripts/codemod/rename-chief-of-staff.ts.
    pattern: /(?<!Math\.)\bcos(?=[A-Z0-9_]|\b)|[a-z0-9]Cos(?=[A-Z_]|\b)|\bCOS(?=_|\b)|(?<=_)COS\b/,
    pathName: /(^|[/-])cos([-./]|$)/
  },
  {
    id: "shift-coordinator-prose",
    files: CODE_OR_PUBLISHED,
    // FIX-2244: the worker is the Shift Coordinator.
    pattern: /\b[Cc]hiefs? [Oo]f [Ss]taff\b|\bCoS\b/
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
  { path: /^goals\/vocabulary\/one-word-per-thing\//, over: true, why: "this sweep: its rules name every retired word on purpose" },
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
    path: /^packages\/harness-manager\/README\.md$/,
    line: /^### Upgrading from `messageDoor`$|^Before `harnessSessionDoor`, a manager's `messageDoor` \(and `harnessMessageDoor`\) kept/,
    rules: ["message-door"],
    why: "FIX-2246: the README's upgrade note, which says the door is gone and how its kept lines become steers; a page can't carry the marker"
  },
  {
    path: /^packages\/orchestration\/README\.md$/,
    line: /^`reopened: true` reads unmarked; while it is still open/,
    rules: ["reopened-shape"],
    why: "FIX-2246: the README's upgrade note for the reopened shape the read boundary still maps; a page can't carry the marker"
  },
  {
    path: /^goals\//,
    line: /^\| \d{4}-\d{2}-\d{2} \|/,
    rules: ["human-reasons"],
    why: "FIX-2151: a goal's dated verdict row records a past run under the reasons it ran with: history"
  },
  {
    path: /^\.changeset\/user-suspension-reasons\.md$/,
    rules: ["human-reasons"],
    why: "FIX-2151: the release note that tells consumers which old reasons to replace"
  },
  {
    path: /^packages\/engine\/src\/stores\/testing\/request-store-conformance\.ts$/,
    line: /const requestId = "req_fence_(legacy_)?handed_off";$/,
    rules: ["handoff-symbol"],
    why: "a same-owner hand-off of a running request: work already under way changing hands"
  },
  {
    path: /^goals\//,
    line: /^\| \d{4}-\d{2}-\d{2} \||no longer posts its answer with a `post-to-mailbox` tool|`post-to-mailbox`, which went with mailboxes/,
    rules: ["post-to-mailbox"],
    why: "WR-7: a goal's dated verdict row, or a line saying the tool was removed: history"
  },
  {
    path: /^apps\/docs\/docs\/(shift-manager\/|glossary\.md$|glossary\/)/,
    line: /Shift Manager|AskCard|Inbox|approval|question|suspended|\bAsks?\b \|/i,
    rules: ["ask-prose", "ask-symbol", "ask-symbol-in-docs", "ask-mark"],
    why: "Shift Manager's Ask: an approval or question to a person"
  },
  {
    path: /^apps\/docs\/docs\/workforce\/shift-coordinator\.md$/,
    // The approval ask's own lines, and only those: any other ask word on the page stays open.
    line: /^(?!.*\bparkOnAsk\b).*(as `askFire` does|wrap it with an ask|The ask outlives a restart|the ask above refuses)/,
    rules: ["ask-prose", "ask-symbol", "ask-symbol-in-docs", "ask-mark"],
    why: "the Shift Coordinator's approval ask: a question to a person"
  },
  {
    path: /^apps\/docs\/docs\/workforce\/shift-coordinator\.md$/,
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
    path: /^packages\/orchestration\/(src\/inbox\/|test\/inbox(-truth-control)?\.test\.ts$)/,
    rules: ["ask-prose", "ask-symbol", "ask-symbol-in-docs", "ask-mark"],
    why: "the Inbox read (FIX-2133): a question's `ask`, what it asks the user, as FIX-2058's TaskQuestion names it"
  },
  {
    path: /^packages\/orchestration\/(src\/tasks\/(schema\/question|collection\/questions)\.ts|test\/(collection\/(questions|waiting-on-user)|skills\/questions-tools)\.test\.ts)$/,
    rules: ["ask-prose", "ask-symbol", "ask-symbol-in-docs", "ask-mark"],
    why: "a task's questions (FIX-2133): a question's `ask`, a question to the user, and the collection's `ask` that opens one midway, as FIX-2058's TaskQuestion names them"
  },
  {
    path: /^(packages\/orchestration\/(src|test)\/|packages\/integration-tests\/src\/scenarios\/|packages\/workforce\/src\/conversation-board\/board\.ts$|apps\/docs\/docs\/orchestration\/task-board\.md$)/,
    // The question's names only: a question to the user, opened at filing or midway. Any other ask word on these lines' files stays open.
    line: /\b(askMidway|MidwayAsk|AskDeclineReason|QuestionInit|askProblem|assertAskable|askOf|askOptions)\b|\b(hold|ledger|board|collection|ref)\??\.ask\b|TaskCollectionRef(\["ask"\]|\.ask\b)|^\s*ask: (\{|z\.)|\{ ask: \{|\.ask\.(kind|prompt)\b/,
    rules: ["ask-symbol", "ask-symbol-in-docs", "ask-mark"],
    why: "a task's questions (FIX-2133): a question's `ask` and the midway ask that opens one, a question to the user"
  },
  {
    path: /^(packages\/(orchestration|workforce)\/(src|test)\/|apps\/docs\/(docs|guides)\/|packages\/(orchestration|workforce)\/README\.md$)/,
    // The worker's question tool and the one-wait-per-turn rule's names only: a question to the user.
    line: /\b(askQuestion|createAskQuestion|turnAsked|askMidway)\b|\.ask(\.(kind|prompt)\b|\)\.toMatchObject)/,
    rules: ["ask-symbol", "ask-symbol-in-docs", "ask-mark"],
    why: "FIX-2131: the worker's `askQuestion`, a question to the user that its task waits on, and the turn-asked fact it is refused on"
  },
  {
    path: /^packages\/devtool\/(src\/react\/lib\/task-collection-state\.ts|test\/task-collections-reason\.test\.tsx)$/,
    // The DevTool's wire mirror of a question's `ask` only, and the reason slot reading its prompt.
    line: /^\s*ask: \{ kind: string|\bask: \{ kind: "(question|review)"|\)\?\.ask\.prompt;$/,
    rules: ["ask-mark"],
    why: "FIX-2131: the DevTool's mirror of a task's questions (FIX-2133's TaskQuestion), whose `ask` is what the user was asked"
  },
  {
    path: /^packages\/harness-manager\//,
    line: /question|marker|inbox/i,
    rules: ["ask-prose", "ask-symbol", "ask-symbol-in-docs", "ask-mark"],
    why: "the harness question inbox: a coding run asking a person"
  },
  {
    path: /^packages\//,
    line: /\babortHandoff\b/,
    rules: ["handoff-symbol", "handoff-prose"],
    why: "WR-5: the engine's abort of a request record handed to its holder; not a delivery of work"
  },
  {
    path: /^packages\/engine\/(src\/(context\/(request-principal|createExecutionContext)|execution\/(runAction|types)|stores\/(types|testing\/request-store-conformance)|transports\/host\/createInboundTransportHost)\.ts|test\/(abort|request-incarnation)\.test\.ts)$/,
    // Each phrase and name the request-record and abort-controller code uses, so a new
    // "hand off" line in these files stays open until someone classifies it.
    line: /same-owner hand-off|last-write-wins hand-off|hand-off writes the holder's value|since the hand-off also replaces|\b(keepHandoff|handoffIncarnation)\b|\bhandoff( !==| ===| =$|\.controller|\.incarnation)|^\s*(const|let) handoff =|lost in the handoff|exercise the handoff|handed-off legacy record|makes the handoff atomic|incarnation \(a hand-off$|the same hand-off the enqueue-time record|the hand-off to a run|queued[-_]abort[-_]handoff|\b[sr]e?q?_queued_handoff\b|The hand-off really did rewrite|"handed off"|for a handed-off$|hand-off never rewrites|loses the race and hands off|the handed-off record|The hand-off overwrites|through the hand-off"/,
    rules: ["handoff-symbol", "handoff-prose"],
    why: "WR-5: a claimed request record, or its abort controller, passed to the run that holds it: mid-work (D3)"
  },
  {
    path: /^(packages\/engine\/(src\/transports\/(concurrency\/arbiter|host\/createInboundTransportHost)\.ts|test\/transports\/concurrency\/lease-backend\.test\.ts)|docs\/architecture\/inbound-transports\.md)$/,
    line: /ConcurrencyAdmission\.handOff|\bhandOff\(|handOff: |\batHandOff\b|^\s*\* handed off\.$|place rides|it is handed off$|cross-call handoff/,
    rules: ["handoff-symbol", "handoff-symbol-in-docs", "handoff-prose"],
    why: "D3: a queue place passed to the job that holds it once enqueued, mid-work"
  },
  {
    path: /^packages\/engine\/src\/utils\/keyed-async-gate\.ts$/,
    rules: ["handoff-prose"],
    why: "D3: a lock passed straight to the next waiter, mid-work"
  },
  {
    path: /^(packages\/shift-manager\/(src\/(gaps\.ts|surfaces\/TaskFrame\.tsx)|test\/task-screen\.test\.tsx|README\.md)|apps\/docs\/docs\/shift-manager\/overview\.md)$/,
    line: /\bhandOff\b|"Hand off"|^\| Hand off, reassign|^- On a task: Hand off, reassign/,
    rules: ["handoff-symbol", "handoff-prose"],
    why: "D3: the task screen's Hand off action, which moves a task already being worked to another worker"
  },
  {
    path: /^docs\/architecture\/state-and-scopes\.md$/,
    line: /same-owner hand-off/,
    rules: ["handoff-prose"],
    why: "WR-5: a claimed request record passed to the run that holds it, mid-work (D3)"
  },
  {
    path: /^apps\/docs\/docs\/glossary\.md$/,
    line: /^\| \*\*Hand-off\*\* \| orchestration \| A session that was doing the work passes it to another session, mid-work\./,
    rules: ["handoff-prose"],
    why: "D3: the glossary row that defines hand-off as mid-work only"
  },
  {
    path: /^apps\/docs\/docs\/workforce\/workers-on-disk\.md$/,
    line: /`escalate` hands off to a person\./,
    rules: ["handoff-prose"],
    why: "D3: a triage worker escalating a request it is already handling to a person, mid-work"
  },
  {
    path: /^apps\/docs\/docs\/orchestration\/task-board\.md$/,
    line: /^<a id="assignees-that-hand-off"><\/a>$/,
    rules: ["handoff-prose"],
    why: "WR-18: the renamed section keeps its old anchor, so an old link still lands on it"
  },
  {
    path: /^(packages\/workforce\/README\.md|apps\/docs\/docs\/workforce\/coordinators\.md)$/,
    // FIX-1872's sentences, on a line naming `handOff` once: a stale mention beside them stays open.
    line: /^(?!.*`handOff`.*`handOff`).*(named the (coordinator's )?dispatch tool `handOff`|names `handOff` is refused)/,
    rules: ["handoff-symbol-in-docs", "handoff-prose"],
    why: "WR-25b: FIX-1872's sentences that the tool was named handOff and a worker file naming it is refused; a page can't carry the marker"
  },
  {
    path: /^(packages|apps|docs\/architecture)\//,
    // A capitalized English verb ("Ask the team anything.", "Asked of the host here", "Self-Ask"),
    // on a line naming no identifier built on ask: the symbol rules' pattern can't tell them apart.
    line: /^(?!.*\b\w+Ask)(?!.*\bask[A-Z])(?!.*\bASK_)(?!.*\bAsk[A-Z]).*\b(Ask|Asks|Asked|Asking)\b/,
    rules: ["ask-symbol", "ask-symbol-in-docs"],
    why: "WR-5: the English verb, not a name; the line names no identifier built on ask"
  },
  {
    path: /^packages\/harness-manager\//,
    rules: ["ask-prose", "ask-symbol", "ask-symbol-in-docs", "ask-mark"],
    why: "WR-3: the harness question inbox, where a coding run's ask is a question to a person"
  },
  {
    path: /^apps\/kitchen-sink\/(flows\/chat-agent\/|e2e\/smoke-ask\.spec\.ts$)|^packages\/integration-tests\/src\/scenarios\/chat-ask\.test\.ts$/,
    rules: ["ask-symbol", "ask-mark"],
    why: "WR-3: the kitchen sink's Ask mode and its clarifying question: a question to the person chatting"
  },
  {
    path: /^apps\/kitchen-sink\/(lib\/workforce-shell\.ts|components\/picked-session-panel\.tsx|test\/workforce-shell\.test\.ts)$/,
    line: /COORDINATOR_ASK|WORKER_ASKS|[Ww]orkerAsk/,
    rules: ["ask-symbol"],
    why: "WR-5: the kitchen sink shell's message box, where the person asks a worker; nothing waits on a task"
  },
  {
    path: /^packages\/cli\/src\//,
    rules: ["ask-symbol", "ask-prose"],
    why: "WR-5: the CLI asks the app who an in-process caller is; not a wait"
  },
  {
    path: /(^|\/)cascading-router(\.test|\.test-d)?\.ts$/,
    rules: ["ask-symbol", "ask-mark"],
    why: "WR-5: a cascading router level's `ask`, the evaluator it asks a question of"
  },
  {
    path: /^(packages\/core\/test\/flow-config\.test\.ts|packages\/engine\/test\/(faceted-collection|flow-instance-ownership|request-action-result|suspension-resume)\.test\.ts|packages\/integration-tests\/src\/scenarios\/request-action-result\.test\.ts|packages\/workforce\/test\/(split-resource-modules|worker-door)\.test\.ts|docs\/architecture\/action-forms\.md)$/,
    line: /\bask\??:\s*\{|askSeq/,
    rules: ["ask-mark", "ask-symbol"],
    why: "WR-5: a test flow's action named ask, a chat or approval turn a person starts; not a wait"
  },
  {
    path: /^packages\/engine\/test\/context\/request-host-e2e\.test\.ts$/,
    line: /\bask\??:\s*z\./,
    rules: ["ask-mark"],
    why: "WR-5: the ids a liveness probe asks about"
  },
  {
    path: /^packages\/orchestration\/test\/skills\/skill-activator-evaluator\.test\.ts$/,
    line: /\b[st]\.ask\(/,
    rules: ["ask-mark"],
    why: "WR-5: the test's helper that asks the skill evaluator a question"
  },
  {
    path: /^packages\/orchestration\/test\/(task-board\/task-board-park-exit-drain|collection\/answer-reentry)\.test\.ts$/,
    rules: ["ask-symbol"],
    why: "WR-3: a task parked on its worker's question to a person"
  },
  {
    path: /^packages\/workforce\/(src\/coordinator\/(coordinator-flow|coordinator-keys)\.ts|test\/(worker-discovery|project-workspace-workstream|project-workspace-task)\.test\.ts)$/,
    line: /COORDINATOR_ROUTE_ASK|routeAsked|askRoute|askDoor|askThroughHiredWorker|askSource|\bAsked\b/,
    rules: ["ask-symbol"],
    why: "WR-5: asking a model to route, or asking a door or a source a question; not a wait"
  },
  {
    path: /^packages\/integration-tests\/src\/two-users-one-tenant\/non-streaming-text\.test\.ts$/,
    line: /askStreamed|askGenerated/,
    rules: ["ask-symbol"],
    why: "WR-5: two actions that ask a desk a question; not a wait"
  },
  {
    path: /^packages\/workspace\/src\/local-host\.ts$/,
    line: /core\.askPass/,
    rules: ["ask-symbol"],
    why: "git's own setting name"
  },
  {
    path: /^packages\/ui\/test\/render\/status-tokens\.test\.tsx$/,
    line: /never as an ask/,
    rules: ["ask-prose"],
    why: "WR-3: a person's approval or question, which a blocked task's notes are not drawn as"
  },
  {
    path: /^packages\/((core|engine)\/(src\/execution\/request-side-chain-pool\.ts|test\/request-side-chain-pool\.test\.ts)|tools\/test\/bash-moat-purge\.test\.ts)$/,
    line: /\baddTask\b/,
    rules: ["task-tool-names"],
    why: "FIX-2243: the engine's side-chain pool's addTask (or a test's stand-in pool) adds a promise to a request's pool, not a task to a collection"
  },
  {
    path: /^packages\/core\/src\/blocks\/sequencer\.ts$/,
    line: /\bpool\.addTask\(/,
    rules: ["task-tool-names"],
    why: "FIX-2243: a side chain's promise added to the request's side-chain pool, not a task"
  },
  {
    path: /^packages\/orchestration\/src\/skills\/task-tools-capability\.ts$/,
    line: /\banswerQuestion\(/,
    rules: ["task-tool-names"],
    why: "FIX-2243: updateTask's live helper that answers a task's open question; the harness manager's removed answerQuestion() was another thing"
  },
  {
    path: /^(packages\/(workforce|cli)\/README\.md|apps\/docs\/docs\/workforce\/documents-on-disk\.md)$/,
    line: /\banswerQuestion\b/,
    rules: ["task-tool-names"],
    why: "FIX-2243: an example app's own block or action that answers a person's question, not a task tool"
  }
];
