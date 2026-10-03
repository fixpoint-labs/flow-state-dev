# Shift Manager vs design v2: the gaps

Audit, 2026-10-02 · `origin/main` 48c31cfa6 · read-only, no code changed

1. **The fonts never load.** `labs/design-system/shift-manager.css:52-54` names Space Grotesk and IBM Plex Mono, but nothing declares or fetches them. In Chromium, `document.fonts` is empty, no font request goes out, and "Space Grotesk" measures the same as a font that doesn't exist (198.9px both). Every screen falls back to the system sans. v2 loads both fonts from Google Fonts (v2:12).
2. **The colours are v2's, but most of v2's look isn't there.** There is no monospace for meta text (3 of 40 text leaves on Chief of Staff), and no avatars or state squares. The highlighter appears only on Roster, and the blue accent only on status marks. The sidebar and rails use `card`, the lightest surface, where v2 uses darker `--sidebar` and `--inspector` surfaces. 4px and full corners remain.
3. **The structure matches the epic. The content per screen is thin.** Every screen and section is reachable. But the Stream has no cards, the project board is an empty state, and the task inspector and Inbox detail draw a fraction of v2's fields. Some of these need no sibling, such as Tasks' TIME and ID, the Stream's dots and timestamps, Inbox's *From the session*, and the panel's progress bar.
4. **Of the 59 content gaps, 28 wait entirely on sibling data and 10 more in part.** These need FIX-1650 (projects, org and team names, and seat focus and capacity through FIX-1719), FIX-1651 (NOW, review, acceptance, diff, time and cost, + Task and hand-off) or FIX-1652 (harness, ask payloads and kinds, Deny and undo, the ask-to-task link). The other 21 can be drawn now, and so can almost every look and layout gap. The exceptions are the project board's lanes, which need FIX-1650, and the registry parts, which change at their source.
5. **No existing check would notice any look or layout gap.** The token test and the look goal's *themed* and *neutral* legs check values and the computed font-family **string**, so they pass with the fonts missing. The behaviour goals check data by test id. Approve/Reject buttons and rounded corners inside registry copies can only be fixed at their source (ER-6, FIX-1655).

**Counts** (rows below, one row per gap; ✓ rows and structure rows are not gaps):
| | S | M | L | total |
|---|---|---|---|---|
| look | 32 | 8 | 0 | 40 |
| layout | 8 | 2 | 1 | 11 |
| content | 42 | 16 | 1 | 59 |
| **gaps** | **82** | **26** | **2** | **110** |
| structure-not-adopted | | | | 7 |

**Sources.** v2 = `specs/epics/FIX-1649/assets/design/v2/shift-manager-v2.dc.html` line. Code paths are relative to `labs/shift-manager/src/`. *shot* = `/mnt/project-files/fix-1649-design/audit/shipped-2026-10-02/<name>.png`, rendered by me in Chromium 1600×1000 from a fresh `vite build`, served by `bin/start.mts --team devteam`, day (`day-*`) and night (`night-*`), before and after approving DevTeam's one ask. Font and radius probes: `probe.json`, `probe-task.json` in the same folder. DevTeam declares no chief of staff, so the CoS conversation is read from code, not rendered. Jake's `b3c2ebd9` screenshot predates Roster: it shows no Roster entry, TEAMS listing workers, and "Who is on call arrives with FIX-1723". Everything else in it matches `night-01-chief-of-staff`.

**Needs** = the sibling whose data the gap waits on. **—** = drawable now. FIX-1719 is the seat-data issue inside the FIX-1650 epic. FIX-1675 (watches) and FIX-1474 (also-post) are named where the shipped gap registry already names them.
**Caught by** = an existing check that would fail if the gap were closed wrongly, or that fails today. **T** = `labs/design-system/test/shift-manager.test.ts`. **L** = `goals/shift-manager/it-takes-its-look-from-the-design-system` (themed/neutral/switch). **A** = the behaviour goals and unit tests. **none** = no check would notice.

---

## Sidebar and frame

| # | Element | What v2 draws | What ships | Class | Size | Needs | Caught by |
|---|---|---|---|---|---|---|---|
| F1 | Fonts | Google Fonts `<link>` for IBM Plex Mono 400–600 and Space Grotesk 400–700 (v2:10-12). Body is Space Grotesk (v2:17, 26) | Names only (`labs/design-system/shift-manager.css:52-54`). No `@font-face` and no link (`index.html`, `styles.css:13-18`). Probe: `document.fonts` = [], 0 font requests, "Space Grotesk" width = nonexistent font width (`probe.json`). **Confirmed** | look | S | — | none: L grades `firstFamily(cs.fontFamily)` (`run.mts:340`), which is "Space Grotesk" whether loaded or not. T checks the variable string (`shift-manager.test.ts:47-50`). `document.fonts.check()` also returns true here, because nothing in the set needs loading |
| F2 | Mono for meta | IBM Plex Mono 10–12px for every label, count, id, time, meta line and button across all screens (e.g. v2:30, 42, 60, 65, 76, 107, 113, 135, 185, 215, 562) | `font-mono` in 4 places: the switch (`Sidebar.tsx:119`), file paths (`TaskInspector.tsx:178`) and the two error screens (`App.tsx:61, 78`). Probe: 3 mono leaves of 40 on CoS | look | M | — | none: L accepts either family on any element |
| F3 | Surface hierarchy | Sidebar on `--sidebar` #e7e2d5 / #121109, darker than the page (v2:15-16, 27). Rails and Inbox detail on `--inspector` #f3f0e7 / #1a1913 (v2:183, 314, 438, 593) | Sidebar `bg-card` (`Sidebar.tsx:151`) and panel `bg-card` (`App.tsx:183`): #fcfbf6 / #24231c, *lighter* than the page in both themes. The token set has no sidebar or inspector name (`shift-manager.css:23-95`). shot `day-01`, `night-01` | look | M | — (a token name through FIX-1655) | none: L passes any Shift Manager value |
| F4 | Square corners | Radius 0 everywhere | 4px `rounded` measured on CoS rail rows (`ChiefOfStaff.tsx:296, 333`, `probe.json`), plus `Tasks.tsx:125`, `Board.tsx:36`, `JumpTo.tsx:94`, `Sidebar.tsx:93`. `rounded-full` pills at `Project.tsx:37`. Registry copies carry `rounded-full` ×7 (`components/flow-state/tool.tsx`, `task-plan.tsx`, …) and `rounded-lg` on the ask buttons (`approval.tsx:99`, `suspension-card-shell.tsx:52`) | look | S | — (registry part by FIX-1655, ER-6) | none: T checks only `--radius*` = 0 (`shift-manager.test.ts:51`) |
| F5 | Screen title scale | 18px/700, −0.02em titles (v2:215, 364, 509, 562, 653, 696); 22px on CoS (v2:127); 26px on Inbox detail (v2:597) | `text-base font-semibold` 16/600 (`Workstream.tsx:38`, `TaskFrame.tsx:56`, `Project.tsx:33`, `Inbox.tsx:50`, `Tasks.tsx:37`, `ChiefOfStaff.tsx:42`). Roster's is `text-lg` and matches | look | S | — | none |
| F6 | Worker avatars | Initial squares, 18–40px, ink-filled for manager seats (v2:1128), on feed, panels, Tasks, Inbox, board, Roster, CoS and footer | None anywhere | look | M | FIX-1652 for manager vs harness fill | none |
| F7 | Task state squares | `NODE`: needs = highlighter + ink border, run = blue, review = blue outline, queued = dashed, done = ink (v2:893-896), used on Tasks, the board, panels, task status, acceptance and plan | Task states are words only (`Tasks.tsx:123-126`, `Board.tsx:35`, `Workstream.tsx:180`). Only worker status has a mark (`ui.tsx:85-93`) | look | M | — | none |
| F8 | Right rail width, narrow screens | 340px rail that drops below 1180px wide, with a 900px minimum (v2:26, 1121, 1219) | `w-72` 288px at every width (`App.tsx:183`) | layout | S | — | none |
| F9 | Sidebar width | 248px (v2:26) | `w-64` 256px (`Sidebar.tsx:151`) | layout | S | — | none |
| F10 | Brand header | Logo mark, "Shift Manager" 14/700, mono "Acme · Day shift" (v2:28-31) | Bordered org dropdown with the raw id `org_devforce_lab` (`Sidebar.tsx:73-108, 153`). ER-1 keeps the switcher, so restyle it, don't drop it | layout | S | FIX-1650 for an org display name | none |
| F11 | Jump to | Inline input in the sidebar with a boxed ⌘K, and a dropdown under it: kind column (STREAM/PROJECT/WORKER/task id), label and mono meta, "No matches" (v2:33-48, 1194-1199) | A button opening a centred modal with a backdrop, grouped VIEWS…RESOURCES, "No match." per group (`Sidebar.tsx:154-162`, `JumpTo.tsx:55-56, 81`). shot `night-10-jump-to` | layout | M | FIX-1650 for PROJECT hits | none |
| F12 | Chief of Staff entry | Bordered card row, 18px CS avatar, 600; inverted ink when current; blue dot while it works (v2:52-56, 1176) | Plain `NavItem` (`Sidebar.tsx:165-170`) | look | S | — | none |
| F13 | Nav icons | 14px line icons for Inbox, Tasks and Roster (v2:58, 63, 68) | None | look | S | — | none |
| F14 | Inbox count | Highlighter badge when anything waits (v2:60, 1174) | Muted text (`Sidebar.tsx:50`). shot `night-01` | look | S | — | none |
| F15 | Tasks count | Blue mono (v2:65) | Muted text (`Sidebar.tsx:50`) | look | S | — | none |
| F16 | Current row | Blue tint (`NAVSEL`) and weight 700 (v2:908, 1173) | `bg-accent font-medium` (`Sidebar.tsx:44-46`). `--accent` is v2's tint flattened over `--sidebar`, so on `card` it reads grey | look | S | — | none |
| F17 | PROJECTS tree | Project rows with ▸/▾ caret, needs/live dot and stream count; nested `#` streams on a guide line (v2:76-93) | Heading button, a gap sentence and flat workstream ids (`Sidebar.tsx:195-215`) | content | M | FIX-1650 | A (it-opens-a-lab *PROJECTS* checks the list, not its shape) |
| F18 | Stream dot and `#` | `#` prefix; yellow dot if it needs you, blue if live (v2:88, 1183-1184) | Bare id, no dot (`Sidebar.tsx:202-210`). The counts exist (`streamCounts`, used by the CoS rail) | content | S | — | none |
| F19 | Stream progress | "4/11" done/total (v2:88, 1135) | None. Deferred as `gaps.progress` (`gaps.ts:27-30`) | content | S | FIX-1651 (countable now from rows) | none |
| F20 | TEAMS header | "TEAMS … on shift" (v2:97) | "TEAMS" (`Sidebar.tsx:217`) | content | S | — | none |
| F21 | Team names | "Engineering", "Product" (v2:747) | Team id `eng` (`Sidebar.tsx:232`) | content | S | FIX-1650 (FIX-1719) | none |
| F22 | Footer | Mono "N on shift ◩ M on call" and an MK avatar, nothing else (v2:107-111) | Counts, then "3 sessions · u_devforce_lab" (v1's footer), then the switch (`Sidebar.tsx:253-270`) | content | S | — | A (`sessions-live` and `current-user` test ids) |
| ✓ | Day/Night switch | Mono 11px, ink border, current inverted (v2:113-116) | Matches (`Sidebar.tsx:116-136`) | — | — | — | L *switch* |
| ✓ | TEAMS squares | One square per seat, title = name · status, on-shift/total (v2:98-100) | Matches (`Sidebar.tsx:220-246`) | — | — | — | A (it-shows-who-is-on-shift *TEAMS*) |
| X1 | Resources in Jump to | None (README "Where resources live: No") | RESOURCES group (`JumpTo.tsx:33`) | structure-not-adopted | — | — | — |
| X2 | Streamlined density switch | `streamlined` prop gating `full` (v2:731, 1121) | None. The amendment adopts Chief of Staff, Roster, the TEAMS squares and the switch only | structure-not-adopted | — | — | — |

## Chief of Staff

| # | Element | What v2 draws | What ships | Class | Size | Needs | Caught by |
|---|---|---|---|---|---|---|---|
| C1 | Header | 40px ink CS avatar, "Chief of Staff" 22/700, mono sub "on shift · watching 6 streams and 12 workers" (v2:125-128, 1424) | Eyebrow "CHIEF OF STAFF" and "Your shift" (`ChiefOfStaff.tsx:40-43`). shot `day-01` | look | S | — | none |
| X3 | Brief in the CoS's voice | Opening message "Morning, Mara. 4 things need you. …" as the CoS (v2:134-136, 1406-1408) | "SHIFT SUMMARY · FROM SHIFT MANAGER" box (`ChiefOfStaff.tsx:52-79`). Kept deliberately: FIX-1722 D1 and ER-15 forbid drawing anything in the seat's voice that its session doesn't hold (`ChiefOfStaff.tsx:6-16`) | structure-not-adopted | — | — | A (it-briefs… *summary*) |
| C2 | Summary box look | Unboxed prose in the feed, 16px/1.55 | Bordered card, 14px, eyebrow (`ChiefOfStaff.tsx:57-58`) | look | S | — | none |
| C3 | Ask items | One bordered list. Each item: kind tag (highlighter while pending), question 14.5/600, mono meta "tester · PAY-15 · #payments-api · waiting 6m", mono buttons Approve & run (ink), Deny (bordered), Details; done row "✓ … undo" (v2:138-153, 1410-1416) | Per ask: "eng.em asks · open in Inbox", then the registry `SuspensionCard` with Approve filled and **Reject filled red**, `rounded-lg` (`ChiefOfStaff.tsx:82-99`, `approval.tsx:89-101`). shot `day-01`, `night-01` | look | M | — (FIX-1655 at the registry source, ER-6) | none |
| C4 | Ask item content | Kind (APPROVAL/QUESTION/DECISION), task id, stream, wait, undo | Seat id only | content | M | FIX-1652 (kinds, undo, ask→task); wait and stream drawable now | A (it-briefs… *inline*) |
| C5 | Conversation look | User lines as right-aligned ink blocks 15px; CoS lines labelled "CHIEF OF STAFF 10:22" in 16px prose (v2:129-136) | Bordered section with a seat-id header; registry `ItemRenderer` (`ChiefOfStaff.tsx:180-200, 253-272`). Not rendered: DevTeam has no CoS | look | M | — (registry message, FIX-1655) | none |
| C6 | Action receipts | TASK/SENT/MOVED/APPROVED/DENIED rows with "open →" after a CoS turn (v2:155-163, 1417-1420) | None (whatever the registry draws for the seat's tool items) | content | M | FIX-1719 (the CoS seat's tools) | none |
| C7 | Thinking line | Blue square, "Working out who should take this…" (v2:167-169) | "<seat> is working on it…" (`ChiefOfStaff.tsx:201-205`) | look | S | — | none |
| C8 | Suggestion chips | Dashed chips: "Approve PAY-15", "Who's on call?" … (v2:174, 1421-1422) | None | content | S | — | none |
| C9 | Composer | One-line 16px input, 1.5px ink border, ink ⏎ (v2:175-178). Same pattern on every composer (v2:305-309, 430-433, 639-644) | `TurnComposer`: 2-row textarea, status line, Send button (`TurnComposer.tsx:115-150`), shared by CoS, Task and Inbox | look | S | — | none |
| C10 | Centre column | max 720px, padding 36/32 (v2:123-124) | `max-w-3xl px-6 py-5` (`ChiefOfStaff.tsx:39`) | layout | S | — | none |
| C11 | Rail STREAMS | Header "STREAMS · LIVE · NEEDS YOU"; rows `#` name, project sub, blue square + live count, highlighter square + needs count, dimmed at 0 (v2:185-193) | "eng.feature 0 running · 1 need you" in text (`ChiefOfStaff.tsx:285-307`). shot `night-01` | look | S | FIX-1650 for the project sub | A (it-briefs… counts) |
| C12 | Rail ON CALL | "ON CALL · N", 22px avatar, name 600, mono "what it waits on" (v2:196-202, 1427) | Mark and seat id (`ChiefOfStaff.tsx:318-343`) | content | S | FIX-1675 for watches; asks drawable now | A (it-shows-who-is-on-shift) |

## Workstream

| # | Element | What v2 draws | What ships | Class | Size | Needs | Caught by |
|---|---|---|---|---|---|---|---|
| W1 | Header | "checkout-v2 /" breadcrumb, `#` and name 18/700, boxed WORKSTREAM tag, one-line description (v2:213-217) | Eyebrow WORKSTREAM and the id (`Workstream.tsx:36-39`). shot `day-16` | look | S | — | none |
| W2 | Header content | Breadcrumb to the project; the description | None | content | S | FIX-1650 (breadcrumb); description drawable from the charter | none |
| W3 | + Task | Ink button (v2:218), and `/task` in the composer (v2:308). v1 also has it | Absent. ER-5 wants it drawn disabled with its gap | content | S | FIX-1651 | none |
| W4 | Tabs look | Mono 12px, blue 2px underline, count beside Board (v2:220-223) | Shared `Tabs`: sans 14px, capitalised, ink underline (`ui.tsx:49-79`). Applies to the task and project tabs too | look | S | — | none |
| X4 | Brief and Results tabs, Pause stream | v2 keeps Stream and a Board link only, and drops Pause stream | Stream·Board·Brief·Results (`Workstream.tsx:40-50`). Kept by the amendment. Note: v1's **Pause stream** is also missing, which is a v1 gap, not v2 | structure-not-adopted | — | — | A (it-opens-a-lab *reach*) |
| W5 | Feed rows | TODAY divider; 26px avatar, name 600, mono "time · harness/team", NEEDS YOU highlighter tag (v2:227-232) | Author label and body; no time, avatar or tag (`Stream.tsx:140-147`) | look | M | — | none |
| W6 | Line time and harness | "09:44 · claude-code" (v2:1236) | None. `line.at` is read but not drawn | content | S | FIX-1652 (harness); time drawable now | none |
| W7 | Assignment chips | "PAY-14 → builder", "+7" (v2:237, 1239) | None | content | M | FIX-1651 | none |
| W8 | Receipts | Inline under your message: "↳ sent into PAY-14 · claude-code session · builder acknowledged 10:14"; @mention in blue (v2:241-245) | Separate list at the end, "sent into <title>", gone on reload (`Stream.tsx:151-162`) | content | S | FIX-1652 (harness name) | A (it-sends-a-turn… *receipt*) |
| W9 | ReviewResult card | Verdict, comments and tests stats (v2:248-256) | None | content | M | FIX-1651 | none |
| W10 | Live session card | Blue border while live; id, title, "live · 6m 40s"; tool tail rows; Open session →, Message builder; tokens and cost (v2:258-277) | None | content | L | FIX-1652 (tokens, cost); the run tail is readable now (`lib/run.ts`) | none |
| W11 | Asks in the feed | Ask card inline at its time: kind, id, question, body, Show SQL, Approve & run/Deny/in inbox ↗, done + undo (v2:280-298) | A separate 320px "WAITING ON YOU" column inside the centre, beside the 288px panel (`Stream.tsx:177-195`). shot `day-16` | layout | M | — | A (it-opens-a-lab *answer*) |
| W12 | Composer | One input; mono footer with @live-workers, /task and ⏎ (v2:305-309) | 2-row textarea, status line, Post/Send (`Stream.tsx:285-338`) | look | S | — | A (*post*) |
| W13 | Panel progress | "EPIC PROGRESS · 3/10 DONE" and a bar with one segment per task, coloured by state (v2:315-318, 898-899) | "PROGRESS" and a gap sentence (`Workstream.tsx:131-134`) | content | S | FIX-1651 (countable now from rows) | none |
| W14 | Panel workers | "WORKERS ON THIS STREAM · n ON SHIFT · m ON CALL". Rows: avatar, name, status, what each holds (ids in blue; "waiting on you · PAY-15" highlighted; "+1 elsewhere"), slot pips with free ones dashed, "2/3"; click filters TASKS (v2:319-331, 1250-1258) | "TEAM", id and status word (`Workstream.tsx:136-155`) | content | M | FIX-1719 (capacity); holdings drawable now (`seatStates`) | A (it-shows-who-is-on-shift *status*) |
| W15 | Panel tasks | Non-empty groups NEEDS YOU, RUNNING, IN REVIEW, QUEUED with state squares; rows id, title, step, avatar; ALL/ONLY filter; DONE collapsed with show/hide (v2:332-352, 1259-1269) | All 5 columns in `COLUMNS` order, empty ones included; "title (status)" links; DONE expanded (`Workstream.tsx:156-189`, `columns.ts:16`). shot `day-17` | content | M | FIX-1651 (step) | none |

## Task session

| # | Element | What v2 draws | What ships | Class | Size | Needs | Caught by |
|---|---|---|---|---|---|---|---|
| T1 | Breadcrumb | Mono "checkout-v2 / #payments-api / PAY-14" (v2:363) | "TASK · eng.feature.work", linking the board (`TaskFrame.tsx:50-55`). shot `night-18` | content | S | FIX-1650 | none |
| T2 | Status line | State square, "running 6m 40s" coloured, worker, boxed harness, "⎇ branch" (v2:365) | "completed · DONE · eng.coder · attempt 1", elapsed (`TaskFrame.tsx:59-64`) | content | S | FIX-1652 (harness), FIX-1651 (branch) | A (it-shows-and-stops… *status*) |
| T3 | Header actions | Interrupt/Resume and Hand off bordered, one ink primary; reassign lives in the inspector (v2:367-371, 444) | Interrupt, then disabled Hand off/Reassign/Open PR, with a gap sentence line under them (`TaskFrame.tsx:118-165`) | layout | S | FIX-1651 (hand off, reassign) | A (*interrupt*) |
| X5 | Open PR vs Open #stream; Diff/Checks/Brief tabs; brief and diff inside the session | v2 drops Open PR and the tabs; brief card at the top and diffs inline (v2:370, 377-396) | Open PR (disabled) and four tabs (`TaskFrame.tsx:72-87, 147`). Kept by the amendment | structure-not-adopted | — | — | A (*reach*) |
| T4 | Narration and tool rows | Narration 14/1.6; tool rows as a mono grid (dot · tool · target · result), live row blue (v2:383-390) | Registry message, reasoning and tool cards (`TaskSession.tsx:166-178`). shot `night-18` | look | M | — (FIX-1655 at source, ER-6) | L *themed* (colours only) |
| T5 | Inline diff | Diff hunk with red/ink lines (v2:391-396) | None. The Diff tab is a gap (`gaps.ts:43-46`) | content | M | FIX-1651 | none |
| T6 | Your messages | Blue left rule, avatar, "Mara K. · from #payments-api · 10:14" (v2:397-402) | Registry user message | look | S | — (registry) | none |
| T7 | Ask in the session | Inline ask card, highlighter kind tag, Approve/options (v2:404-423) | "Waiting on you: answer it in Inbox" link (`TaskSession.tsx:169-172`) and a parked banner (`TaskSession.tsx:84-90`) | content | M | — (`AskCard` exists) | A (it-hands-a-run…) |
| T8 | Notes | "Not started · after PAY-15"; "Session closed · merged…" (v2:403, 1281, 1286) | Centred empty state (`TaskSession.tsx:36-47`) | content | S | FIX-1651 (merge/deps) | none |
| T9 | Activity line | Dot, "builder · write src/lib/idempotency.ts", "esc to interrupt" above the composer (v2:429) | A run-state word in the header (`TaskFrame.tsx:134-140`) | content | S | — | none |
| T10 | Composer | Mono footer /interrupt /handoff; square "also post to #ws" box; ⏎ (v2:430-433) | `TurnComposer` with a native checkbox, disabled (`TaskFrame.tsx:229-243`) | look | S | FIX-1474 (also-post) | none |
| T11 | Inspector head | "TASK PAY-14 ✕"; 28px avatar, name and focus, slot pips, "2/3 slots", status; reassign; hand-off picker with free slots (v2:439-457) | WORKER: seat id and "team eng" (`TaskInspector.tsx:51-58`) | content | M | FIX-1719 (focus, capacity), FIX-1651 (reassign) | A (*worker*) |
| T12 | Facts grid | 2×2 mono: harness, started, time, cost (v2:459-461) | STARTED as `toLocaleString()` "10/2/2026, 12:06:17 PM", plus a HARNESS·TOKENS·COST gap section (`TaskInspector.tsx:59-66`) | layout | S | FIX-1652 (harness, cost); time drawable now | none |
| T13 | Needs banner | Highlighter "approval waiting 6m · inbox ↗" (v2:462-464) | None in the inspector | content | S | — | none |
| T14 | Acceptance | Criteria ticked with state squares (v2:465-472) | Gap text (`TaskInspector.tsx:67-70`) | content | M | FIX-1651 | none |
| T15 | Harness plan | Timeline: squares joined by lines, durations, "from claude-code" (v2:473-484) | "status title" list or a gap (`TaskInspector.tsx:156-170`) | look | S | FIX-1652 (durations; harnesses that record none) | none |
| T16 | Files | Boxed list with "+42 −8" stats, new files in blue (v2:485-492) | Path and kind (`TaskInspector.tsx:171-185`) | content | S | FIX-1651 (diffstat) | none |
| T17 | Linked | Mono k/v: after, blocks, review by (v2:493-500) | After/Blocks lists of titles; review-by gap (`TaskInspector.tsx:80-108`) | look | S | FIX-1651 (review by) | A (*linked*) |
| X6 | Trace link | Not drawn | TRACE section (`TaskInspector.tsx:109-111`). The epic requires it ("full trace stays in the devtool, one link away") | structure-not-adopted | — | — | A |

## Project board

| # | Element | What v2 draws | What ships | Class | Size | Needs | Caught by |
|---|---|---|---|---|---|---|---|
| P1 | Header | `#` name 18/700, ink-filled PROJECT tag, description (v2:508-511) | Eyebrow PROJECT and "All workstreams" (`Project.tsx:30-34`). shot `day-07` | content | S | FIX-1650 | A (*reach*) |
| X7 | Tabs, + Team, + Workstream | No tabs; no + Team or + Workstream | Stream·Board·Workstreams·Brief (`Project.tsx:43`). Kept. Note: v1's + Team and + Workstream are also missing | structure-not-adopted | — | — | A (*reach*) |
| P2 | Team strip look | Mono caps team name, 20px avatars with stacked slot pips, "n on shift · m on call", summary right "11 tasks · 5 live · 1 need you" (v2:512-522) | `rounded-full` pills "eng 3" at the top right (`Project.tsx:35-41`) | look | S | — | none |
| P3 | Team strip content | Per-member pips and status; project summary | Team and seat count only | content | M | FIX-1719 (capacity), FIX-1650 (project scope) | none |
| P4 | Swimlane board | 168px lane column and 5 columns ≥150px; lane head `#` name, segmented progress, "3/10 done · 5 workers"; RUNNING tinted blue (v2:524-553, 1332) | Empty state "No project board yet" (`Project.tsx:45-47`, `gaps.ts:11-14`). Lanes per workstream could be drawn over `NO_PROJECT` now | layout | L | FIX-1650 | A (*reach*: the named empty state) |
| P5 | Column order and headers | QUEUED·RUNNING·**IN REVIEW·NEEDS YOU**·DONE, state square and count (v2:528, 1327) | Workstream Board tab: QUEUED·RUNNING·**NEEDS YOU·IN REVIEW**·DONE, text headers (`columns.ts:16`, `Board.tsx:17-20`). shot `day-17` | content | S | — | none (`columns.test.ts` checks mapping, not order) |
| P6 | Cards | id and NEEDS YOU highlighter tag; title 13/500; avatar and step, blue when live (v2:540-544) | Title, then "status · assignee", plus an orange `rounded` "blocked" badge (`warning`, a colour v2 never uses) (`Board.tsx:25-40`) | look | S | FIX-1651 (step) | none |
| P7 | DONE | One-line "id title" rows (v2:546-548, 1336) | Full cards (`Board.tsx:23-41`) | layout | S | — | none |
| P8 | Grid | Hairline cell borders, no fill except RUNNING (v2:526-538) | `bg-muted/50` column boxes with gap-3 (`Board.tsx:13, 17`) | look | S | — | none |

## Inbox

| # | Element | What v2 draws | What ships | Class | Size | Needs | Caught by |
|---|---|---|---|---|---|---|---|
| I1 | List pane | 400px (v2:559) | `w-96` 384px (`Inbox.tsx:48`) | layout | S | — | none |
| I2 | Header | "Inbox" 18/700, mono "4 waiting · oldest 42m" (v2:562, 1349) | h1 and the scope paragraph (`Inbox.tsx:50, 66-68`). shot `night-03` | content | S | — | none |
| I3 | Filter tabs | Mono 12, blue underline, count in ink4 (v2:563-565) | Pill buttons `bg-accent` (`Inbox.tsx:51-65`) | look | S | — | A (filter counts) |
| I4 | Scope paragraph | None | "Inbox lists the asks in sessions you started…" (`gaps.ts:96-97`) | content | S | FIX-1652 (org-wide view) | A (`inbox-scope`) |
| I5 | List item look | Highlighter square, boxed mono kind tag, selected item with inset blue bar on card (v2:569-577, 1353) | Plain word "Approval"; selected `bg-accent` (`Inbox.tsx:80-101`) | look | S | — | none |
| I6 | List item content | "PAY-15 · #payments-api"; asker and team "tester · Engineering"; wait "6m" | "eng.em · **task —** · eng.feature", "waiting 22s" | content | S | FIX-1652 (ask→task); team drawable now | A (it-opens-a-lab *Inbox*) |
| I7 | DECISION kind | APPROVAL, QUESTION, DECISION (v2:808) | approval or question (`Inbox.tsx:91`) | content | S | FIX-1652 | none |
| I8 | Empty state | "Nothing needs you. N sessions are still running and M workers are on call." (v2:579, 1354) | "Nothing is waiting on you / No seat in this Lab…" centred (`Inbox.tsx:71-73`) | content | S | — | A (`inbox-empty`) |
| I9 | RESOLVED TODAY | Ink square, question, "✓ Approved by you", id; reopen to undo (v2:580-589) | None | content | M | FIX-1652 (undo); the list itself is readable from `suspension_resume` now | none |
| I10 | Detail head | Kind tag highlighted until resolved; "PAY-15 · task title"; right "checkout-v2 / #payments-api" (v2:596, 1359) | "eng.em asked, in session s_eng_em" (`Inbox.tsx:113-115`) | content | S | FIX-1652 (task), FIX-1650 (project) | none |
| I11 | Detail title | h2 26px/700/−0.03em (v2:597) | The question, bold 14px, inside the registry card (`AskCard.tsx:38`) | look | S | — | none |
| I12 | Worker block | 28px avatar, name and "focus · team"; mono "claude-code · asked 10:16 · on call" (v2:598-601) | None | content | S | FIX-1719 (focus), FIX-1652 (harness); asked and status drawable now | none |
| I13 | Body and code | 15px explanation, separate from the question; SQL block (v2:602-605) | One message string | content | S | FIX-1652 (ask payload) | none |
| I14 | Approve/Deny | "Approve & run" ink, "Deny" bordered, "⌘⏎ approve" hint (v2:606-608); question options with the first inverted (v2:609-614) | Registry: Approve filled, **Reject filled red**, `rounded-lg`, no shortcut (`approval.tsx:89-101`). shot `night-03` | look | S | FIX-1652 (labels); FIX-1655 (look at source) | A (*answer*) |
| I15 | Done + undo | "✓ Approved by you · migrate · 1 of 3" and undo (v2:615-617) | The ask disappears (`AskCard.tsx:1-12`) | content | S | FIX-1652 | A (*inline*) |
| I16 | What waiting costs | "Waiting 6m · blocks PAY-17" (highlighter); "tester is on call until you answer" (blue) (v2:618-623) | None | content | S | FIX-1651 (blocks); wait and status drawable now | none |
| I17 | FROM THE SESSION | The ask session's last 3 tool calls, ending at the ask (v2:624-633) | None | content | M | — (session items are readable, `lib/run.ts`) | none |
| I18 | Your replies | Blue rule, "You · 10:31 · sent into the PAY-15 session" (v2:634-636) | "Delivered." in the composer status (`TurnComposer.tsx:61`) | content | S | — | A (it-sends-a-turn…) |
| I19 | Reply composer | "Reply to tester. Goes into the PAY-15 session."; "open task →", "open #payments-api" (v2:639-644, 1367) | Bordered `TurnComposer`, "Reply to eng.em…", blocked reason (`Inbox.tsx:151-165`) | content | S | FIX-1652 (open task) | A |

## Tasks

| # | Element | What v2 draws | What ships | Class | Size | Needs | Caught by |
|---|---|---|---|---|---|---|---|
| K1 | Header | "Tasks", boxed ALL STREAMS tag, mono "16 in flight · 4 need you · 9 on shift · 3 on call · 6 streams" (v2:651-655, 1384) | "Tasks" and per-column counts (`Tasks.tsx:36-47`). shot `day-12` | content | S | — | A (`tasks-summary-*`) |
| K2 | Group by | "GROUP BY" label and an ink-bordered segmented control, current inverted (v2:656-658) | Pill tabs `bg-accent` (`Tasks.tsx:48-62`) | look | S | — | none |
| K3 | Queued toggle look | Bordered button with a square box, "Queued 5" (v2:659) | Native checkbox, browser blue, not a token (`Tasks.tsx:63-66`) | look | S | — | none (L doesn't see native control paint) |
| K4 | Queued default | Hidden by default (v2:916 `queued: false`), count shown | Shown by default, no count (`Tasks.tsx:21`) | content | S | — | A |
| K5 | Columns | state square · ID · TASK · NOW · STREAM · WORKER · TIME · COST (v2:662) | TASK · STATE · WORKER · STREAM · NOW · TIME · COST; no ID; raw `in_progress` (`Tasks.tsx:84-100, 123-126`) | content | S | — | A (rows by test id) |
| K6 | Groups | NEEDS YOU, RUNNING, IN REVIEW, QUEUED; empty groups dropped; state squares; worker groups with avatar, "focus · team", status, pips, "n of cap slots"; stream groups `#name` and project (v2:666-673, 1377-1382) | QUEUED, RUNNING, NEEDS YOU, IN REVIEW, empty ones shown; "KEY n" text (`Tasks.tsx:29-32, 102-111`) | content | S | FIX-1719 (focus, capacity), FIX-1650 (project) | none |
| K7 | NOW and COST | "approval · db write" (highlighter when it needs you), "$0.52" (v2:679, 683) | "—" with gap titles (`Tasks.tsx:129-137`) | content | M | FIX-1651 (NOW), FIX-1652 (cost) | none |
| K8 | TIME | Live elapsed "6m 40s" (v2:682, 1134) | "—" (`Tasks.tsx:133`), though the task header already computes elapsed from `startedAt` (`TaskFrame.tsx:93-101`) | content | S | — | none |
| K9 | Row look | Mono id, 13.5 title, `#stream` mono with project tooltip, avatar and name (v2:675-684) | Sans `text-xs` cells, raw seat id, orange `rounded` "blocked" badge (`Tasks.tsx:114-139`) | look | S | — | none |

## Roster

FIX-1723 built Roster to v2. These are the closest-matched screens: the title "Night shift · eng" with the ROSTER tag, the segmented team picker, and grouping by on shift, on call and off shift all match. shot `night-15`, `day-05`.

| # | Element | What v2 draws | What ships | Class | Size | Needs | Caught by |
|---|---|---|---|---|---|---|---|
| R1 | Column header | "WORKER · SLOTS · HOLDING · ON CALL FOR" (v2:701) | None (`Roster.tsx:182-199`) | content | S | — | none |
| R3 | Worker line 2 | "focus · harness" (v2:709) | "kind · —" (`Roster.tsx:42-48`) | content | S | FIX-1719 (focus), FIX-1652 (harness) | A (it-shows-who-is-on-shift) |
| R4 | Slots | Pips up to capacity with free ones dashed, "2/3 slots" (v2:710, 1126) | Filled squares for used slots, "n in use" (`Roster.tsx:50-63`) | content | S | FIX-1719 (capacity) | A (*slots* asserts "n in use") |
| R5 | Holding chips | State square in each chip; tooltip "title · step" (v2:712) | Id chip, highlighter on parked (`Roster.tsx:64-84`) | look | S | FIX-1651 (step) | A (*holding*) |
| R6 | On call for: tag look | 66px boxed tag; WAITING on the highlighter; what/when on two lines (v2:716-719, 1393) | "approval <message>" inline text (`Roster.tsx:98-103`) | look | S | — | A (*waits*) |
| R7 | On call for: watches | WEBHOOK, ROUTINE, WAIT, NOTIFY entries (v2:813-821) | Gap notes at the foot (`Roster.tsx:200-203`) | content | M | FIX-1675 | none |
| R8 | Group sub copy | "holding live work" · "subscribed and waiting · wakes on a trigger" · "nothing assigned, nothing subscribed" (v2:705, 1392) | Status and count only (`Roster.tsx:187-191`) | content | S | — | none |
| R9 | Summary tail | "… · 7 active subscriptions" (v2:1396) | "… · 0 waiting on you · read 12:05:21 PM" (`Roster.tsx:148-152`) | content | S | FIX-1675 | A (*summary*) |

---

## Gaps that wait on a sibling epic

*Can't be drawn yet* means the data is not shipped. *Shippable now* means the shell decided to defer it, but the data is already in the snapshot or one read away.

| Sibling | Can't be drawn yet | Shippable now (the shell defers it today) |
|---|---|---|
| **FIX-1650** (projects, org; FIX-1719 seats) | PROJECTS nesting (F17), project board lanes per project (P4), project header and summary (P1, P3), breadcrumbs (W2, T1, I10), the project sub on the rail (C11), PROJECT hits in Jump to (F11), team and org display names (F10, F21), seat focus and capacity everywhere (W14, T11, K6, R3, R4, I12), CoS action receipts through the CoS seat's tools (C6) | Lanes per **workstream** over `NO_PROJECT` (P4) |
| **FIX-1651** (tasks, states, board, brief, results) | NOW step (K7, W15, P6, R5), IN REVIEW, review cards (W9), acceptance (T14), diff (T5), diffstat (T16), assignment chips (W7), + Task and /task (W3), hand off and reassign (T3, T11), blocks (I16), review by (T17), notes (T8), branch (T2) | Progress bar and stream "n/m" (W13, F19: count done rows), TIME (K8: `startedAt`), the ID column (K5) |
| **FIX-1652** (attention, harness visibility) | Harness on every line (W6, W8, T2, T12, R3, I12), tokens and cost (W10, K7, T12), plan durations (T15), the DECISION kind (I7), ask payload with body and SQL (I13), Approve & run / Deny labels and undo (I14, I15, I9, C4), the ask→task link (I6, I10, I19, C4), the org-wide Inbox (I4), manager vs harness avatar fill (F6) | The RESOLVED TODAY list without undo (I9), FROM THE SESSION (I17) |
| outside the three | FIX-1675 watches (C12, R7, R9); FIX-1474 also-post (T10) | |

Everything else (all look and layout rows except P4, and the content rows marked **—**) can be drawn now.

## Would an existing check notice?

| Check | What it can catch | What it misses |
|---|---|---|
| **T** `labs/design-system/test/shift-manager.test.ts` | Token values, `--radius*` = 0, attention used by one token only | Fonts not loading (F1); radius from a fixed class (F4); which token a surface uses (F3); whether the highlighter appears where v2 puts it (F14, I5, P6…) |
| **L** `it-takes-its-look-from-the-design-system` (*themed*, *neutral* = the closure's leg c, *switch*) | A painted colour that isn't a Shift Manager value; a font-family string that names another family; the switch | Every look and layout row above. It reads `firstFamily(fontFamily)` (`run.mts:340`), so F1 passes; it accepts any palette value on any element, so F3 passes; it ignores radius, size and position; native checkboxes (K3, T10) paint outside computed style |
| **A** behaviour goals (`it-opens-a-lab`, `it-briefs…`, `it-shows-who-is-on-shift`, `it-sends-a-turn…`, `it-shows-and-stops…`, `it-hands-a-run…`) and unit tests | Data equality and reach by test id | Rows marked **A** are the ones whose test ids and copy those checks pin. Changing that copy (F22, I4, I8, K1, K4, R4, R9) will break a check on purpose, so update it with the change. Nothing in A asserts v2's content (ids, avatars, NOW, order) |

**So:** none of the 40 look rows or 11 layout rows has a check today. Closing them would need a layout or visual check against v2: for example, a computed-style probe per element (font actually loaded, mono on meta, radius 0 on every element, highlighter only on needs-you elements), or screenshot diffs against a v2 render once someone has `support.js`.

## Notes

- **States v2 doesn't draw** (loading, failed with Retry, partial marks, the refusal and unreachable screens) are the epic's own rules (ER-5, BR-11) and are not counted as gaps. They need a look in v2's language, which v2 doesn't give.
- **Registry parts.** The Approve/Reject buttons, message, tool and reasoning cards are unedited registry copies (ER-6). Their `rounded-lg`/`rounded-full`, filled red Reject and card layout can only move at the registry source (FIX-1655) and then be re-synced. Rows C3, C5, T4, T6 and I14 depend on that.
- **Fonts, the fix in one line.** Load both families from the design-system package (self-hosted `@font-face`, or v2's Google link). Then removing that one import also removes the fonts, and leg c stays honest. A guard should check that the face *loaded* (`document.fonts` has it with status `loaded`, or a width differs from the fallback), not the family string.
