/**
 * The vocabulary glossary: one word per framework concept, and every rule the vocabulary checks
 * enforce about it. Read it before you name a public thing.
 *
 * This file is the source. The three vocabulary checks import it and keep only how they find a
 * word (their file walk, their encodings, their report):
 *
 *   - the sweep,          `goals/vocabulary/one-word-per-thing/sweep.mjs`
 *   - the Workforce guard, `scripts/check-retired-terms.mjs`
 *   - the side-chain check, `scripts/validate-side-chain-vocabulary.mjs`
 *
 * A word is retired, exempted or un-retired by editing an entry here, and every check enforces the
 * edit on its next run. No check, skill, goal or script restates a rule from this file.
 *
 * ## How the file reads
 *
 * 1. {@link ENTRIES}: each term, what it means, the decision behind it, and the words it retires.
 *    The published glossary page defines every entry flagged `published: true`.
 * 2. {@link EXEMPTIONS}: each place a retired word is kept on purpose, with its reason.
 * 3. Where the checks read: {@link CONTRIBUTOR} (both, for names), {@link EXCLUDE} (the sweep), {@link AREAS}
 *    (the guard).
 *
 * ## Retiring a word
 *
 * Add it to the entry that says what to use instead:
 *
 *     retires: [{ name: "isInProcessDispatcher" }],
 *
 * A retirement with no `check` is a whole-word name match, refused by both the sweep and the
 * guard. One that names a `check` uses that check's matcher: `"sweep"` (a `pattern` over `files`),
 * `"guard"` (a global `re`, optionally on Workforce's `ground` only), `"side-chain"` (an identifier,
 * matched on the syntax tree), or `"tree"` (the guard's scan of every in-scope file for a declared
 * name and a page's prose).
 *
 * `reach` is `"name"` (an identifier or a term, read in every tree the checks read, the contributor
 * trees included; the default) or `"meaning"` (an English word refused in one sense, read in code
 * and published pages only).
 *
 * ## Keeping a word
 *
 * Add an exemption that names the retirements it keeps and why. Never widen one to go green:
 * rename the line. A line that names a retired word on purpose (a legacy reader, a refusal) can
 * instead carry {@link REFUSAL_MARKER}, which the sweep counts and does not fail.
 *
 * This file names every retired word on purpose, so every check excludes it by a named rule.
 */

/** FIX-1875's marker for a line that names a retired word on purpose. One spelling repo-wide. */
export const REFUSAL_MARKER = "retired-name-refusal";

// ---------------------------------------------------------------------------------------------
// File scopes the entries below use. A sweep retirement's `files` is one of these.
// ---------------------------------------------------------------------------------------------

// A lab or an example is read like a package (FIX-2354).
const CODE = /^(packages|apps|labs|examples)\/.*\.(ts|tsx|mts|cts|js|mjs|cjs|jsx)$/;
const PUBLISHED = /^(apps\/docs\/(docs|guides)\/.*\.(md|mdx|svg)|packages\/[^/]+\/README\.md|docs\/architecture\/.*\.md)$/;
const CODE_OR_PUBLISHED = new RegExp(`${CODE.source}|${PUBLISHED.source}`);
const PENDING_NOTES = /^(\.changeset\/.*\.md|goals\/.*\.(md|mts|ts))$/;
const CODE_PUBLISHED_OR_NOTES = new RegExp(`${CODE_OR_PUBLISHED.source}|${PENDING_NOTES.source}`);

/**
 * The trees a contributor or an agent reads: the contributor docs, the skills and workflows, the
 * root instruction files, the pending release notes, and the notes beside a lab or an example.
 * Both checks read them for retired names, never for English meanings (FIX-2354 D1).
 */
const CONTRIBUTOR = /^(docs\/contributing\/|\.agents\/|docs\/(philosophy|objectives)\.md$|docs\/mechanisms\/|(CLAUDE|AGENTS|CONTRIBUTING|README)\.md$|\.changeset\/[^/]+\.md$|(labs|examples)\/.*\.(md|mdx)$)/;

/** Where a retirement of each reach is read by the sweep, when it names no `files` of its own. */
const REACH_FILES = { name: CODE_PUBLISHED_OR_NOTES, meaning: CODE_OR_PUBLISHED };

/** FIX-2354: the contributor files that name the fixpoint-labs/agent-mailbox board, where agents outside a session talk. */
const AGENT_MAILBOX_FILES =
  /^(\.agents\/skills\/(agent-mailbox|epic-lifecycle|fsd-coding|issue-implement|issue-lifecycle|review)\/SKILL\.md|\.agents\/subagents\/issue-worker\.md|\.agents\/workflows\/(epic-wake\.js|verify\.mjs)|CLAUDE\.md|docs\/contributing\/(development-setup|orchestration|spec-template)\.md)$/;

/** FIX-2248: the goal folders that named a seat or a mailbox (or a person for the user), exact names only. */
const SEAT_MAILBOX_GOAL_NAMES = [
  "mailbox-boards",
  "multi-seat-collab",
  "workforce-mailboxes",
  "workforce-seats",
  "it-commits-from-the-seats-own-file",
  "it-keeps-its-rows-on-the-mailboxes-board",
  "it-wakes-the-seat-a-file-declared",
  "it-ships-an-artifact-a-person-can-open",
  "refuses-a-board-drain-onto-a-seat-it-is-outside",
  "a-person-talks-to-a-seat-a-mailbox-and-back",
  "agent-replies-in-the-mailbox",
  "it-routes-a-queue-to-the-seats-their-files-name",
  "it-hands-a-row-between-two-seats-in-view",
  "a-post-reaches-both-declared-seats",
  "a-seat-answers-from-its-own-document",
  "it-sends-a-turn-into-a-seat-session",
  "a-team-says-once-what-its-seats-are-told",
  "a-callers-own-agent-wins-every-seat",
  "a-non-agent-seat-receives-its-skills",
  "a-seat-reaches-the-documents-its-file-names",
];

/**
 * A row name: `row` or `rows` as a word part, camelCase or snake: `row`, `rows`, `taskRow`, `rowId`, `TRow`,
 * `TaskRowsPage`, `ROW_ID`. Not `arrow`, `narrow`, `Rowan`, `rowset`.
 */
const ROW_NAME = /(?:^|_)rows?(?:$|[A-Z_0-9])|Rows?(?:$|[A-Z_0-9])|(?:^|_)ROWS?(?:$|_)/;

// ---------------------------------------------------------------------------------------------
// 1. The terms
// ---------------------------------------------------------------------------------------------

/**
 * One entry per term: `term`, `means` (one sentence), `decision` (where it was decided),
 * `published` (the published glossary page defines it), and `retires` (the words it replaces).
 */
// fallow-ignore-next-line unused-export -- loaded by path from a copy in packages/core/test/vocabulary-glossary.test.ts
export const ENTRIES = [
  // Resource and status ----------------------------------------------------------------------
  {
    term: "Resource",
    means: "Named, schema-validated state; a resource in a collection is a resource, and `collection.get()` returns its `ResourceRef`.",
    decision: "Owner, 2026-11-06 (supersedes the 2026-11-02 collection-item call); FIX-2600",
    names: "xResourceStateSchema (the zod value), XResourceState (the stored data), XResourceRef (an instance), XCollectionRef (a collection's handle). Definitions keep their names (janitorResource, worktreesCollection). Row stays only in store adapters and visual UI list rows.",
    retires: [
      {
        id: "collection-row",
        check: "tree",
        // The whole tree (epic ER-6): every in-scope file, so a name left anywhere counts, not only a new one.
        // Row locals, parameters and properties are the exception, by the owner's staging (FIX-2631): only a
        // change's new ones count, until FIX-2632 renames the existing ones package by package.
        say: "the resource: XResourceState for what is stored, XResourceRef for one instance; XStatus for a lifecycle",
        anchor: ["ResourceRef", "XResourceState", "XResourceRef", "XCollectionRef", "XStatus"],
        // Code. The guard reads the names a file declares with TypeScript's parser (FIX-2631 D2) and keeps the
        // ones `rowName` matches. `treeKinds` count on every line of the tree: any type, interface, enum or class,
        // an exported function, variable or destructured binding, a name an export list binds, and a type
        // parameter. A local, a parameter, an import alias or a property is no name anyone meets yet, so it counts
        // only when a change adds it (`--added-since`): a file may not declare more row names than its base did.
        // A read (`entry.row`), an object key, a plain import and a plain re-export are uses, never counted.
        rowName: ROW_NAME,
        treeKinds: ["type", "class", "exported-value", "export", "type-parameter"],
        // What a refusal of an added row name says to use instead.
        sayAdded: "entry, or the resource's own name (taskEntry, task)",
        // Code. Any name built on CollectionItem, a use as well as a declaration: always a resource, wherever it sits.
        namesItem: /(?<![\w$])([\w$]*[Cc]ollectionItems?[\w$]*)/g,
        // Code. A lifecycle named State: a string-literal union (on one line or several) or a z.enum. State is scope or resource state only.
        declaresState: /(?<![\w$.])type\s+(\w*State)\s*=\s*(?:\/\*[\s\S]*?\*\/\s*|\/\/[^\n]*\n\s*)*\|?\s*["'`]|(?<![\w$.])(?:const|let|var)\s+(\w*State(?:Schema)?)\s*=\s*z\s*\.\s*enum\(|(?<![\w$.])enum\s+(\w*State)\s*\{/g,
        // Docs calling a resource in a collection a row: "collection row", "collection's row", "the row of the collection".
        prose: /\bcollection\s+rows?\b|\bcollection(?:'s|s')\s+rows?\b|\brows?\s+(?:in|of|from|inside|on)\s+(?:the\s+|a\s+|an\s+)?(?:[\w'-]+\s+){0,4}collection\b/i,
        // Every line of every in-scope file, code and pages alike: a resource's own noun, then row or rows.
        // "the subscription row", "a task's rows". The kept paths keep these too.
        phrases: /\b(?:subscription|schedule|poll|task|worker|project)(?:'s)?\s+rows?\b/i,
      },
    ],
  },
  {
    term: "Status",
    means: "A lifecycle enum (`WorktreeStatus`), with no `…Type` suffix.",
    decision: "Owner, 2026-11-06",
    retires: [],
  },
  {
    term: "State",
    means: "Scope state or resource state, and nothing else.",
    decision: "Owner, 2026-11-06",
    retires: [],
  },
  {
    term: "Item",
    means: "A stream item: what a run streams back (`OutputItem`, `getItems`). Not a resource in a collection.",
    decision: "Owner, 2026-11-06",
    retires: [],
  },

  // Dispatch, wait, ask and hand-off ----------------------------------------------------------
  {
    term: "Dispatch",
    means: "Start work on another worker. A task board's pass is a dispatch.",
    decision: "FIX-1876; FIX-2246",
    retires: [
      {
        id: "entry-name-upgrade",
        check: "sweep",
        files: CODE_OR_PUBLISHED,
        // FIX-2246: the board's pass is dispatch, with no host-start rewrite of the old entry names and no
        // retired retry marker left to strip.
        pattern: /\b(runTaskBoard|upgradeWorkerEntryNames|EntryNameFlow|EntryNameRequest|EntryNameUpgradeOptions|EntryNameUpgradeStores|RETRY_OF)\b|upgrade-entry-names/,
      },
    ],
  },
  {
    term: "Wait",
    means: "What a turn does on a task it dispatched. A wait gate's id and resolver say `wait:`, a notice says `waitedOn`.",
    decision: "FIX-1876; FIX-2246",
    retires: [
      {
        id: "wait-mark-spellings",
        check: "sweep",
        files: CODE_OR_PUBLISHED,
        // No reader takes the spellings from before the wait rename.
        pattern: /(?<=["'`])ask:|\b(LEGACY_WAIT_GATE_REASON|withMigratedWait)\b|\bnotice\.asked\b/,
      },
    ],
  },
  {
    term: "Ask",
    means: "Only a question to a person (an approval, a clarifying question). Never delivering work.",
    decision: "FIX-1876 D3",
    retires: [
      {
        id: "ask-symbol",
        check: "sweep",
        files: CODE,
        // Any identifier built on "ask": parkOnAsk, AskEndedError, hasAskSweeper, ASK_GATE_REASON,
        // askGateId, parkTaskOnAsk, asked_task, gate_ask_1. Each alternative needs a capital A, a
        // word start or an underscore before "ask", so "task" never matches. A person's ask is kept.
        pattern: /\b(ask[A-Z]\w*|\w*Ask\w*|ASK_\w+|\w+_ASK\w*|asked?_\w+|\w+_ask(ed)?(_\w+)?)\b/,
        pathName: /(^|\/)(ask-|[^/]*-ask[-.])[^/]*$/,
      },
      {
        id: "ask-symbol-in-docs",
        check: "sweep",
        files: PUBLISHED,
        // The same identifiers where a page or README names them in backticks.
        pattern: /`[^`]*\b(?!\w*[Tt]ask)(ask[A-Z]\w*|\w*Ask\w*|ASK_\w+)\b[^`]*`/,
      },
      {
        id: "ask-mark",
        check: "sweep",
        files: CODE_OR_PUBLISHED,
        // The persisted marks: a task's `ask` field, the run-once keys, the notice flag.
        pattern: /(\??\.ask\b(?!\w)|\bask\??:\s*(z\.|\{|undefined)|fsd\.ask\.|\basked:\s*true\b)/,
      },
      {
        id: "ask-prose",
        check: "sweep",
        reach: "meaning",
        files: CODE_OR_PUBLISHED,
        // "ask" for delivering work. A question to a person is the only meaning kept.
        pattern: /\b(an|every|each) ask\b|\basks? (gate|resume|binding|marker|option)s?\b|\basked (task|row|worker|turn|colleague)s?\b|\basker\b|\bthe ask\b(?! (card|inbox))|\b(task|work|row)s? (it|they|you|a turn|the turn) asked for\b/i,
      },
    ],
  },
  {
    term: "Hand-off",
    means: "A session that was doing the work passes it to another session, mid-work. Never delivering new work.",
    decision: "FIX-1876 D3",
    published: true,
    retires: [
      {
        id: "handoff-symbol",
        check: "sweep",
        files: CODE,
        // Any identifier built on "hand off": createHandOff, handedOffTaskPredicate, abortHandoff.
        pattern: /\b\w*(HandOff|Handoff|handOff|handoff|HandedOff|handedOff|hand_off|handed_off|HAND_OFF|HANDED_OFF)\w*\b|["'`]handed-off["'`]/,
        pathName: /(^|\/)[^/]*hand-?off[^/]*$/,
      },
      {
        id: "handoff-symbol-in-docs",
        check: "sweep",
        files: PUBLISHED,
        pattern: /`[^`]*(\w*(HandOff|Handoff|handOff|handedOff)\w*|handed-off)[^`]*`/,
      },
      {
        id: "handoff-prose",
        check: "sweep",
        reach: "meaning",
        files: CODE_OR_PUBLISHED,
        // "hand-off" for delivering new work. Mid-work hand-off is the only meaning kept.
        pattern: /\bhand(-| )?offs?\b|\bhanded[- ]off\b|\bhand(s|ing)? (it |them |the \w+ |a \w+ |work )?off\b/i,
      },
    ],
  },

  // Dispatcher, flow runner and claim order ---------------------------------------------------
  {
    term: "Dispatcher",
    means: "The dispatcher block, and only it.",
    decision: "FIX-2245",
    retires: [
      // A board's rule for the next task is a ClaimOrder; what decides where a flow action runs is a
      // FlowRunner. Their old names are bare, so the sweep and the guard both refuse them (FIX-2354).
      ...[
        "TaskDispatcher",
        "fifoDispatcher",
        "topologicalDispatcher",
        "priorityDispatcher",
        "runOwnerDispatcher",
        "TaskBoardDispatcherInput",
        "resolveDispatcher",
        "FlowDispatcher",
        "InProcessDispatcher",
        "InProcessDispatcherDeps",
        "createInProcessDispatcher",
        "isInProcessDispatcher",
        "createWorkerDispatcher",
        "CreateWorkerDispatcher",
        "createWorkerDispatcherOptions",
        "CreateWorkerDispatcherOptions",
        "WorkerDispatcher",
        "usesExternalDispatcher",
      ].map((name) => ({ name })),
      {
        id: "dispatcher-paths",
        check: "sweep",
        files: CODE_OR_PUBLISHED,
        // The old files and folders, by path and where a line names one.
        pattern: /tasks\/dispatchers\/|in-process-dispatcher/,
        pathName: /(^|\/)(in-process-dispatcher\.ts|run-owner-dispatcher\.spec\.ts)$|\/tasks\/dispatchers\/|^packages\/engine\/src\/transports\/dispatcher\.ts$|^packages\/bullmq\/(src|test)\/dispatcher\.(test\.)?ts$/,
      },
    ],
  },
  {
    term: "Flow runner",
    means: "What decides where a flow action runs (`FlowRunner`).",
    decision: "FIX-2245",
    retires: [],
  },
  {
    term: "Claim order",
    means: "A task board's rule for which task is claimed next (`ClaimOrder`).",
    decision: "FIX-2245",
    retires: [],
  },

  // Tasks and holds ---------------------------------------------------------------------------
  {
    term: "Hold",
    means: "What keeps a task open for a person; a question is one kind of hold (`holds`, `holdTaskForUser`, `suspendForUser`).",
    decision: "FIX-2183; FIX-2317",
    retires: [
      {
        id: "hold-names",
        check: "sweep",
        files: CODE_OR_PUBLISHED,
        // FIX-2183: what keeps a running task open is keptOpenBy, a request's right on its task is its claim.
        // FIX-2317 brought a task's holds back, so only the names neither change kept stay retired here.
        pattern: /\b(HoldAsk|HoldReleaser|HoldAnswer|MAX_HOLD_PROMPT|refuseWhenHeld|answerHold|done_without_question|waitingOn|TaskWaitingOn|setWaitingOn|filedWorkHolds|holdsItsFiler|heldTask|heldTaskId|heldRowOf|ticketHoldsRow|holderSessionId|holderOf)\b|\bno-such-hold\b/,
      },
      {
        id: "hold-prose",
        check: "sweep",
        reach: "meaning",
        files: PUBLISHED,
        // FIX-2183: no task is "held on questions"; FIX-2317: a question is one kind of hold on its task.
        pattern: /\bheld on (a|its|the) questions?\b|\bheld on questions\b/i,
      },
      {
        id: "question-hold-names",
        check: "sweep",
        files: CODE_OR_PUBLISHED,
        // FIX-2317: the task's list is `holds`, a request's stop for a person is `suspendForUser`, and a
        // worker's question is `holdTaskForUser`.
        pattern: /\b(TaskQuestion|taskQuestionSchema|RowQuestion|rowQuestionSchema|SuspensionQuestion|suspensionQuestionSchema|RowQuestionSource|SuspensionQuestionSource|InboxQuestion|QuestionCloser|QuestionChange|QuestionWriteResult|openQuestions|hasOpenQuestion|openRowQuestions|isRowQuestion|isSuspensionQuestion|suspensionQuestionOf|questionsDue|nextQuestionDue|newRowQuestions|questionWrite|payQuestionDeadlines|questionDueMs|questionOfSuspension|openUserQuestions|whileQuestionOpen|refuseWithOpenQuestion|createAskQuestion|createWaitForUserTool|waitForUser\w*|WaitForUser\w*|askQuestion)\b|wait-for-user/,
      },
    ],
  },
  {
    term: "Task tools",
    means: "The filer's tools: `createTask` files, `getTask` and `listTasks` read, `updateTask` changes or cancels.",
    decision: "FIX-2243",
    retires: [
      {
        id: "task-tool-names",
        check: "sweep",
        files: CODE_OR_PUBLISHED,
        // The old task tools and the question and review parks are gone with no new name.
        pattern: /\b(addTasks?|readTask|cancelTask|dispatchTask|assignTask|failTask|blockTask|completeTask|answerTask\w*|(create)?[Pp]arkOnQuestion|parkedOnQuestion|awaitReview|unparkAndDrain|onReview|answerQuestion)(_\w+)?\b/,
      },
    ],
  },
  {
    term: "Routed task",
    means: "A coordinator's post; the message it routes is named by the request that carried it (`messageRequestId`).",
    decision: "FIX-2246",
    retires: [
      {
        id: "routed-task-names",
        check: "sweep",
        files: CODE_OR_PUBLISHED,
        // The post entries, the post reader and the old post id are gone.
        pattern: /\b(onDelegatedPost|isPostRow|onPostSettled|postCancelled|RoundPost|postId|legacyPostRowId)\b/,
      },
    ],
  },
  {
    term: "Message budget",
    means: "`hireWorkforce`'s `messages.budget`: the one budget a user's line starts.",
    decision: "FIX-2246",
    retires: [
      {
        id: "message-budget",
        check: "sweep",
        files: CODE_OR_PUBLISHED,
        // It was a hop limit.
        pattern: /\b(hopLimit|DEFAULT_MESSAGE_HOP_LIMIT|hop_limit)\b/,
      },
    ],
  },
  {
    term: "Split",
    means: "A task split into pieces on the task board, with no board, settle or cancel of its own.",
    decision: "FIX-2246",
    retires: [
      {
        id: "split-leftovers",
        check: "sweep",
        files: CODE_OR_PUBLISHED,
        // The split's board, settle and cancel, gone with no new name.
        pattern: /\b(delegationBoard|settleSplitTask|cancelSplitPieces)\b/,
      },
    ],
  },
  {
    term: "Session factory",
    means: "What `defineSessionBoard` builds. Never a kit.",
    decision: "FIX-2246",
    retires: [
      {
        id: "session-factory",
        check: "sweep",
        reach: "meaning",
        files: CODE_OR_PUBLISHED,
        pattern: /\b(filing|session|task-filing|manager) kits?\b|\bthe kit('s)?\b|\b(const|this) kit\b|\bkit\.\w+/i,
      },
    ],
  },
  {
    term: "Follow-up",
    means: "What a finished task takes (`followUpOf`). The reopened task is a retired shape, read only on its marked lines.",
    decision: "FIX-2246",
    retires: [
      {
        id: "reopened-shape",
        check: "sweep",
        files: CODE_OR_PUBLISHED,
        // Exact identifiers, never a reopen prefix: the Inbox's reopened stays.
        pattern: /\bREOPENED_STEER\b|\brow\.reopened\b|\breopened: (true|\{)|"reopened"/,
      },
    ],
  },
  {
    term: "Message",
    means: "What one worker sends another through Workforce's messaging.",
    decision: "FIX-2070; FIX-2242 D2",
    retires: [
      {
        id: "message-names",
        check: "sweep",
        files: CODE_OR_PUBLISHED,
        // The old tool, entry, relay and refusals. The entry's first names are swept as
        // receiveProblem/receiveEntry/RECEIVE_ENTRY, never a bare `receive`.
        pattern:
          /\b(onWorkerMessage|messageWorker|MESSAGE_WORKER_TOOL|WORKER_MESSAGE_ENTRY|workerMessageEntry|sendWorkerMessage|SendWorkerMessage|takesWorkerMessages|messageWorkerInputSchema|workerMessageInputSchema|WORKER_MESSAGES_SEEN_STATE|workforceRelayTo|takes_tasks_only|no_turn|answerTo|receiveProblem|receiveEntry|RECEIVE_ENTRY)\b/,
      },
      {
        id: "message-reply-to",
        check: "sweep",
        // Core's dispatcher keeps the word for its own fields, so only Workforce, Shift Manager and the pages.
        files: new RegExp(`^packages\\/(workforce|shift-manager)\\/.*\\.(ts|tsx|mts)$|${PUBLISHED.source}`),
        pattern: /\breplyTo\b/,
      },
    ],
  },

  // Workforce's words -------------------------------------------------------------------------
  {
    term: "User",
    means: "A person, signed in, always inside one org. Every action is taken by one user.",
    decision: "FIX-2151; Workforce BR-5",
    published: true,
    retires: [
      {
        id: "human-reasons",
        check: "sweep",
        files: CODE_PUBLISHED_OR_NOTES,
        // The suspension reasons say user. SuspensionReason's open `string & {}` arm compiles a missed one,
        // which then silently becomes a custom reason, so the exact strings are retired.
        pattern: /\bhuman_(approval|input)\b/,
      },
      { id: "person", check: "guard", ground: "workforce", re: /\bpersons?\b|\bperson's\b/gi, say: "user, where it means the signed-in user" },
    ],
  },
  {
    term: "Worker",
    means: "A configuration with an owner that names the flow it runs on and carries its own instructions, skills and tools. Never a seat.",
    decision: "Workforce vocabulary; FIX-2248",
    published: true,
    retires: [
      // "Seat" matches at the start of a word part, so `leaseAtClaim` and `closeAt` are not seats. It has no exemption.
      { id: "seat", check: "guard", re: /(?<![a-z])[Ss]eat|(?<=[a-z0-9])Seat|SEAT/g, say: "worker; on a task board, assignee" },
      { id: "owner-pin", check: "guard", ground: "workforce", re: /owner[ _-]?pins?/gi, say: "access to the worker" },
      { id: "flow-instance", check: "guard", ground: "workforce", re: /flow[ _-]?instances?/gi, say: "worker, where it means a worker" },
      {
        id: "seat-mailbox-goal-names",
        check: "sweep",
        files: CODE_PUBLISHED_OR_NOTES,
        pattern: new RegExp(`(?<![\\w-])(${SEAT_MAILBOX_GOAL_NAMES.join("|")})(?![\\w-])`),
        pathName: new RegExp(`(^|/)(${SEAT_MAILBOX_GOAL_NAMES.join("|")})/`),
      },
    ],
  },
  {
    term: "Assignee",
    means: "Who a task goes to: an entry in a task board's workers, or a name the board's assignee check accepts.",
    decision: "Workforce vocabulary",
    published: true,
    retires: [],
  },
  {
    term: "Worker flow",
    means: "The flow a worker runs on.",
    decision: "Workforce vocabulary (BR-10)",
    published: true,
    retires: [{ id: "kind", check: "guard", ground: "workforce", re: /kind/gi, say: "worker flow, where it means the flow a worker runs on" }],
  },
  { term: "Standard worker", means: "A worker every user has, read from the installation's files and the same for everyone.", decision: "Workforce vocabulary", published: true, retires: [] },
  { term: "Fork", means: "Copies a standard worker into a worker of your own, starting from its configuration.", decision: "Workforce vocabulary", published: true, retires: [] },
  {
    term: "Roster",
    means: "The workers one user has, standard ones included.",
    decision: "Workforce vocabulary",
    published: true,
    retires: [{ id: "hired-roster", check: "guard", re: /hired[ _-]?roster/gi, say: "roster" }],
  },
  {
    term: "Coordinator",
    means: "A worker that hands each message to its delegates as routed tasks. Never a mailbox.",
    decision: "Workforce vocabulary; FIX-2248 WR-7",
    published: true,
    retires: [
      { id: "mailbox", check: "guard", re: /mailbox/gi, say: "coordinator; a member is a delegate" },
      {
        id: "post-to-mailbox",
        check: "sweep",
        files: CODE_PUBLISHED_OR_NOTES,
        pattern: /post-to-mailbox|postToMailbox/,
      },
    ],
  },
  {
    term: "Delegate",
    means: "A worker a conversation may delegate to, and the only workers it can give work to.",
    decision: "Workforce vocabulary",
    published: true,
    retires: [
      {
        id: "member",
        check: "guard",
        ground: "workforce",
        re: /\b[Mm]embers?\b|\bMEMBERS?\b|[Mm]ember(?=[A-Z_])|(?<=[a-z])Members?\b/g,
        say: "delegate, where it means a mailbox member",
      },
      { id: "thread", check: "guard", ground: "workforce", re: /\bthreads?\b/gi, say: "the delegate's session, where it means a mailbox thread" },
    ],
  },
  { term: "Delegation", means: "Handing work to one of your delegates, checked against your roster.", decision: "Workforce vocabulary", published: true, retires: [] },
  {
    term: "Door",
    means: "`respond`, the one public action that takes a message to a worker, on every worker flow.",
    decision: "Workforce vocabulary; FIX-2246",
    published: true,
    retires: [
      {
        id: "worker-run-door",
        check: "sweep",
        files: /^(packages\/workforce\/(src\/.*\.ts|README\.md)|apps\/docs\/docs\/workforce\/.*\.mdx?)$/,
        // The worker contract requires respond.
        pattern: /\bactions: \{ ?run:|`run` \(public\)|wrapped turn for `run`/,
      },
      {
        id: "message-door",
        check: "sweep",
        files: CODE_OR_PUBLISHED,
        // The harness message door and the mark it kept are gone; harnessSessionDoor replaced it.
        pattern: /\b(parkedForTurn|messageDoor|harnessMessageDoor)\b/,
      },
    ],
  },
  { term: "Project", means: "A body of work, private to you or shared with your org.", decision: "Workforce vocabulary", published: true, retires: [] },
  { term: "Workstream", means: "One area of a shared project, with one owner.", decision: "Workforce vocabulary", published: true, retires: [] },
  {
    term: "Project coordinator",
    means: "Your coordinator for one project: one session per user per project. Never a room or a talk session.",
    decision: "Workforce vocabulary",
    published: true,
    retires: [
      {
        id: "room",
        check: "guard",
        // An English word too ("room to grow"): read in code and published pages only (FIX-2354 D1).
        reach: "meaning",
        re: /\b[Rr]ooms?\b|room-(?:lines|seq|answers|deliveries)|Room[A-Z]\w*|\broom[A-Z]\w*|\bROOM_\w*/g,
        say: "the project coordinator",
      },
      { id: "talk-session", check: "guard", re: /talk[ _-]?sessions?|talk-?template|talkFor\b|\bTALK_\w+/gi, say: "the project coordinator" },
    ],
  },
  {
    term: "Shift Coordinator",
    means: "The standard coordinator a user asks who works here, and asks to hire or fire (id `shift-coordinator`).",
    decision: "FIX-2244",
    published: true,
    retires: [
      {
        id: "shift-coordinator-names",
        check: "sweep",
        files: CODE_OR_PUBLISHED,
        pattern: /chief-of-staff|chiefOfStaff|ChiefOfStaff|CHIEF_OF_STAFF|chief_of_staff/,
        pathName: /chief-of-staff|ChiefOfStaff/,
      },
      {
        id: "shift-coordinator-cos",
        check: "sweep",
        files: CODE,
        // Shift Manager's `cos` route, test ids and names (`cos-panel`, `openCos`, `COS_FLOW`).
        // `Cost`, `COST`, `cosine` and `Math.cos` are other words. Kept matching COS_RULES in
        // scripts/codemod/rename-chief-of-staff.ts.
        pattern: /(?<!Math\.)\bcos(?=[A-Z0-9_]|\b)|[a-z0-9]Cos(?=[A-Z_]|\b)|\bCOS(?=_|\b)|(?<=_)COS\b/,
        pathName: /(^|[/-])cos([-./]|$)/,
      },
      {
        id: "shift-coordinator-prose",
        check: "sweep",
        files: CODE_OR_PUBLISHED,
        pattern: /\b[Cc]hiefs? [Oo]f [Ss]taff\b|\bCoS\b/,
      },
    ],
  },

  // Execution tiers ---------------------------------------------------------------------------
  {
    term: "Side chain",
    means: "Work that runs alongside the turn (`sideChain`, `side-chain`). `background` is the umbrella over all three tiers.",
    decision: "FIX-766",
    retires: [
      {
        id: "side-chain-names",
        check: "side-chain",
        // Refused in any position. A closed list: a name is here when it named the tier AND lived in framework source.
        names: [
          // The three DSL verbs distinctive enough to ban in any position.
          "workIf",
          "waitForWork",
          "forEachBackground",
          // The request-scoped pool: published `core` and `engine` surface.
          "RequestWorkPool",
          "RequestWorkPoolResult",
          "RequestWorkPoolDrainOptions",
          "RequestWorkPoolDrainAllOptions",
          "RequestWorkPoolDrainToQuiescenceOptions",
          "RequestWorkPoolImpl",
          "RequestWorkTaskMeta",
          "getRequestWorkPool",
          "createRequestWorkPool",
          "drainRequestWorkPool",
          "_requestWorkPool",
          "requestWorkPool",
          // The tier-2 abort signal: a top-level `core` export.
          "composeBackgroundSignal",
          "_requestBackgroundSignal",
          "withBackgroundSignal",
          // The test harness: published `testing` surface.
          "WorkTrace",
          // The flow-level config the rename deleted, listed so it cannot return under its old name.
          "WorkConfig",
          // Internal types that named the tier.
          "SequencerWorkTask",
          "WaitForWorkOptions",
          "BackgroundCallShape",
          "WorkOptions",
          "WorkResult",
          "RunBackgroundResult",
          // Internal helpers and constants that named the tier.
          "dispatchWorkTask",
          "buildWorkTraces",
          "runBackground",
          "backgroundTaskCtx",
          "backgroundSignalOverride",
          "backgroundController",
          "DEFAULT_BACKGROUND_CONCURRENCY",
          // DevTool.
          "BackgroundBadge",
        ],
      },
      // The DSL verb, refused only where it is called or declared as a method: `{ work: string }` is a word.
      { id: "side-chain-verb", check: "side-chain", position: "called", names: ["work"] },
      // Contract fields, refused only where a contract package declares them.
      { id: "side-chain-contract-fields", check: "side-chain", position: "contract-field", names: ["workGroupId", "backgroundTasks", "workResults"] },
      // Op literals that become block-path segments or default block names, which key the replay log.
      { id: "side-chain-path-ops", check: "side-chain", position: "path-op", names: ["work", "workIf", "forEachBackground"] },
      // The tier as a string-literal union member or value (`phase: "work"`, `FlowErrorScope`).
      { id: "side-chain-tier-value", check: "side-chain", position: "tier-value", names: ["work"] },
    ],
  },

  // Routines ----------------------------------------------------------------------------------
  {
    term: "Routine",
    means: "A standing instruction that fires on its own as its owner, with exactly one trigger: a clock (recurring work) or an event (a subscription, pushed or polled).",
    decision: "Owner, 2026-11-08; FIX-2471 D12; FIX-2614",
    // FIX-2614 renamed the shipped surface: the four routine verbs and the routines capability replace the schedule
    // actions and the subscription tools, with no aliases. "Schedule" and "subscription" stay, as the words
    // for a clock trigger's stored resource and an event trigger's.
    retires: [
      { name: "subscriptionTools" },
      { name: "SUBSCRIPTION_TOOLS" },
      { name: "saveSchedule" },
      { name: "listSchedules" },
      { name: "deleteSchedule" },
      { name: "LIST_SCHEDULES_ACTION" },
      { name: "listedScheduleSchema" },
      { name: "ListedSchedule" },
      { name: "ScheduledWorkOptions" },
      {
        id: "recurring-work-prose",
        check: "sweep",
        reach: "meaning",
        files: CODE_OR_PUBLISHED,
        // The user-facing names a routine replaces: "recurring work" for a clock routine, and the
        // "Scheduled work" screen that listed only those.
        pattern: /\brecurring work\b|\bscheduled work\b/i,
      },
    ],
  },
];

// ---------------------------------------------------------------------------------------------
// 2. The exemptions
// ---------------------------------------------------------------------------------------------

/** A person who isn't the signed-in user stays (BR-5), pinned by file and phrase. */
export const PERSON_PINS = [
  // A support desk's example worker: a human on the support team, not the customer writing in.
  { path: "apps/docs/docs/workforce/coordinators.md", phrase: /\bhow to reach a person\b/g },
  // A triage worker's example: it escalates to a human, not back to the user who asked.
  { path: "apps/docs/docs/workforce/overview.md", phrase: /\bor to a person\b/g },
  { path: "apps/docs/docs/workforce/workers-on-disk.md", phrase: /\bhands off to a person\b/g },
];

/** The projects surface, where "member" is a project's: its modules, their tests, the Projects page and figure. */
const PROJECT_MODULES = /^packages\/workforce\/src\/projects\/|^packages\/workforce\/test\/(?:projects?|workstreams?)[\w-]*\.test\.ts$|^apps\/docs\/docs\/workforce\/(?:projects\.md|project-overview\.svg)$/;

/**
 * Every place a retired word is kept on purpose. Each names the retirements it keeps and why.
 *
 * The shape follows the check that matches those retirements:
 *
 * - **sweep** (`rules`): a hit is kept when its file matches `path` and, if given, its line matches `line`.
 * - **guard** (`id`, `terms`): `strip` removes the token, never the line, so a second retired word on the
 *   line still counts. `where` narrows it to the files it covers. One that strips nothing fails the run.
 *   They apply in order.
 * - **side-chain** (`rules`, `files`): the tests whose subject is the retired spelling, closed by assertion.
 * - **tree** (`rules`, `id`): a `path` keeps a file's `…Row` names (a store adapter, a UI list); the
 *   quote rule strips a released message's text (`quotes`) on the `pages` it names, never the line.
 */
const EXEMPTIONS = [
  // ---- sweep ----
  {
    path: /^packages\/harness-manager\/README\.md$/,
    line: /^### Upgrading from `messageDoor`$|^Before `harnessSessionDoor`, a manager's `messageDoor` \(and `harnessMessageDoor`\) kept/,
    rules: ["message-door"],
    why: "FIX-2246: the README's upgrade note, which says the door is gone and how its kept lines become steers; a page can't carry the marker",
  },
  {
    path: /^packages\/workforce\/src\/subscriptions\/github\/normalize\.ts$/,
    line: /^const (PR|ISSUE)_ACTIONS = new Set\(\[/,
    rules: ["reopened-shape"],
    why: "FIX-2535: GitHub's own `reopened` webhook action, which normalize matches by name; not the task entry's reopened shape",
  },
  {
    path: /^packages\/workforce\/src\/subscriptions\/github\/poll\.ts$/,
    line: /^const TIMELINE_ACTIONS = new Set\(\[/,
    rules: ["reopened-shape"],
    why: "FIX-2536: GitHub's own `reopened` timeline event, which the poll rebuilds by name; not a task's reopened shape",
  },
  {
    path: /^packages\/orchestration\/README\.md$/,
    line: /^`reopened: true` reads unmarked; while it is still open/,
    rules: ["reopened-shape"],
    why: "FIX-2246: the README's upgrade note for the reopened shape the read boundary still maps; a page can't carry the marker",
  },
  {
    path: /^goals\//,
    line: /^\| \d{4}-\d{2}-\d{2} \|/,
    rules: ["human-reasons"],
    why: "FIX-2151: a goal's dated verdict row records a past run under the reasons it ran with: history",
  },
  {
    path: /^labs\/teammates\/(?:src|test)\/|^labs\/teammates\/workforce\/teams\/teammates\/workers\/chief-of-staff\/WORKER\.md$/,
    line: /\bteammates\.chief-of-staff\b|^\(file path\)$/,
    rules: ["shift-coordinator-names"],
    why: "FIX-2354: the Teammates lab's Lead keeps its stored worker id `teammates.chief-of-staff` (its folder and roster key): stored worker id — renaming strands persisted conversations (BP-030). The name a person reads is Lead",
  },
  {
    path: /^\.changeset\/fix-2614-routines\.md$/,
    rules: ["subscriptionTools", "saveSchedule", "listSchedules", "deleteSchedule", "LIST_SCHEDULES_ACTION", "listedScheduleSchema"],
    why: "FIX-2614: the release note that tells consumers what each retired schedule and subscription name became",
  },
  {
    // User docs change only at release (docs/contributing/release-docs.md), so these pages document the
    // released names until then. As FIX-2479 D4's released-quotes: /release-docs rewrites them from the
    // changeset's Docs: line, and deletes this in the same PR.
    path: /^(?:apps\/docs\/docs\/workforce\/delegating-work\.md|apps\/docs\/docs\/shift-manager\/overview\.md|packages\/workforce\/README\.md|packages\/shift-manager\/README\.md)$/,
    rules: ["subscriptionTools", "saveSchedule", "listSchedules", "deleteSchedule", "recurring-work-prose"],
    why: "FIX-2614: published pages may name the released schedule and subscription surface until /release-docs rewrites them, and deletes this in the same PR",
  },
  {
    path: /^\.changeset\/user-suspension-reasons\.md$/,
    rules: ["human-reasons"],
    why: "FIX-2151: the release note that tells consumers which old reasons to replace",
  },
  {
    path: /^\.changeset\/(retired-names-(contracts|react)|no-compat-engine)\.md$/,
    rules: ["human-reasons"],
    why: "FIX-2454: the release notes that say a new human_* reason throws and a stored one reads as a user's",
  },
  {
    path: /^packages\/(engine|react)\/test\/retired-suspension-reasons\.test\.tsx?$/,
    rules: ["human-reasons"],
    why: "FIX-2454: the tests that a stored human_* stop reads as a user's and a new one throws: they name the old reasons to probe them",
  },
  {
    path: /^goals\//,
    line: /^\| \d{4}-\d{2}-\d{2} \|/,
    rules: ["seat-mailbox-goal-names"],
    why: "a goal's verdict log: a dated run keeps the goal names it ran under",
  },
  {
    path: /^goals\/(README\.md|coordinators\/every-coordinator-is-a-worker-file\/(goal\.md|run\.mts))$/,
    // Exact retired goals only: a live goal cited under an old name on these files stays open.
    line: /(mailbox-boards\/it-hands-a-task-to-a-fresh-hire|workforce-seats\/two-seats-run-their-own-configuration|workforce-mailboxes\/a-pre-rename-lab-is-refused-by-name)\b/,
    rules: ["seat-mailbox-goal-names"],
    why: "a goal retired before FIX-2248, named under the folder it lived in",
  },
  {
    path: /^packages\/engine\/src\/stores\/testing\/request-store-conformance\.ts$/,
    line: /const requestId = "req_fence_(legacy_)?handed_off";$/,
    rules: ["handoff-symbol"],
    why: "a same-owner hand-off of a running request: work already under way changing hands",
  },
  {
    path: /^goals\//,
    line: /^\| \d{4}-\d{2}-\d{2} \||no longer posts its answer with a `post-to-mailbox` tool|`post-to-mailbox`, which went with mailboxes/,
    rules: ["post-to-mailbox"],
    why: "WR-7: a goal's dated verdict row, or a line saying the tool was removed: history",
  },
  {
    path: /^apps\/docs\/docs\/(shift-manager\/|glossary\.md$|glossary\/)/,
    line: /Shift Manager|AskCard|Inbox|approval|question|suspended|\bAsks?\b \|/i,
    rules: ["ask-prose", "ask-symbol", "ask-symbol-in-docs", "ask-mark"],
    why: "Shift Manager's Ask: an approval or question to a person",
  },
  {
    path: /^apps\/docs\/docs\/workforce\/shift-coordinator\.md$/,
    // The approval ask's own lines, and only those: any other ask word on the page stays open.
    line: /^(?!.*\bparkOnAsk\b).*(as `askFire` does|wrap it with an ask|The ask outlives a restart|the ask above refuses)/,
    rules: ["ask-prose", "ask-symbol", "ask-symbol-in-docs", "ask-mark"],
    why: "the Shift Coordinator's approval ask: a question to a person",
  },
  {
    path: /^apps\/docs\/docs\/workforce\/shift-coordinator\.md$/,
    // FIX-1872's exact sentence, and only on a line naming `handOff` once: a stale mention beside it stays open.
    line: /^(?!.*`handOff`.*`handOff`).*A file that still names `handOff` is refused\b/,
    rules: ["handoff-symbol-in-docs", "handoff-prose"],
    why: "WR-25b: FIX-1872's sentence that a worker file still naming handOff is refused; a page can't carry the marker",
  },
  {
    path: /^(packages\/shift-manager\/|apps\/docs\/docs\/shift-manager\/)/,
    rules: ["ask-prose", "ask-symbol", "ask-symbol-in-docs", "ask-mark"],
    why: "Shift Manager's Ask and Inbox: a suspended run waiting on a person",
  },
  {
    path: /^packages\/orchestration\/(src\/inbox\/|test\/inbox(-truth-control)?\.test\.ts$)/,
    rules: ["ask-prose", "ask-symbol", "ask-symbol-in-docs", "ask-mark"],
    why: "the Inbox read (FIX-2133): a question's `ask`, what it asks the user, as its `TaskHold` names it",
  },
  {
    path: /^packages\/orchestration\/(src\/tasks\/(schema\/hold|collection\/holds)\.ts|test\/(collection\/(questions|waiting-on-user)|skills\/questions-tools)\.test\.ts)$/,
    rules: ["ask-prose", "ask-symbol", "ask-symbol-in-docs", "ask-mark"],
    why: "a task's questions (FIX-2133): a question's `ask`, a question to the user, and the collection's `ask` that opens one midway, as its `TaskHold` names them",
  },
  {
    path: /^(packages\/orchestration\/(src|test)\/|packages\/integration-tests\/src\/scenarios\/|packages\/workforce\/src\/conversation-board\/board\.ts$|apps\/docs\/docs\/orchestration\/task-board\.md$)/,
    // The question's names only: a question to the user, opened at filing or midway. Any other ask word on these lines' files stays open.
    line: /\b(askMidway|MidwayAsk|AskDeclineReason|QuestionInit|askProblem|assertAskable|askOf|askOptions)\b|\b(hold|ledger|board|collection|ref)\??\.ask\b|TaskCollectionRef(\["ask"\]|\.ask\b)|^\s*ask: (\{|z\.)|\{ ask: \{|\.ask\.(kind|prompt)\b/,
    rules: ["ask-symbol", "ask-symbol-in-docs", "ask-mark"],
    why: "a task's questions (FIX-2133): a question's `ask` and the midway ask that opens one, a question to the user",
  },
  {
    path: /^(packages\/(orchestration|workforce)\/(src|test)\/|apps\/docs\/(docs|guides)\/|packages\/(orchestration|workforce)\/README\.md$)/,
    // The worker's question tool and the one-wait-per-turn rule's names only: a question to the user.
    line: /\b(turnAsked|askMidway)\b|\.ask(\.(kind|prompt)\b|\)\.toMatchObject)/,
    rules: ["ask-symbol", "ask-symbol-in-docs", "ask-mark"],
    why: "FIX-2131: the worker's question, which holds its task for the user, and the turn-asked fact it is refused on",
  },
  {
    path: /^packages\/devtool\/(src\/react\/lib\/task-collection-state\.ts|test\/(task-collections-reason\.test\.tsx|task-collection-state\.test\.ts))$/,
    // The DevTool's wire mirror of a question's `ask` only, and the reason slot reading its prompt.
    line: /^\s*ask: \{ kind: string|\bask: \{ kind: "(question|review)"|\)\?\.ask\.prompt;$/,
    rules: ["ask-mark"],
    why: "FIX-2131: the DevTool's mirror of a task's questions (FIX-2133's `TaskHold`), whose `ask` is what the user was asked",
  },
  {
    path: /^packages\/harness-manager\//,
    line: /question|marker|inbox/i,
    rules: ["ask-prose", "ask-symbol", "ask-symbol-in-docs", "ask-mark"],
    why: "the harness question inbox: a coding run asking a person",
  },
  {
    path: /^packages\//,
    line: /\babortHandoff\b/,
    rules: ["handoff-symbol", "handoff-prose"],
    why: "WR-5: the engine's abort of a request record handed to its holder; not a delivery of work",
  },
  {
    path: /^packages\/engine\/(src\/(context\/(request-principal|createExecutionContext)|execution\/(runAction|types)|stores\/(types|testing\/request-store-conformance)|transports\/host\/createInboundTransportHost)\.ts|test\/(abort|request-incarnation)\.test\.ts)$/,
    // Each phrase and name the request-record and abort-controller code uses, so a new
    // "hand off" line in these files stays open until someone classifies it.
    line: /same-owner hand-off|last-write-wins hand-off|hand-off writes the holder's value|since the hand-off also replaces|\b(keepHandoff|handoffIncarnation)\b|\bhandoff( !==| ===| =$|\.controller|\.incarnation)|^\s*(const|let) handoff =|lost in the handoff|exercise the handoff|handed-off legacy record|makes the handoff atomic|incarnation \(a hand-off$|the same hand-off the enqueue-time record|the hand-off to a run|queued[-_]abort[-_]handoff|\b[sr]e?q?_queued_handoff\b|The hand-off really did rewrite|"handed off"|for a handed-off$|hand-off never rewrites|loses the race and hands off|the handed-off record|The hand-off overwrites|through the hand-off"/,
    rules: ["handoff-symbol", "handoff-prose"],
    why: "WR-5: a claimed request record, or its abort controller, passed to the run that holds it: mid-work (D3)",
  },
  {
    path: /^(packages\/engine\/(src\/transports\/(concurrency\/arbiter|host\/createInboundTransportHost)\.ts|test\/transports\/concurrency\/lease-backend\.test\.ts)|docs\/architecture\/inbound-transports\.md)$/,
    line: /ConcurrencyAdmission\.handOff|\bhandOff\(|handOff: |\batHandOff\b|^\s*\* handed off\.$|place rides|it is handed off$|cross-call handoff/,
    rules: ["handoff-symbol", "handoff-symbol-in-docs", "handoff-prose"],
    why: "D3: a queue place passed to the job that holds it once enqueued, mid-work",
  },
  {
    path: /^packages\/engine\/src\/utils\/keyed-async-gate\.ts$/,
    rules: ["handoff-prose"],
    why: "D3: a lock passed straight to the next waiter, mid-work",
  },
  {
    path: /^(packages\/shift-manager\/(src\/(gaps\.ts|surfaces\/TaskFrame\.tsx)|test\/task-screen\.test\.tsx|README\.md)|apps\/docs\/docs\/shift-manager\/overview\.md)$/,
    line: /\bhandOff\b|"Hand off"|^\| Hand off, reassign|^- On a task: Hand off, reassign/,
    rules: ["handoff-symbol", "handoff-prose"],
    why: "D3: the task screen's Hand off action, which moves a task already being worked to another worker",
  },
  {
    path: /^docs\/architecture\/state-and-scopes\.md$/,
    line: /same-owner hand-off/,
    rules: ["handoff-prose"],
    why: "WR-5: a claimed request record passed to the run that holds it, mid-work (D3)",
  },
  {
    path: /^apps\/docs\/docs\/glossary\.md$/,
    line: /^\| \*\*Hand-off\*\* \| orchestration \| A session that was doing the work passes it to another session, mid-work\./,
    rules: ["handoff-prose"],
    why: "D3: the glossary row that defines hand-off as mid-work only",
  },
  {
    path: /^apps\/docs\/docs\/workforce\/workers-on-disk\.md$/,
    line: /`escalate` hands off to a person\./,
    rules: ["handoff-prose"],
    why: "D3: a triage worker escalating a request it is already handling to a person, mid-work",
  },
  {
    path: /^apps\/docs\/docs\/orchestration\/task-board\.md$/,
    line: /^<a id="assignees-that-hand-off"><\/a>$/,
    rules: ["handoff-prose"],
    why: "WR-18: the renamed section keeps its old anchor, so an old link still lands on it",
  },
  {
    path: /^(packages\/workforce\/README\.md|apps\/docs\/docs\/workforce\/coordinators\.md)$/,
    // FIX-1872's sentences, on a line naming `handOff` once: a stale mention beside them stays open.
    line: /^(?!.*`handOff`.*`handOff`).*(named the (coordinator's )?dispatch tool `handOff`|names `handOff` is refused)/,
    rules: ["handoff-symbol-in-docs", "handoff-prose"],
    why: "WR-25b: FIX-1872's sentences that the tool was named handOff and a worker file naming it is refused; a page can't carry the marker",
  },
  {
    path: /^(packages|apps|labs|examples|docs\/architecture|\.agents)\//,
    // A capitalized English verb ("Ask the team anything.", "Asked of the host here", "Self-Ask"),
    // on a line naming no identifier built on ask: the symbol rules' pattern can't tell them apart.
    line: /^(?!.*\b\w+Ask)(?!.*\bask[A-Z])(?!.*\bASK_)(?!.*\bAsk[A-Z]).*\b(Ask|Asks|Asked|Asking)\b/,
    rules: ["ask-symbol", "ask-symbol-in-docs"],
    why: "WR-5: the English verb, not a name; the line names no identifier built on ask",
  },
  {
    path: /^packages\/harness-manager\//,
    rules: ["ask-prose", "ask-symbol", "ask-symbol-in-docs", "ask-mark"],
    why: "WR-3: the harness question inbox, where a coding run's ask is a question to a person",
  },
  {
    path: /^apps\/kitchen-sink\/(flows\/chat-agent\/|e2e\/smoke-ask\.spec\.ts$)|^packages\/integration-tests\/src\/scenarios\/chat-ask\.test\.ts$/,
    rules: ["ask-symbol", "ask-mark"],
    why: "WR-3: the kitchen sink's Ask mode and its clarifying question: a question to the person chatting",
  },
  {
    path: /^apps\/kitchen-sink\/(lib\/workforce-shell\.ts|components\/picked-session-panel\.tsx|test\/workforce-shell\.test\.ts)$/,
    line: /COORDINATOR_ASK|WORKER_ASKS|[Ww]orkerAsk/,
    rules: ["ask-symbol"],
    why: "WR-5: the kitchen sink shell's message box, where the person asks a worker; nothing waits on a task",
  },
  {
    path: /^packages\/cli\/src\//,
    rules: ["ask-symbol", "ask-prose"],
    why: "WR-5: the CLI asks the app who an in-process caller is; not a wait",
  },
  {
    path: /(^|\/)cascading-router(\.test|\.test-d)?\.ts$/,
    rules: ["ask-symbol", "ask-mark"],
    why: "WR-5: a cascading router level's `ask`, the evaluator it asks a question of",
  },
  {
    path: /^(packages\/core\/test\/flow-config\.test\.ts|packages\/engine\/test\/(faceted-collection|flow-instance-ownership|request-action-result|suspension-resume)\.test\.ts|packages\/integration-tests\/src\/scenarios\/request-action-result\.test\.ts|packages\/workforce\/test\/(split-resource-modules|worker-door)\.test\.ts|docs\/architecture\/action-forms\.md)$/,
    line: /\bask\??:\s*\{|askSeq/,
    rules: ["ask-mark", "ask-symbol"],
    why: "WR-5: a test flow's action named ask, a chat or approval turn a person starts; not a wait",
  },
  {
    path: /^packages\/engine\/test\/context\/request-host-e2e\.test\.ts$/,
    line: /\bask\??:\s*z\./,
    rules: ["ask-mark"],
    why: "WR-5: the ids a liveness probe asks about",
  },
  {
    path: /^packages\/orchestration\/test\/skills\/skill-activator-evaluator\.test\.ts$/,
    line: /\b[st]\.ask\(/,
    rules: ["ask-mark"],
    why: "WR-5: the test's helper that asks the skill evaluator a question",
  },
  {
    path: /^packages\/orchestration\/test\/(task-board\/task-board-park-exit-drain|collection\/answer-reentry)\.test\.ts$/,
    rules: ["ask-symbol"],
    why: "WR-3: a task parked on its worker's question to a person",
  },
  {
    path: /^packages\/workforce\/(src\/coordinator\/(coordinator-flow|coordinator-keys)\.ts|test\/(worker-discovery|project-workspace-workstream|project-workspace-task)\.test\.ts)$/,
    line: /COORDINATOR_ROUTE_ASK|routeAsked|askRoute|askDoor|askThroughHiredWorker|askSource|\bAsked\b/,
    rules: ["ask-symbol"],
    why: "WR-5: asking a model to route, or asking a door or a source a question; not a wait",
  },
  {
    path: /^packages\/integration-tests\/src\/two-users-one-tenant\/non-streaming-text\.test\.ts$/,
    line: /askStreamed|askGenerated/,
    rules: ["ask-symbol"],
    why: "WR-5: two actions that ask a desk a question; not a wait",
  },
  {
    path: /^packages\/workspace\/src\/(local-host|land)\.ts$/,
    line: /core\.askPass/,
    rules: ["ask-symbol"],
    why: "git's own setting name",
  },
  {
    path: /^packages\/ui\/test\/render\/status-tokens\.test\.tsx$/,
    line: /never as an ask/,
    rules: ["ask-prose"],
    why: "WR-3: a person's approval or question, which a blocked task's notes are not drawn as",
  },
  {
    path: /^packages\/((core|engine)\/(src\/execution\/request-side-chain-pool\.ts|test\/request-side-chain-pool\.test\.ts)|tools\/test\/bash-moat-purge\.test\.ts)$/,
    line: /\baddTask\b/,
    rules: ["task-tool-names"],
    why: "FIX-2243: the engine's side-chain pool's addTask (or a test's stand-in pool) adds a promise to a request's pool, not a task to a collection",
  },
  {
    path: /^packages\/core\/src\/blocks\/sequencer\.ts$/,
    line: /\bpool\.addTask\(/,
    rules: ["task-tool-names"],
    why: "FIX-2243: a side chain's promise added to the request's side-chain pool, not a task",
  },
  {
    path: /^packages\/orchestration\/src\/skills\/task-tools-capability\.ts$/,
    line: /\banswerQuestion\(/,
    rules: ["task-tool-names"],
    why: "FIX-2243: updateTask's live helper that answers a task's open question; the harness manager's removed answerQuestion() was another thing",
  },
  {
    path: /^(packages\/(workforce|cli)\/README\.md|apps\/docs\/docs\/workforce\/documents-on-disk\.md)$/,
    line: /\banswerQuestion\b/,
    rules: ["task-tool-names"],
    why: "FIX-2243: an example app's own block or action that answers a person's question, not a task tool",
  },

  // ---- sweep, in the contributor trees and the labs (FIX-2354) ----
  {
    path: /^labs\//,
    line: /\.ask\.(kind|prompt)\b|^\s*ask: \{|\bask: \{ kin/,
    rules: ["ask-mark"],
    why: "FIX-2354: a lab reading a task hold's `ask`, what it asks the user, as orchestration's `TaskHold` names it",
  },
  {
    path: /^labs\//,
    line: /\bASK_MARKER_IGNORED\b/,
    rules: ["ask-symbol"],
    why: "FIX-2354: a lab importing harness-manager's live ASK_MARKER_IGNORED, kept there by the harness question inbox's own exemption",
  },
  {
    path: CONTRIBUTOR,
    line: /\bAskUserQuestion\b/,
    rules: ["ask-symbol", "ask-symbol-in-docs"],
    why: "FIX-2354: Claude Code's AskUserQuestion tool, a question to a person, named as the harness spells it",
  },
  {
    path: /^\.agents\//,
    line: /\bopenQuestions\b/,
    rules: ["question-hold-names"],
    why: "FIX-2354: the epic-wake schema's openQuestions field, an epic's questions for its owner: a workflow field, not a task's hold",
  },
  {
    path: /^\.agents\/skills\/reuse-review\/SKILL\.md$/,
    line: /`waitingOn: "user"` \+ `waitingFor`/,
    rules: ["hold-names"],
    why: "FIX-2354: the skill's worked example names the row fields two old specs added, to show the duplication it catches",
  },
  {
    path: /^\.changeset\/no-compat-[\w-]+\.md$/,
    rules: ["question-hold-names", "task-tool-names", "handoff-symbol-in-docs", "message-budget"],
    why: "FIX-2454: the release notes that list what was removed, by its old name, so a consumer can find the uses to delete",
  },

  // ---- guard ("Seat" has no exemption at all, a task board's included) ----
  {
    id: "agent-mailbox-board",
    terms: ["mailbox"],
    // Only the files that name the board, so a stale Workforce mailbox anywhere else still counts.
    where: (path) => AGENT_MAILBOX_FILES.test(path),
    strip: /mailbox/gi,
    why: "FIX-2354: the fixpoint-labs/agent-mailbox board, where agents outside a session talk: a different thing with that name, not Workforce's coordinator",
  },
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
    strip: /\b(?:inherited|prototype|required|union) member\b|\bany member of a union\b|\bObject\.prototype member\b|\bno exported member\b/g,
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
    // FIX-2614: an event routine is a subscription, so the routine modules, tests and screen name its thread too.
    where: (path) =>
      /^packages\/workforce\/(?:src\/subscriptions\/|src\/routines\/|test\/subscriptions-|test\/routines\.test\.ts$)|^packages\/shift-manager\/(?:src\/lib\/routines\.ts|src\/surfaces\/Routines\.tsx|test\/routines-view\.test\.tsx)$/.test(path),
    strip: /\bthreads?\b|\bThreads?(?=[A-Z_]|\b)|(?<=[a-z])Threads?\b|\bmembers?\b|\bMEMBER\b|\bkinds?\b|(?<=\b|_)KINDS\b|(?<=[a-z])Kinds?\b/g,
    why: "an outside service's thread (a PR, an issue, a repository), a sender's `member` role there (GitHub's `MEMBER` association), and an event's kind: FIX-2471's signed subscription vocabulary, not a mailbox's thread or member, nor a worker flow",
  },
  {
    id: "subscription-docs",
    terms: ["thread", "member", "kind"],
    where: (path) => path === "packages/workforce/README.md" || path === "apps/docs/docs/workforce/messaging-workers.md" || path === ".changeset/fix-2614-routines.md",
    // Only on a line that names the outside service, so a mailbox's thread elsewhere on the page still counts.
    strip: /\bSCREEN_KINDS\b|(?:\bthreads?\b|\b[Mm]embers?\b|\bkinds?\b)(?=[^\n]*(?:subscri|provider|\bPR\b|pull request|repositor|outside|`thread`|canRead|github))|(?<=(?:subscri|provider|\bPR\b|pull request|repositor|outside|canRead|github)[^\n]*)(?:\bthreads?\b|\b[Mm]embers?\b|\bkinds?\b)/g,
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
    id: "registry-copies",
    terms: ["kind", "person"],
    where: (path) => /^packages\/shift-manager\/src\/components\/flow-state\//.test(path),
    strip: /\bkinds?\b|\bpersons?\b|\bperson's\b/gi,
    why: "an installed copy of a ui registry component, held byte-equal to its source in packages/ui (outside Workforce) by Shift Manager's static test: its words are the registry's",
  },
  {
    id: "person-any-human",
    terms: ["person"],
    where: (path) => PERSON_PINS.some((pin) => pin.path === path),
    strip: (path, line) => PERSON_PINS.filter((pin) => pin.path === path).reduce((out, pin) => out.replace(pin.phrase, " "), line),
    why: "a person who isn't the signed-in user stays, pinned by file and phrase (BR-5)",
  },

  // ---- side-chain ----
  {
    rules: ["side-chain-names", "side-chain-verb", "side-chain-contract-fields", "side-chain-path-ops", "side-chain-tier-value"],
    // Each proves behaviour ACROSS the rename boundary: a closed category that grows only with a new persisted surface.
    files: [
      // A pre-rename `phase: "work"` record fed through the one reader there is: it degrades rather than breaks.
      "packages/devtool/test/legacy-phase-record.test.ts",
      // A durable log rewritten to the pre-rename path segment: the completed child re-executes, the accepted cost.
      "packages/engine/test/side-chain-rename-continuation.test.ts",
    ],
    why: "FIX-766: the two rename-boundary tests, whose subject is the retired spelling",
  },

  // ---- tree ----
  // The resource entry keeps only these (FIX-2479). Its goal fails on any other: never widen one to reach zero.
  {
    id: "store-adapter-rows",
    rules: ["collection-row"],
    // The store adapters, the engine's own stores, and the versioned-row helper they share (`VersionedRow`).
    path: /^packages\/(?:store-[^/]+|engine\/src\/stores)\/|^packages\/contracts\/src\/helpers\/write-version\.ts$/,
    why: "a store adapter: a row is its word for what it stores (owner, 2026-11-06)",
  },
  {
    id: "ui-list-rows",
    rules: ["collection-row"],
    path: /(?:^|\/)(?:components|surfaces)\//,
    why: "a UI list module under components/ or surfaces/: a rendered row is a row (owner, 2026-11-06; FIX-2479, a path rule)",
  },
  {
    id: "released-quotes",
    rules: ["collection-row"],
    pages: /^(?:apps\/docs\/(?:docs|guides)\/.*\.mdx?|packages\/[^/]+\/README\.md)$/,
    // The owner-private refusal, the owner-writes refusal, and the first line of the startup overlap error.
    quotes: [
      /A row of an owner-private collection is readable only by the user it belongs to\./g,
      /A row of an owner-writes collection is written only by the user it belongs to\./g,
      /Collection pattern "[^"]*" can reach the rows of owner-(?:private|writes) collection/g,
    ],
    why: "FIX-2479 D4: a published page may quote a released message until /release-docs rewrites it, and deletes this in the same PR",
  },
];

// ---------------------------------------------------------------------------------------------
// 3. Where the checks read
// ---------------------------------------------------------------------------------------------
//
// The sweep lists every tracked file and scans it or excludes it by an EXCLUDE rule.
// The guard puts every tracked file in exactly one area of AREAS and scans the in-scope ones.
// Both read CONTRIBUTOR for names. Widen what the checks read here, in both.

/** History: dated records the checks never rewrite. Both checks keep it out by this one rule. */
const HISTORY = /^specs\/|^spec\/|^spec-poc|^docs\/internal\/|(^|\/)CHANGELOG\.md$|^apps\/docs\/blog\/|^docs\/atlas\/|^docs\/superpowers\/|^pnpm-lock\.yaml$/;

/** A worked example a skill keeps for its shape, and says so in its header: history, not instruction. */
const KEPT_EXAMPLES = /^\.agents\/skills\/concept-doc\/example\//;

/**
 * Tooling the checks can't read as prose: scripts, CI and hook config, other harnesses' settings
 * (`.claude/skills` and `.claude/workflows` are symlinks to `.agents/`, read there), the plugin.
 */
const TOOLING = /^scripts\/|^\.github\/|^\.husky\/|^\.omp\/|^\.claude\/|^\.cursor\/|^plugins\//;

/** Tracked files the sweep deliberately does not read, each with its reason. */
export const EXCLUDE = [
  { path: /^docs\/contributing\/glossary\.mjs$/, over: true, why: "the glossary: it names every retired word on purpose" },
  { path: HISTORY, over: true, why: "history: specs, internal notes, changelogs, blog posts, the lockfile" },
  { path: KEPT_EXAMPLES, over: true, why: "a skill's worked example, kept for its shape: history" },
  { path: TOOLING, over: true, why: "tooling: scripts, CI and hook config, other harnesses' settings, the plugin" },
  {
    path: /^goals\/hand-offs\//,
    over: true, why: "the FIX-1816 and FIX-1820 regression checks: ER-11 allows names only, and the closure renames them by map"
  },
  { path: /^goals\/coordinators\/(task-session-stays-open|hands-each-post-to-its-delegates|files-tasks-down-the-owners-chain)\//, over: true, why: "epic regression and coordinator checks: renamed only by the closure's map (ER-11)" },
  { path: /^goals\/vocabulary\/one-word-per-thing\//, over: true, why: "this sweep: it plants retired words on purpose" },
  { path: /^goals\/workforce-coordinators\/a-routed-post-gets-one-answer\//, over: true, why: "epic coordinator check: renamed only by the closure's map (ER-11)" },
  {
    path: /\.(png|jpe?g|gif|webp|ico|woff2?|ttf|otf|json|jsonl|jq|ya?ml|lock|css|scss|html|txt|toml|sh|py|sql|snap|map|gitignore|npmignore|env|example|d\.ts\.map)$|(^|\/)\.[^/]+$|(^|\/)(LICENSE|Dockerfile)$/,
    why: "no prose or symbols in scope (data, assets, config)"
  },
  { path: /^(apps|packages|labs|examples)\/.*\.(md|mdx|svg)$/, why: "markdown outside the published docs and package READMEs (fixtures, worker files, app notes)" },
  { path: /^goals\/.*$/, why: "other goal files: only the rules that read goals read them" },
  { path: /(^|\/)LICENSE\.upstream$|^docs\/contributing\/figures\/.*\.svg$|^docs\/(assets\/|PROMPT_CACHING\.md$)|^(CODE_OF_CONDUCT|SECURITY|compound-engineering\.local)\.md$|^[^/]+\.(json|ya?ml|mjs)$/, why: "root config, assets and pages no rule reads" },
];

/** The guard's own test plants retired words on purpose, so it is process tooling. */
const GUARD_TEST = "packages/core/test/retired-terms-check.test.ts";

/** The guard's areas. First match wins. `scope: true` is read; `false` keeps its words by design. */
export const AREAS = [
  { id: "history", scope: false, re: new RegExp(`${HISTORY.source}|${KEPT_EXAMPLES.source}`), why: "dated records: no rewriting history" },
  {
    id: "process",
    scope: false,
    re: new RegExp(`${TOOLING.source}|^docs\\/contributing\\/glossary\\.mjs$|^docs\\/(PROMPT_CACHING)\\.md$|^docs\\/assets\\/|^(CODE_OF_CONDUCT|SECURITY|compound-engineering\\.local)\\.md$|^${GUARD_TEST.replace(/[./]/g, "\\$&")}$`),
    why: "process tooling (this glossary and the guard's own test among them)",
  },
  { id: "goals", scope: false, re: /^goals\//, why: "tests of behaviour: renamed identifiers reach them through typecheck, their words stay" },
  { id: "config", scope: false, re: /^[^/]+\.(json|ya?ml)$|^\.changeset\/config\.json$|^eslint\.config\.mjs$|^LICENSE$|^\.gitignore$|^\.ignore$/, why: "root configuration" },
  { id: "package-src", scope: true, re: /^packages\/[^/]+\/src\// },
  { id: "package-tests", scope: true, re: /^packages\/[^/]+\/(test|tests|e2e)\// },
  { id: "package-other", scope: true, re: /^packages\// },
  { id: "docs-site", scope: true, re: /^apps\/docs\// },
  { id: "apps", scope: true, re: /^apps\// },
  { id: "labs", scope: true, re: /^labs\// },
  { id: "examples", scope: true, re: /^examples\// },
  // The root README is the repository's front page for readers, so it stays read for meanings too.
  // It matches here before `contributor` below, which reads it for names only in the sweep.
  { id: "reference-docs", scope: true, re: /^docs\/architecture\/|^docs\/mechanisms\/|^README\.md$/ },
  // Read for retired names only, never English meanings (FIX-2354 D1).
  { id: "contributor", scope: true, reach: "name", re: CONTRIBUTOR },
];

// ---------------------------------------------------------------------------------------------
// What each check reads from the entries. Derived, never written by hand.
// ---------------------------------------------------------------------------------------------

/** Escape `s` for use as a literal inside a regular expression. */
export const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Every retirement, with the term it belongs to. A bare `{ name }` becomes one sweep rule and one guard term. */
const RETIREMENTS = ENTRIES.flatMap((entry) =>
  entry.retires.map((r) => ({ reach: "name", ...r, id: r.id ?? r.name, term: entry.term })),
);

const textChecksOf = (r) => (r.check === undefined ? ["sweep", "guard"] : [r.check]);

/**
 * A name is read in the contributor trees too (FIX-2354 D1), in the encoding its rule already
 * reads: a code rule over the contributor trees' scripts, a page rule over their markdown. A rule
 * that names narrower files of its own (one package's surface) keeps them.
 */
const CONTRIBUTOR_CODE = new RegExp(`^(?=.*\\.(ts|tsx|mts|cts|js|mjs|cjs|jsx)$)(?:${CONTRIBUTOR.source})`);
const CONTRIBUTOR_DOCS = new RegExp(`^(?=.*\\.(md|mdx)$)(?:${CONTRIBUTOR.source})`);
const IN_CONTRIBUTOR_TREES = new Map([
  [CODE, [CONTRIBUTOR_CODE]],
  [PUBLISHED, [CONTRIBUTOR_DOCS]],
  [CODE_OR_PUBLISHED, [CONTRIBUTOR_CODE, CONTRIBUTOR_DOCS]],
  [CODE_PUBLISHED_OR_NOTES, [CONTRIBUTOR_CODE, CONTRIBUTOR_DOCS]],
]);
const withContributor = (r) => {
  const more = r.reach === "name" ? IN_CONTRIBUTOR_TREES.get(r.files) : undefined;
  return more === undefined ? r : { ...r, files: new RegExp([r.files, ...more].map((re) => re.source).join("|")) };
};

/** The sweep's rules: `{ id, files, pattern, pathName? }`. */
export const SWEEP_RULES = RETIREMENTS.filter((r) => textChecksOf(r).includes("sweep")).map((r) =>
  withContributor(
    r.check === "sweep"
      ? r
      : { ...r, files: REACH_FILES[r.reach], pattern: new RegExp(`(?<![\\w$])${escapeRe(r.name)}(?![\\w$])`) },
  ),
);

/** The guard's terms: `{ id, re, say, ground? }`, each `re` global. */
export const GUARD_TERMS = RETIREMENTS.filter((r) => textChecksOf(r).includes("guard")).map((r) =>
  r.check === "guard" ? r : { ...r, re: new RegExp(`(?<![\\w$])${escapeRe(r.name)}(?![\\w$])`, "g"), say: r.term },
);

/** The guard's whole-tree rules. One today: the resource entry's. */
export const TREE_RULES = RETIREMENTS.filter((r) => r.check === "tree");

/** The side-chain check's names by position: `any`, `called`, `contract-field`, `path-op`, `tier-value`. */
export const SIDE_CHAIN = RETIREMENTS.filter((r) => r.check === "side-chain").reduce((by, r) => {
  const position = r.position ?? "any";
  by[position] = [...(by[position] ?? []), ...(r.names ?? [r.name])];
  return by;
}, /** @type {Record<string, string[]>} */ ({}));

/** The exemptions each check reads, keyed by the retirements they name. */
const byCheck = (check) => {
  const ids = new Set(RETIREMENTS.filter((r) => textChecksOf(r).includes(check)).map((r) => r.id));
  return EXEMPTIONS.filter((e) => (e.rules ?? e.terms).every((id) => ids.has(id)) && (check === "guard") === (e.terms !== undefined));
};
export const SWEEP_EXEMPTIONS = byCheck("sweep");

/** The bare retirements: they name no check, so the sweep and the guard both read them. */
const BARE = new Set(RETIREMENTS.filter((r) => r.check === undefined).map((r) => r.id));

/**
 * A sweep-shaped exemption that keeps a bare retirement keeps it for the guard too, so one
 * exemption gives both checks one answer (D2): in the files it names, on the lines it keeps,
 * the guard strips the retired name.
 */
const SHARED_GUARD_EXEMPTIONS = SWEEP_EXEMPTIONS.filter((e) => e.rules.some((id) => BARE.has(id))).map((e, i) => {
  const terms = e.rules.filter((id) => BARE.has(id));
  const res = GUARD_TERMS.filter((t) => terms.includes(t.id)).map((t) => t.re);
  return {
    id: `shared-${i}-${terms.join("+")}`,
    terms,
    why: e.why,
    where: (path) => e.path.test(path),
    strip: (_path, line) => (e.line && !e.line.test(line.trim()) ? line : res.reduce((l, re) => l.replace(re, " "), line)),
  };
});
export const GUARD_EXEMPTIONS = [...byCheck("guard"), ...SHARED_GUARD_EXEMPTIONS];
export const SIDE_CHAIN_EXEMPT_FILES = byCheck("side-chain").flatMap((e) => e.files);
export const TREE_EXEMPTIONS = byCheck("tree");

/** The terms the published glossary page defines, each by exactly one row. */
export const PUBLISHED_TERMS = ENTRIES.filter((e) => e.published === true).map((e) => e.term);

// ---------------------------------------------------------------------------------------------
// The file is checked when it loads, so a bad entry fails every check at once.
// ---------------------------------------------------------------------------------------------

{
  const CHECKS = new Set(["sweep", "guard", "side-chain", "tree"]);
  const fail = (why) => {
    throw new Error(`docs/contributing/glossary.mjs: ${why}`);
  };
  const terms = new Set();
  for (const entry of ENTRIES) {
    if (typeof entry.term !== "string" || entry.term === "") fail("an entry has no term");
    if (terms.has(entry.term)) fail(`two entries for "${entry.term}"`);
    terms.add(entry.term);
    if (typeof entry.means !== "string" || entry.means === "") fail(`"${entry.term}" says nothing about what it means`);
    if (!Array.isArray(entry.retires)) fail(`"${entry.term}" has no retires list`);
  }
  const ids = new Map();
  for (const r of RETIREMENTS) {
    if (typeof r.id !== "string" || r.id === "") fail(`a retirement under "${r.term}" has neither a name nor an id`);
    if (ids.has(r.id)) fail(`the retirement "${r.id}" is under both "${ids.get(r.id)}" and "${r.term}"`);
    ids.set(r.id, r.term);
    if (r.check !== undefined && !CHECKS.has(r.check)) fail(`"${r.id}" names an unknown check "${r.check}"`);
    if (r.reach !== "name" && r.reach !== "meaning") fail(`"${r.id}" has reach "${r.reach}": say "name" or "meaning"`);
    if (r.check === undefined && typeof r.name !== "string") fail(`"${r.id}" names no check, so it needs a name`);
  }
  for (const r of SWEEP_RULES) if (!(r.files instanceof RegExp) || !(r.pattern instanceof RegExp)) fail(`the sweep rule "${r.id}" needs files and a pattern`);
  for (const r of GUARD_TERMS) if (!(r.re instanceof RegExp) || !r.re.global) fail(`the guard term "${r.id}" needs a global re`);
  for (const e of EXEMPTIONS) {
    const named = e.rules ?? e.terms;
    if (!Array.isArray(named) || named.length === 0) fail(`an exemption (${e.id ?? e.why}) keeps no retirement`);
    for (const id of named) if (!ids.has(id)) fail(`an exemption (${e.id ?? e.why}) keeps "${id}", which nothing retires`);
    if (typeof e.why !== "string" || e.why === "") fail(`an exemption keeping ${named.join(", ")} gives no reason`);
    const bare = (e.terms ?? []).filter((id) => BARE.has(id));
    if (bare.length > 0) fail(`a guard exemption (${e.id}) keeps ${bare.join(", ")}, which the sweep reads too: give it the sweep's shape (path, line, rules), which both checks read`);
  }
  const POSITIONS = new Set(["any", "called", "contract-field", "path-op", "tier-value"]);
  for (const r of RETIREMENTS) {
    if (r.check !== "side-chain") continue;
    if (!POSITIONS.has(r.position ?? "any")) fail(`"${r.id}" has side-chain position "${r.position}", which the side-chain check never reads`);
    const names = r.names ?? [r.name];
    if (names.length === 0 || names.some((n) => typeof n !== "string" || n === "")) fail(`"${r.id}" retires no side-chain name`);
  }
  if (!(SIDE_CHAIN.any?.length > 0)) fail("the side-chain check would read no retired names");
  // The side-chain check has no escape hatch: it keeps exactly the two rename-boundary tests.
  if (SIDE_CHAIN_EXEMPT_FILES.length !== 2) fail(`the side-chain exemptions must hold exactly the two rename-boundary tests; found ${SIDE_CHAIN_EXEMPT_FILES.length}`);
  const placed = SWEEP_EXEMPTIONS.length + byCheck("guard").length + byCheck("side-chain").length + TREE_EXEMPTIONS.length;
  if (placed !== EXEMPTIONS.length) fail("an exemption keeps retirements from more than one check, or in the wrong shape for its check");
}
