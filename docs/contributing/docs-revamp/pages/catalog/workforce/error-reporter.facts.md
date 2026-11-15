# Facts for Error reporter (K-13, catalog, kit template)

Every fact the page may state, with file and line. Sources are limited to what a fact sheet may cite: the existing user page, the exported surface and its doc comments, tests, `goals/`, one example (the devteam Lab). No spec, issue, changeset, `docs/internal` or `CLAUDE.md` was read for a fact. Every surface named here is built; nothing is marked for reconciling at cutover. Paths are from the repo root.

Abbreviations:

- `rp` = `packages/workforce/src/error-reporter/reporter.ts`
- `fl` = `packages/workforce/src/error-reporter/flow.ts`
- `rs` = `packages/workforce/src/error-reporter/reports.ts`
- `fp` = `packages/workforce/src/error-reporter/fingerprint.ts`
- `rd` = `packages/workforce/src/error-reporter/redact.ts`
- `rc` = `packages/workforce/src/error-reporter/rescued.ts`
- `ix` = `packages/workforce/src/error-reporter/index.ts`
- `ts` = `packages/workforce/src/conversation-board/task-settled.ts`
- `dl` = `packages/workforce/src/conversation-board/delivery.ts`
- `cf` = `packages/workforce/src/coordinator/coordinator-flow.ts`
- `mw` = `apps/docs/docs/workforce/error-reporter.md` (the existing page, sidebar-less today)
- `ec` = `apps/docs/docs/advanced/error-capture.md`
- `de` = `apps/docs/docs/advanced/durable-execution.md`
- `t` = `packages/workforce/test/error-reporter.test.ts`
- `tf` = `packages/workforce/test/error-reporter-fingerprint.test.ts`
- `g` = `goals/error-reporter/files-a-reproducible-issue/goal.md`
- `lab` = `packages/shift-manager/teams/devteam/host.mts` (the Lab that opens it; the one example)
- `wm` = `packages/shift-manager/teams/devteam/workforce/org/workers/error-reporter/WORKER.md`
- `hm` = `packages/shift-manager/teams/devteam/harness.mts`
- `tb` = `packages/shift-manager/src/components/TaskBoardMeta.tsx`

Legend: **[page]** the page states it. **[ref]** it belongs on a Reference page; the page links, does not state it. **[verify]** not confirmed against running code; keep off the page or soften. **[cut]** history or mechanism; never on the page.

## Flags against the page plan and the existing page (read first)

1. **The Error Reporter is not part of the workforce kit.** The kit's source names nothing of it (a search of `packages/workforce/src/kit/` for "reporter" finds nothing). It is exported from `@flow-state-dev/workforce` beside the kit: `ix:7-41`, `packages/workforce/src/index.ts:167`. So "What you get / Install it" is not the kit's install: the app calls three functions and one engine option. The page cannot say "part of the workforce kit". [page]
2. **No slot of its own, and it fills none by name.** It declares no slot. Its flow is a worker flow (a flow a `WORKER.md` names with `flow: error-reporter`): `wm:2`, `fl:719-752`. The Lab leaves the reporter's worker off the roster unless the Lab is opened with `errorReporter`: `lab:965-970`, `lab:997`. The page should say "opens no slots" flat, and name what it serves instead (the Inbox ask, a conversation, the report rows). [page]
3. **The page plan says "worker".** It is a worker (it has a conversation and a `WORKER.md`) and also two flows plus an engine hook. `ix:1-6`; `fl:6`. [page]
4. **`openLab` is the only host that does the wiring for you.** The existing page says "A Shift Manager Lab does all of this for you when you pass `errorReporter` to `openLab`" (`mw:78`); confirmed: `lab:974-986`, `lab:1213-1221`, `lab:1417-1430`, `lab:1274`, `lab:1319`. `openLab` is in the shift-manager package's devteam host, not a documented public export; say it only as "a Shift Manager Lab". [page]
5. **The existing page's example is incomplete and has free names.** `installation`, `myCodingHarness`, `projectMcpTools`, `host` are not declared (`mw:44-76`); `flows: { /* ... */ }` is an object, but `rp:14` (its own doc comment) writes `flows: [..., flow, intake]` as an array. The page must declare or explain each, and check which `createFlowState` form is real before writing it. **[verify]** which of the two `flows` shapes `createFlowState` takes. Also `defineErrorReporterFlow` returns a flow definition and `defineErrorReporterIntakeFlow` returns a flow definition: `fl:223`, `fl:785`; the Lab instantiates the intake with `()` (`lab:1319`), so a flow-definition call may be needed. **[verify]**
6. **A model name in the repo is stale.** `wm:4` says `openai/gpt-6-luna`; `g` says the reporter's turn runs `openai/gpt-5.4-mini`. The page uses `openai/gpt-6-luna`. Not a fact about behaviour; kept off the page. [cut]
7. **The `goals/` check's FIX id and internal comments** (`// FIX-1983.` headers, "decision (f)", "FIX-2078") are in source comments; never on the page. [cut]
8. **Existing page claim, verified:** "a task that gave up without throwing" is reported. The goal's Leg 7 plants `[gives-up]` and asserts exactly one report: `g` (Signal, Leg 7). Source: `ts:233-247` (any `errored` ending). [page]

## What it is and what it is for [page]

- The Error Reporter turns a failure that stayed failed, or a problem a user describes, into one bug report: `ix:2-5`, `mw:5`, `mw:10`.
- The report is previewed to the operator in Inbox and filed through the project's tracker: `ix:4-5`; `fl:2-6`.
- It shows the report to the operator and files it to the tracker "once they say yes": `mw:10`; `fl:416-448` (the preview suspends for an answer), `fl:468-488` (approval moves the report to filing).
- It runs on its own flow, "never through the Shift Coordinator, which is the part most likely to have failed": `fl:3-6`. The page may state "It runs on its own flow, never through a coordinator" (`mw:98`) and drop the clause about why. [page]
- Failures otherwise get lost: a request fails, a task ends errored, nobody writes it down (`mw:10`, voice only; not a behaviour claim, but a situation to open on). [page]

## Question 1: what two things can start a report [page]

The page plan says two. The code has four **sources**, which a reader sees in the preview's "Seen N times" and in `preview.autoFile`'s source names: `rs:83` (`source: "request" | "task" | "manual" | "storm"`), `ix`/`rp:116` (`autoFile` names `request` / `task` / `manual` / `storm`). The two things that start one are:

### A. A failure that stayed failed

- The engine's error capture sends one `final` event per request that ends failed, after rescues and retries; a request a retry or rescue saved never sends one: `ec:62`. The reporter takes only `final` events: `rp:140`, `rp:316-317` (`if (event.final !== true ...) return`), `t:600-605` ("takes no event that is not final").
- You hand the engine `errorCapture: reporter.capture`: `rp:14`, `rp:140`. `capture` never throws: `rp:140`.
- **A request that settled failed** is one kind: `rs:44-45`, `t:279-302`.
- **A task that ended errored** on a conversation board is another, including a task that "gave up without throwing" (see flag 8): `ts:233-247` (the report goes out only when `notice.ending === "errored"`, line 229), `rs:48-62` (a `task` occurrence). `dl:75-81` sends the same report when the conversation that filed the task cannot be told.
- A task's failed requests join the task's report instead of making reports of their own: `rs:49-50` (a `held` occurrence), `rs:348-365`, `rs:396-400`, `t:557-578`. A failed request in a task's session is held until the task ends, since a retry may pass: `rp:213-222`; `t:580-591` (a failed request whose task has not ended errored reports nothing).
- The report goes out with the notice that tells the filing conversation the task failed, so if a crash loses the notice, the report is sent again when the notice is: `ts:226-247` (`reportFailure` throws when the intake did not take it, "so the notice stays owed and the report goes again with it"), `ts:252-262` (`beforeAcknowledge`). [page] Keep to the guarantee ("a lost notice sends the report again"), not `beforeAcknowledge`. **[ref]** for the detail.
- A routed task (a message a coordinator hands to a delegate) counts too, when the delegate's turn fails: `ts:375-395` (an errored routed task with a brief), `ts:252-262` (every taker of a notice reports an errored ending). Goal Leg C: the researcher's failed post reaches Inbox as a task report: `g` (Leg C). [page]
- **A cancelled task is not reported:** `ts:229` returns unless the ending is `errored`; `tb:12-13` ("a cancel isn't reported"). Verified in source; no test names the cancelled case directly (`t` has none), so state it flat from source. **[verify]** against running code if the page wants a stronger claim.
- **A routed task whose run the user stopped ends cancelled, not errored** (`mw:19`). No source or test found that distinguishes this routed-stop case from a plain cancel: it follows from `ts:229`. Keep it as one sentence ("a cancelled task is not reported") and drop the routed-stop clause. **[verify]**
- A Shift Manager Lab says so on a cancelled task's card, with a link to the reporter's conversation, "Cancelled because something went wrong? Tell <name> what happened, and name this task (<taskId>)." It is drawn only when the Lab has an Error Reporter: `tb:12-41`. [page]
- **A coordinator's own crash that it answered:** a best-fit coordinator whose turn fails tells the user "Nobody took this message", the request completes, so no `final` event is sent. The crash is reported anyway: `cf:1213-1222`, `rc:1-5`, `rc:68-106` (`reportRescuedFailure`, which "never throws"). Goal Leg C: `g`. [page]
- A failure a flow rescued reaches the intake without the capture, and the Lab's `filter` decides it there too: `fl:795-798`, `t:435-441`. [page] (Fold into the `filter` row.)

### B. A problem a user describes

- A user messages the Error Reporter in its own conversation, with the tool `reportProblem`: `fl:666-698`. Its input: `description` (required), and optional `sessionId`, `taskId`, `project` the user named: `fl:671-676`.
- The tool's own description says to use it "when the user tells you something went wrong. Do NOT use it for a standing rule about how you work": `fl:668-670`. The worker's instructions say the same: `wm:13-23`.
- It goes through the same intake, preview and filing as a failure: `fl:665`, `t:636-649` ("one report in Inbox, nothing filed before the answer"). Goal Leg M: `g`.
- A problem a user describes is fingerprinted by its description in place of the message: `rs:384-387`. [page]
- A named session is read only if it belongs to the user who named it; otherwise the dossier says it is not readable: `rp:389-403` (`"not readable: it is not the reporting user's session"`), `t:415-433`. Checked against the user who named it, not whoever reported the same problem last: `rp:392-394`. [page]
- With no session named, the dossier reads the user's newest sessions (three), leaving out the reporter's own: `rp:404-412`, `rp:161-162`. **[ref]** (a number).
- Telling the reporter how to work ("always label these P2") saves a standing rule instead of filing a report: `wm:20-22`, `fl:731` (`STANDING_RULES_ACTION` on the flow), `fl:668-670`. [page]
- A report session is not for setting a work project: `fl:733-737`, `t:621-634`. [ref] (cut from the page).

### The reporter never reports its own failures [page]

`rs:344-346`, `rp:317` (`event.flowKind === flowKind || ... ERROR_REPORTER_INTAKE_FLOW`), `t:593-598`.

## Question 2: who sees it before it is filed [page]

- **The operator**, as an ordinary question in Inbox: `fl:416-447`. The question's heading is `Error report: <title>`, its message `Seen N time(s). File it?` and, if the draft has any, a `Questions` list: `fl:427-434`, `t:290-293` (exact strings: title `"Error report: Coordinator fails on a project with no repository"`, message `"Seen 1 time. File it?\n\n**Questions**\n\n- Which team?"`). The questions render as markdown: `fl:361`. The operator's answer is a form with `decision` (`file` or `dont-file`) and optional `instructions`: `fl:103-107` (labels: "File this issue, or don't file it"; "Anything to change, add or answer before it files"). The question allows only `submit`: `fl:437`.
- The operator is named at setup: `operator: { userId, orgId }` (`rp:44-47`, `rp:105`). A report run is only for the operator: `fl:318-320` ("Only the Lab's operator runs an error report."), `t:607-619`. In a Lab the operator is the Lab's user: `lab:977-979`.
- The three answers: File as drafted, file with instructions ("label it P1"), or Don't file: `fl:103-107`, `fl:462-475`; the example "Label it P1 and say which model the coordinator ran" and its outcome (filed issue says P1): `g` (Leg 1); "Put it in the Platform team" folded into what files: `t:297-299`. [page]
- A **Don't file** answer dismisses the report; repeats only count, and give no new card, for a day (`limits.dismissForMs`, default 24 hours): `fl:451-462`, `rs:125`, `rs:172`, `rs:245-249`, `t:319-328`. [page]
- **Nothing is filed before they answer unless you say otherwise.** Two ways to say otherwise, both off by default:
  - `preview.autoFile`: error codes, or sources (`request`, `task`, `manual`, `storm`), that file without a preview: `rp:113-116`, `fl:423-426` (matches `row.errorClass` or `row.source`), `rs:92`/`rs:421` (`errorClass` is the error code, else the source), `t:342-347`.
  - `preview.autoFileAfterMs`: file the draft as written when the preview goes unanswered this long: `rp:117-118`, `fl:438`, `fl:443-445`.
  - `g` Leg 1: "nothing filed before the answer" (Signal). [page]
- **What they are shown** is the draft: summary, steps to reproduce, expected and actual, suspected cause, and questions: `fl:91-99` (`draftSchema`), `fl:173-188` (`composeIssueBody`: sections Summary, Steps to reproduce, Expected, Actual, Suspected cause, "Reported by a user", then a Context section). The Context section is written by code from the report, so its ids are exact: `fl:173`, `fl:136-168`. It lists: fingerprint, how often seen, flow/action, block, error code, error, request, session, user, organization, task, board, each failed request of the task, project, links, and the earlier issue if it came back after one was closed: `fl:142-160`. [page] (as an example, in a preview), **[ref]** for the full list.
- A repeat of a report awaiting a preview raises its count, shown as "Seen N times": `fl:427`, `rs:555-586`.
- **What the draft is made from** (the dossier): the failing requests, the sessions they ran in, the failing session's project, and links to them: `rp:371-435`. At most three requests and three sessions: `rp:161-162`, `rp:374-383`. A request or session that cannot be read is shown as unreadable, not dropped: `rp:378`. The dossier is capped at 16,000 characters of JSON and cut with `… (cut)` after: `fl:215-216`, `fl:350-351`. **[ref]**. The "failing session's project" is read from the failing session, never the tracker's: `rp:413-415`, `t:312-318`. [page] "links to them": `options.links` (see Options).
- **Drafting** is a coding harness that reads the code and drafts the issue: `fl:356-369` (the prompt: "Read the code in your working directory ... Do not change any file."). In the Lab the harness is Claude Code with `Read`, `Grep`, `Glob` only and no write or shell tools: `hm:199-216`. The drafting run gets no tracker tools: `fl:270-272`, `fl:61-71` (the `mcpTools` feed "Handed only to the harness that files and comments, after the operator approved; the one that drafts gets none"), `t:475-483`. [page]
- **Secrets are removed before anything is stored or shown:** `rd:1-10`, `fl:343`, `fl:398-404`. What is removed: the environment's keys (variables whose names say they hold a secret: `KEY`, `TOKEN`, `SECRET`, `PASSWORD`, `PASSWD`, `CREDENTIAL`, `AUTH`, `COOKIE`, `PRIVATE`; values at least 8 characters), values you pass in `secrets`, the operator's stored MCP keys, and anything shaped like a key or bearer token even when nobody named it: `rd:184-211`, `fl:196-213`, `rp:124-125`, `t:349-356`, `t:404-413`; `tf:` (redact tests). The replacement text is `[redacted]`: `rd:182`. Goal Leg 5: no report row, report-session record or tracker call holds the Lab's secret, the tracker key or `ANTHROPIC_API_KEY`: `g`. [page] ("Secrets are removed before anything is stored": the guarantee.) The shapes and name list: **[ref]**.
- A user's problem report in the preview is marked "Reported by a user" in the issue body: `fl:183`. [page] optional.

## Question 3: where it goes [page]

- **To your tracker, through the project's MCP servers.** `tracker: { project: "shared/storefront" }` is the project whose MCP servers reach the tracker, written `<visibility>/<id>`; `hint` is an optional string for the filing run, such as the tracker's team: `rp:106-112`. The filing run is separate from the drafting run and gets the project's MCP tools, with every call's arguments redacted: `fl:238-266`, `fl:569-573`, `fl:61-71`.
- **The filing run is told to use Linear.** The prompt reads "File this bug report as exactly ONE new issue in Linear, using the linear MCP tools": `fl:502`. So a tracker other than Linear has no supported path in the shipped prompt. [page] State flat: "The shipped filing prompt names Linear." (`mw:36` says "such as Linear".) **[verify]** whether to say "such as Linear" (the page's existing wording) or "Linear"; the code says Linear.
- **The operator's key.** `mw:36`: "with the operator's key." Source: the tracker run uses the project's MCP servers and the operator's stored MCP credentials: `fl:196-213`, `hm:199-202` (`uses: [projectWorkspaceCapability, mcpCredentialsCapability]`). **[verify]** the wording "with the operator's key"; the sheet found the credentials capability but no line saying whose key. Keep to "through the tracker project's MCP servers".
- **What files:** exactly one new issue, with the operator's answer folded in ("apply what it asks (labels, priority, wording) and add what it tells you to the body"), and every line of the Context section kept as written: `fl:500-515`. The run replies with the issue's `url` and `identifier`: `fl:513`, `fl:527`. [page]
- **If filing fails, the report stays approved and is tried again.** The run's answer is parsed; if it does not hold a url, the report keeps its approved status, the row records `not filed: <reason>`, a message in the report session says "This report was not filed yet; it will be tried again", and the run returns `retry: true`: `fl:527-537`. The reporter tries again after 5 minutes (`RUN_RETRY_MS`), and at the next start: `rp:167-168`, `rp:275-276`, `t:485-499` ("keeps an approved report owed when filing fails, and files it on the next run"). [page] "tried again" and "five minutes" (a number a reader can depend on is **[ref]**; the page may say "later").
- **Where the reporter tells you:** it writes a line in its own conversation: `Filed <identifier>: <title> <url>`: `fl:549-551`, `fl:707-715`, `t:` ("Filed FIX-9" line, `t:301`). [page]
- **Without `tracker`, reports are kept and previewed but never filed.** After the operator answers File, the report is marked filed with no issue, and the reporter's report session says "This Lab names no tracker, so the report is kept here and nothing was filed.": `fl:556-567`, `fl:584`, `rp:106`. [page]
- **A repeat of a filed report adds a comment to the issue, at most once an hour by default** (`limits.commentEveryMs`): `rs:532-536`, `rs:172`, `fl:600-624`. The comment says it has happened N times, with the newest ids (up to three): `fl:610-618`. The comment run reads the issue first; if its state is completed or canceled it does not comment and the report is closed, "its failure starts a new report next time": `fl:617`, `fl:641-651`, `rs:245-249`, `t:357-381` ("adds a counted comment on a repeat after filing, and starts over once the issue is closed"). A report that comes back after its issue closed links the old issue ("Came back after"): `rs:433`, `fl:160`. [page] (one or two sentences.)
- **Work the reporter owes survives a restart.** On `bind` it picks up every report still `owed`, `drafting` or `filing` (it starts that report again, after the claim lapses if another run holds it) and every filed report that owes a comment: `rp:333-343`, `rp:160-176`. Goal Leg 6: the reporter's own harness fails, the report stays owed or drafting, and after a restart it is retried and reaches Inbox: `g`. [page]
- **It doesn't fix the bug or open a pull request. It writes one issue and stops.** `mw:98`; the draft prompt says "Do not change any file": `fl:357`, `hm:208-209` (no `Write`/`Edit`/`Bash`). [page]

## One report per problem [page, two short sentences, rest ref]

- A fingerprint is a digest of the flow, action, block path, error code and a normalized message: `fp:1-8`, `fp:161-169`. The message has ids, numbers and paths taken out, is lower-cased, and whitespace collapsed: `fp:143-151`; `tf:` ("is the same for two failures that differ only in ids, numbers and paths"; "differs when the block, the code, the action or the message's words differ"). [page] as the guarantee: "Two failures that differ only in ids, numbers and paths are one report." The strip rules (uuid, prefixed ids, hex, paths): **[ref]**.
- Occurrences with the same fingerprint are one report; a repeat raises its count: `rs:403-406`, `rs:555-586`, `t:279-286` (two failures with different request ids give one row, count 2). Goal Leg 2: the same failure 10 more times is one report, count 11, no second Inbox card: `g`. [page]
- A task's report is fingerprinted by the task's ending (assignee, error), not by which of its failed requests arrived first: `rs:378-382`. **[ref]**
- Redelivering the same occurrence counts it once: `rs:266-282` (`occurrenceKey`: a request by id, a task ending by board, task and attempt; a user's report has none, so each message is its own occurrence), `t:382-390`. [page] one sentence.
- **Two bugs that fail at the same block with the same code and words are merged** until someone splits them: `fp:5-8` (the doc comment states it as a known price). Stated as a limit, flat. [page] ("Two different bugs that fail the same way in the same block share a report.")
- A report keeps only the newest five occurrences and the newest 50 occurrence keys: `rs:24-27`. **[ref]**.
- **The cap.** New reports are capped per window: five an hour by default (`limits.newPerWindow`, `limits.windowMs`): `rs:168-173`, `rs:452-470`. Past the cap, failures go into one **storm report** per window that lists them, each fingerprint once with a count: `rs:472-530`, `rs:68-76`, `rs:162-165` (the storm's table in the Context section: "Failures in this storm"). A storm report is previewed and filed like any other: `rs:502-515`, `t:532-555`. A storm report already filed owes a counted comment for later ones: `rs:473-474`, `t:532-555`. Goal Leg 3: 30 different failures give 1 to 5 reports and one storm report, each failure in exactly one: `g`. [page]
- The cap's window never moves back: a late occurrence counts in the current window: `rs:446-449`, `t:443-453`. **[ref]**.
- A dismissed report only counts repeats for a day before it can be reported again: see Question 2. [page]
- A task that fails once and passes on retry gives no report: `g` (Leg 4), `rp:213-222`. [page]

## Turning it on: the surface [page]

Exports, all from `@flow-state-dev/workforce` (`ix:7-41`, `packages/workforce/src/index.ts:167`):

- `createErrorReporter(options): ErrorReporter` (`rp:175`). Options (`rp:100-130`):

| Option | Type | Default | Source |
| --- | --- | --- | --- |
| `worker` | string: the id of the `WORKER.md` its sessions run | required | `rp:102-103` |
| `operator` | `{ userId: string; orgId: string }` | required | `rp:44-47`, `rp:104-105` |
| `tracker` | `{ project: "<visibility>/<id>"; hint?: string }` | none: reports kept and previewed, never filed | `rp:106-112` |
| `preview.autoFile` | `string[]`: error codes or sources | none | `rp:114-116` |
| `preview.autoFileAfterMs` | number | never | `rp:117-118` |
| `limits.newPerWindow` | number | `5` | `rs:157-173` |
| `limits.windowMs` | ms | one hour | `rs:159`, `rs:169-170` |
| `limits.commentEveryMs` | ms | one hour | `rs:161-162`, `rs:171` |
| `limits.dismissForMs` | ms | 24 hours | `rs:163-164`, `rs:172` |
| `filter` | `(event: FinalFailureEvent) => boolean` | all | `rp:122-123`, `rp:307-314` |
| `secrets` | `() => readonly string[]` | none | `rp:124-125`, `rp:359` |
| `links` | `(ids: OccurrenceIds) => Record<string, string>`, by label | none | `rp:126-127`, `rs:30-41` |
| `log` | `(message: string) => void` | `console.warn("[error-reporter] ...")` | `rp:128-129`, `rp:177` |

  The existing page's table (`mw:84-94`) omits `log` and writes `secrets` as "Extra values" (a function returning them). `preview` and `limits` are partial; `limits` takes any subset: `rp:121`. A `filter` that throws takes nothing (the failure is not reported) and logs: `rp:142`, `rp:307-313`. [page] for the table, with `secrets` and `links` typed as functions.

- `defineErrorReporterFlow({ reporter, installation, harness, mcpTools?, cwd?, agent? })` (`fl:73-87`, `fl:223`):
  - `reporter`: the reporter the flow serves.
  - `installation`: "The worker installation the reporter's `WORKER.md` is a standard worker of": `fl:77-78`. Type `WorkerInstallation`: `fl:20`.
  - `harness: (feeds) => HarnessBlock`: builds the coding harness from its feeds (`cwd`, and `mcpTools` on the filing one): `fl:61-71`, `fl:79-80`. Called twice, once for drafting and once for filing: `fl:271-272`.
  - `cwd`: where the harness reads the code, a directory or a function per run; default `process.cwd()`: `fl:81-82`, `fl:268`.
  - `mcpTools`: `projectMcpTools`, "through which a report files": `fl:83-84`.
  - `agent`: the conversation turn's options, its model and catalog: `fl:85-86`. Passing `agent.sessionFields` throws: `fl:226-228`. [ref]
- `defineErrorReporterIntakeFlow({ reporter })` (`fl:755-759`, `fl:785`): "the one door every occurrence comes in by"; "It runs no worker and opens to no caller: its entries are internal": `fl:777-783`. A board on any flow reaches it by name: `fl:777-783`, `ix`/`packages/workforce/src/error-reporter/keys.ts:51-52`.
- Constants: `ERROR_REPORTER_FLOW = "error-reporter"`, `ERROR_REPORTER_INTAKE_FLOW = "error-reporter-intake"`: `keys.ts:49-52`; `ERROR_REPORTER_FLOW` is also exported from the browser entry: `packages/workforce/src/browser.ts:77`. The worker's `flow` in `WORKER.md` is `error-reporter`: `wm:2`.
- Engine side: `errorCapture: reporter.capture` on `createFlowState` (`rp:14`, `mw:72`); `await reporter.bind(host)` "after the runtime exists" (`rp:144-145`, `rp:14`). `bind` takes the runtime operations the reporter runs through (`ErrorReporterHost`): `run`, `openSession`, `readSession`, optional `readSessionState`, `readRequest`, `recentSessions`, and `conversationSessionId`: `rp:66-98`. [page] one sentence; the host's methods are **[ref]**. Failures that arrive before `bind` wait for it: `rp:180-181`, `rp:319`, `rp:332`.
- **Durable execution:** the preview is a suspension, which needs a durable host: `fl:430`, `de:38-42` ("On a host without durable execution, `ctx.suspend()` throws an error that names the setting to change, and the request fails"), `de:11` (on by default over stores that persist), `de:32-38`. The existing page says `durable: true` is "needed with in-memory stores; on by default over persisting stores": `mw:71`. Confirmed by `de`. [page]
- Other lifecycle calls on the reporter: `idle()` (resolves when every run it started has settled), `dispose()` (start nothing more; what is owed stays owed): `rp:146-149`. [ref]
- **The reporter's worker needs a `WORKER.md`** whose `flow` is `error-reporter`: `wm:1-6`. The Lab's own file: `description`, `model`, and `tools: []`; the body tells it to call `reportProblem` for a problem and `rules/add` for a standing rule: `wm:1-24`. [page] (as the "change it" file; this is the file a reader edits to change its instructions.) The Lab requires exactly one worker on that flow in the tree when `errorReporter` is passed, and throws otherwise: `lab:967-970`. [ref]
- **In a Lab:** `openLab({ errorReporter: { harness, cwd?, tracker?, preview?, limits?, secrets? } })`: `lab:710-724`, `lab:974-986`. Without it, the worker is left off the roster as if the tree didn't declare it: `lab:965-966`, `lab:997`. The Lab sets the operator to its own user and gives `links` and `log` itself: `lab:977-985`. The Lab's real config: `errorReporter: { harness: errorReporterHarness, cwd: CHECKOUT, tracker: { project: "shared/fsd" } }`: `packages/shift-manager/teams/devteam/fsd.fsdev.config.mts:103`. [page] for the example's shape.

## Slots it opens, slots it fills, views it serves [page]

- **Slots it opens:** none. No `defineSlot`/slot declaration in the module. (Searched `packages/workforce/src/error-reporter/` for slot declarations: none.) [page] State flat.
- **The harness is a parameter, not a slot:** `harness: (feeds) => HarnessBlock` on `defineErrorReporterFlow`: `fl:79-80`. [page] Name it "a coding harness you pass in".
- **Slots it fills:** none by name in this module. It uses the worker-flow route: the flow's registration declares the built-in role `manager` ("It runs its session board, so it declares the role the board's entries belong to"): `fl:751-752`. **[verify]** whether this is a slot fill for the kit template; kept off the page.
- **Views it serves:** the preview is an Inbox question (an ordinary suspension a Shift Manager Lab shows in Inbox): `fl:6`, `fl:430-439`. A conversation with the reporter (`respond`, `reportProblem`): `fl:727`, `fl:700-705`. A cancelled-task note on a task's card in a Lab, drawn only when the Lab has an Error Reporter: `tb:12-41`. The report rows are **not** a view: `errorReportsCollection` declares `client: { state: { read: false }, content: { read: false, create/update/delete: false } }`: `rs:144-151`. [page] The reports are never read by a browser.

## Who owns what is stored (four questions) [page, short]

The stored parts, each answered: owner, who sees it, where stored, how many.

### 1. Report rows (the collection `errorReports`, key pattern `error-reports/*`)

- **Owner / scope:** org scope: "one Lab's reports, shared by its users": `rs:144-151` (`scope: "org"`), `rs:144` (doc comment). The row's content (`status`, `draft`, `issue`, `occurrences`, `description`, `named`, `claim`, etc.) is written by server code only: `rs:15-19` ("Every field is written by server code ... never by a caller"), `rs:79-138`.
- **Who sees it:** nobody in a browser. `client: { state: { read: false }, content: { read: false, create: false, update: false, delete: false } }`: `rs:150`; "Never read by a browser": `rs:144`. The operator sees the draft in Inbox as a question (a copy in the question's data), not the row. The reporter's flow reads rows through an internal entry `reports` on the intake flow: `fl:814-823`, `fl:832`.
- **Where stored:** the app's store, under `error-reports/*`: `rs:145-151`. Keys: `fp-<fingerprint>` one report per fingerprint; `storm-<window start>` the window's storm report; `cap` the fingerprints that got a report in the current window; `held-<task id>` failed requests of a task held until the task ends; `task-<task id>` the report a task's ending went to: `rs:5-10`, `rs:197-202`. Declared by both flows, so the intake and the reporter's flow read one collection: `fl:725`, `fl:827`. Lazy prefetch: `rs:148`.
- **How many:** one per fingerprint, plus at most one storm report per window, one `cap` row, one `held-` row per task with a held request and one `task-` mapping per task that ended errored: `rs:5-10`, `rs:403-441`. New reports per window capped at `limits.newPerWindow`: `rs:452-470`. A row keeps its newest five occurrences, newest 50 seen keys, newest five joined task requests: `rs:24-27`, `rs:546-552`. A closed or expired-dismissed report starts a new row on the next occurrence: `rs:245-249`, `rs:411-435`. [ref] for the counts, **[page]** for "one report row per problem". There is no deletion or expiry for rows in the source found; **[verify]** that a store never prunes them (not stated; keep off the page).

### 2. Report sessions (one per report)

- **Owner:** the operator. A report's session is opened for the operator (`userId`, `orgId` from `operator`), carries the reporter's worker id in its state, and its id is `error-report~<report id>`: `rp:254-263`, `fl:53-54`. A report's run refuses any other user: `fl:318-320`, `t:607-619`.
- **Who sees it:** the operator, who can open it; its items hold the run's messages, such as "This report was not filed yet; it will be tried again" and the filing/comment confirmations: `fl:535`, `fl:550`, `fl:565`, `fl:637`. In a Shift Manager Lab it is a session like any other: `g` (Inbox read "the way Shift Manager reads it"). **[verify]** exact Shift Manager listing of report sessions; keep off the page.
- **Where stored:** the app's session store, as a session of the `error-reporter` flow: `rp:254-263`. The draft and answer live in the row (item 1) too: `rs:106-111`, `fl:405-410`.
- **How many:** one session per report row: `fl:53-54`, `rp:254`. A session board's entries on the reporter flow (message sending) are internal: `fl:740-749`. [ref]
- A report session can't be set to work in a project: `fl:733-737`, `t:621-634`. [ref]

### 3. The reporter's conversation (the operator's, and every user's)

- **Owner:** the user who is talking to it. The flow is a "collection": one conversation per user per hire, like any worker flow: `fl:719-722` (`cardinality: "collection"`). Its worker is the one `WORKER.md`: `wm:1`. **[verify]** how many instances a roster holds for it; left to the Workers page (K-01).
- **Who sees it:** the user whose conversation it is. A report is filed by the operator even when another user reported the problem; the named session is read only if it is that user's: `rp:389-403`, `t:415-433`. The line "Filed ...", "Commented on ..." goes in the reporter's **own** conversation, the one the host names as `conversationSessionId`: `rp:96-97`, `rp:366-369`, `fl:549-551`. Which conversation that is for the Lab: the operator's: `lab:1423-1427`. So the confirmation goes to the operator's conversation, not to the user who reported a problem. [page] one sentence.
- **Where stored:** the app's session store. **How many:** one per user who talks to it. **[verify]**

### 4. The intake session

- **Owner:** the operator. A single session `error-report-intake` on the intake flow, "the reporter's own, and the key of each board's child session": `keys.ts:57-58`, `rp:325-331`.
- **Who sees it:** nobody directly; its entries are internal: `fl:777-783`, `fl:829-834`. Internal, so no caller reaches it: `fl:777-783`.
- **How many:** one: `keys.ts:57-58`, `rp:325-331`. [ref]

### 5. The Lab's stored MCP keys the reporter reads

Not stored by the reporter. The intake flow declares the `MCP_CREDENTIALS_RESOURCE` collection so redaction can read the running user's stored keys: `fl:827`, `fl:196-213`. The reporter removes those values from everything it stores. [page] as part of the "secrets" sentence; ownership of the keys belongs to the Projects page.

## What it will not do (limits) [page flat, no argument]

- It does not fix the bug or open a pull request. It writes one issue and stops: `mw:98`; `fl:357`; `hm:208-209`. [page]
- It does not report a cancelled task: `ts:229`, `tb:12-13`. [page]
- It does not report a failure that a retry or rescue saved (a `final` event is sent only for a request that ends failed): `ec:62`; **but a failure a coordinator rescued into "Nobody took this message" is reported by the coordinator itself**, see Question 1. [page]
- It does not report its own failures: `rs:344-346`. [page]
- It does not run through the Shift Coordinator or any other coordinator: `fl:3-6`. [page]
- Without a `tracker`, it never files: `rp:106`, `fl:584`, `fl:556-567`. [page]
- The shipped filing prompt names Linear: `fl:502`. [page] (see **[verify]** above.)
- Two bugs that fail identically at one block are one report: `fp:5-8`. [page]
- A failure with no `userId` that is rescued is not reported (`reportRescuedFailure` returns when `ctx.session.identity.userId` is undefined): `rc:77-78`. **[ref]**.
- A report is dropped, not retried forever, when the intake has failed five times in a row: the intake is tried again after 1, 5, 30 and 120 seconds, then logged "couldn't take request ... after N tries": `rp:164-165`, `rp:226-241`, `t:455-473`. **[ref]** (a number and a failure path).
- A Lab with no reporter: the board's report for an errored task has nowhere to go and is dropped: `t:719-731`, `packages/workforce/src/conversation-board/report-owed.ts:50-93` (`no-reporter` outcome on `flow-not-found`). **[ref]**.

## Change it [page]

What a reader can change, each with its source:

- **Its instructions:** edit the reporter's `WORKER.md`: `wm:8-24`. Telling the reporter how to work ("always label these P2") saves a standing rule that the draft and filing prompts include: `fl:281-292` (`instructionsOf` adds the worker's instructions and the operator's standing rules to the drafting prompt), `fl:731`, `mw:98`. **[verify]** that standing rules also reach the filing prompt: `filePrompt` (`fl:491-517`) adds no rules, only the operator's preview answer; so state only "the drafting run reads them".
- **What gets reported:** `filter` (and, in the preview, `preview.autoFile`): `rp:122-123`, `rp:114-116`.
- **How many, how often:** `limits.*`: `rs:157-173`.
- **What is kept out:** `secrets`.
- **What a report links:** `links`, by label: `rp:126-127`, `rp:434`, `fl:159`. In a Lab, the links are the Lab's: `lab:984` (`links: reportLinks`).
- **Which harness:** the `harness` function: `fl:79-80`; the Lab's is Claude Code with read-only tools: `hm:199-216`. Goal: the real reporter draft uses Claude Code (Agent SDK): `g` (Model).
- **Where it reads the code:** `cwd`: `fl:81-82`, `lab:716`.
- **Which model the conversation turn uses:** `agent` option, and `model` in `WORKER.md`: `fl:85-86`, `wm:4`.

## Examples the page may show (the two the plan names)

1. **Turning it on.** The existing page's example is the base (`mw:44-76`), but fix the flags above before reusing it. A Lab version is shorter and real: `openLab({ errorReporter: { harness: errorReporterHarness, cwd, tracker: { project: "shared/storefront" } } })` (`lab:710-724`; `fsd.fsdev.config.mts:103`; `hm:199`). A complete example needs `installation`, a harness function and the `WORKER.md`. **[verify]** the `createFlowState` `flows` shape before copying `mw:69-73`.
2. **A report as the operator previews it.** Facts available for a concrete, test-backed preview (all from `t:279-302` and `fl:416-447`):
   - heading: `Error report: Coordinator fails on a project with no repository`;
   - message: `Seen 1 time. File it?`, then a `Questions` list with `- Which team?`;
   - answer: `{ decision: "file", instructions: "Put it in the Platform team" }`;
   - after it files, a line in the reporter's conversation: `Filed FIX-9: <title> <url>`: `t:301`, `fl:549`.
   - The draft's body sections: Summary, Steps to reproduce, Expected, Actual, Suspected cause, then `## Context` with `- **Fingerprint:** ...`, `- **Seen:** N time(s)`, `- **Flow / action:** ...`, `- **Block:** ...`, `- **Error code:** ...`, `- **Error:** ...`, `- **Request:** ...`, `- **Session:** ...`, `- **User:** ...`: `fl:173-188`, `fl:136-168`. Fields show only when present: `fl:140`.
   - Goal evidence of a real draft: title like "Project-coordinator judgment turn dies with a raw TypeError ("reading 'split'") when asked for a project's status", labels P1: `g` (Verdict log, 2026-10-14). Keep to the invented example names of the one made-up app, not the goal's real names.
   - In a made-up app, a report's Context lines use the page's one app; ids shown are the exact ones from the store, never invented: `fl:358` (the prompt: "Refer to them, never invent one").

## Cross-links (existing pages the page may link)

- `apps/docs/docs/advanced/error-capture.md`: the `errorCapture` option and the `final` event: `mw:18`.
- `apps/docs/docs/workforce/standing-rules.md`: "Telling it how to work saves a standing rule": `mw:98`.
- `apps/docs/docs/workforce/coordinators.md`, `projects.md` (a project's MCP servers and the tracker project), `overview.md:213` (the existing one-line pointer), `apps/docs/docs/advanced/durable-execution.md` (durable host).
- Reference page for the options table and the status values (`owed`, `drafting`, `previewing`, `filing`, `filed`, `dismissed`, `closed`: `rs:60`): not yet written. **[ref]**.
- The existing page is not in `apps/docs/sidebars.ts` (the `workforce/` list at `sidebars.ts:230-246` omits it); pointed at from `overview.md:213` and `projects.md:710`. The plan says so: nothing to cite. [cut]

## Cut from the existing page (diff-narrative or mechanism; do not carry over)

- The numbered list "From failure to filed issue" (`mw:31-40`) is a four-step mechanism. The page keeps what the reader sees: a draft, a preview, one filing, a retry; the step names (Gathering, Drafting, Preview, Filing) can stay as the page's outline if each is one or two sentences. The claim "A separate run files the issue" is a mechanism; the guarantee is "drafting has no tracker tools".
- Statuses, claims and leases (`CLAIM_LEASE_MS` 30 minutes, `rs:63`), compare-and-set on rows, intake retry waits, the 16,000 character cap, `INTAKE_RETRY_MS`: **[ref]** or cut.
- "the engine's `errorCapture` ... after rescues and retries" is the user-visible guarantee; the `early`/`started` queues in `createErrorReporter` are mechanism: **[cut]**.

## Corrections after round 1

- **Resolved flag 5:** `createFlowState({ flows })` takes `FlowInstance` values. `defineErrorReporterFlow` and `defineErrorReporterIntakeFlow` return a `FlowType`, which is called to make an instance: `packages/core/src/types/flow.ts:857`, `:882-` (callable), `apps/kitchen-sink/fsdev.config.ts:141`. The page's example takes `installation`, `harness`, `mcpTools` as `Pick<ErrorReporterFlowOptions, ...>` and `host: ErrorReporterHost` as parameters, so every name is declared there: `fl:73-87`, `ix:7-41`.
- **Closed report:** the issue is treated as closed only after a counted-comment run reads it completed or canceled and marks the report `closed`; a failure arriving earlier is counted on the existing report: `fl:614-619`, `fl:640-645`, `rs:287`.
- **After dismissal:** a repeat is counted until `dismissedUntil` passes; after that `isLive` is false and a repeat starts a new report: `rs:286-289`.
- **Filed line** ends with the issue URL: `fl:549`.
- **Linear:** the shipped filing prompt says Linear (`fl:502`); no option changes it, so the page states the limit only.
- The "never read by a browser" claim is off the page (it describes the report rows, not the Inbox draft).

## Corrections after round 2

- **Linear only:** the page now says filing goes to Linear (`fl:502`), and the example URL is a Linear one. `tracker.project` names the project whose MCP servers reach it (`rp:106-112`).
- **`host`:** `ErrorReporterHost` is an interface the caller implements (`rp:66-98`); the page says what its methods do and that `conversationSessionId` names the reporter's conversation. No public runtime object is exported that satisfies it; only the Lab builds one (`lab:1419`).
- Scope sentence (one issue, no fix, no pull request) moved to What you get.

## Corrections after round 3

- **Drafting has no tracker tools** (`fl:270-272`, `t:475-483`) stays true but is no longer on the page: it is a mechanism the reader cannot observe. The page's guarantee is that nothing is filed before the operator answers.
- **Count wording:** the page says one report per problem, with a count of 100 for a hundred identical failures (`rs:403-406`, `g` Leg 2).
- **`host`:** `conversationSessionId` is a field on the host (`rp:96-97`), stated as such.
