# Facts for Chat with a flow from the terminal (B-29, recipe)

Every fact the page may state, with file and line. Sources are limited to what a fact sheet may cite: existing user docs, the exported surface and its doc comments, tests, `goals/`, one example. No spec, no `docs/internal/`, no `CLAUDE.md`, no `docs/architecture/`. Nothing here was run: this checkout has no built `dist` for `fsdev`, so every behaviour is read from source and tests, marked **[source]**. A claim a test pins is marked **[test]**.

Paths are from the repo root. Abbreviations:

- `loop` = `packages/fsdev/src/chat/loop.ts`
- `reg` = `packages/fsdev/src/chat/registry.ts`
- `st` = `packages/fsdev/src/chat/state.ts`
- `tg` = `packages/fsdev/src/chat/targets.ts`
- `pa` = `packages/fsdev/src/chat/parse.ts`
- `rn` = `packages/fsdev/src/chat/render.ts`
- `turn` = `packages/fsdev/src/chat/turn.ts`
- `cmd` = `packages/fsdev/src/commands/chat.ts`
- `pr` = `packages/fsdev/src/principal.ts`
- `ls` = `packages/fsdev/src/local-store.ts`
- `cct` = `packages/fsdev/test/chat-command.integration.test.ts`
- `cpt` = `packages/fsdev/test/cli-principal.integration.test.ts`
- `clt` = `packages/fsdev/test/chat-local-store.integration.test.ts`
- `ic` = `apps/docs/docs/cli/interactive-chat.md` (the page this one replaces; kept per the sitemap)
- `api` = `apps/docs/docs/api/cli.md`
- `cfg` = `apps/docs/docs/cli/configuration.md`
- `dt` = `apps/docs/docs/devtool/overview.md`
- `hc` = `examples/hello-chat` (the one example that uses it)

Legend: **[page]** the page states it. **[ref]** it belongs on `reference/cli`; the page links, does not state it. **[verify]** not confirmed against running code; keep off the page or soften. **[contradiction]** two sources disagree; the ruling is given. **[answers]** the sitemap question "How do you resume yesterday's session?".

## Read this first: what the page must not say, and corrections

1. **"A conversation survives restarts" is true only on a store that persists. [contradiction: the code wins.]** `ic:53` says history persists in `.fsdev/data/fsdev.db`, "so a conversation survives restarts of the session". That is the no-config path only (`cmd:195-217`, `ls:27-28`). With an `fsdev.config.ts`, chat uses the app's own stores (`cmd:184`, `cmd:187` prints `app-configured stores`), and a `createFlowState` with no `stores` option runs in memory (`packages/engine/src/flowstate/types.ts:170-172`: "omitted: in memory ... Nothing persists across a restart"; `packages/engine/src/flowstate/createFlowState.ts:234`). The example app `hc` is exactly that: `examples/hello-chat/fsdev.config.ts:17-22` passes `flows` and `onError` and no `stores`. So yesterday's session resumes only under directory discovery, or a config that sets a persistent store. **[page: say this in one sentence in the resume step; it is the answer to the sitemap question's failure case.]**
2. **`--store` is not a `fsdev chat` flag.** The option list (`cmd:47-56`) has no `--store`, and the no-config path always opens SQLite: `openLocalStores()` with the default kind (`cmd:212`; default `"sqlite"`, `ls:66`). `ic` and `api:212-223` list no `--store` either. The page does not offer a choice of store. **[page]**
3. **`ic:53` says a held turn tells you to "answer it in `fsdev dev`". That holds only under discovery.** The notice text comes from `answerAt`: `"Answer it in fsdev dev, which reads this store: <dataLine>."` on the discovery path (`cmd:214`), `"Answer it in a server on these stores."` on the config path (`cmd:165`). **[ref: the page's scope is not suspensions; if it mentions a held turn, link `build/human-in-the-loop` and say only "the session prints one line naming what it waits for".]**
4. **A `--session` id that does not exist is not rejected.** The startup guard rejects a session only when a stored record belongs to another flow, or completed request history under that id belongs to another flow (`cmd:262-282`). A missing record passes (`cmd:267-268`: `record !== undefined &&`). `/session <id>` says so in its source comment: "A nonexistent id is allowed — the engine creates the record on the first turn" (`reg:149-150`). Startup then prints `(session <id>, resumed)` even for an id that has no record (`cmd:310`). **So a mistyped id starts a new, empty session and says "resumed".** **[page: one sentence. This is the edge case a reader hits.]** [source]
5. **The sample session on `ic:67-83` is accurate in shape**, with one note: real ids look like `sess_<millisecond timestamp>_<hex>` (`st:311-313`), not `sess_a1b2c3`. The `/status` lines match `reg:114-124` (`Target:`, `Session:`, `Turns:`, `Org:`, `Source:`, `Store:`). With a config, `Source:` is `config (<config path>)` and `Store:` is `app-configured stores` (`cmd:187`); under discovery, `Source:  discovery` and `Store:   .fsdev/data/fsdev.db (SQLite)` (`cmd:217`). The page's one transcript should use a made-up id and say nothing about the exact digits.

## The page's one app

Per `user-docs.md` "Code examples", the page uses the support-desk app. A chat target must accept `{ message: string }` (`turn:313`). The facts below name no flow of the app; the page picks a flow that takes `{ message }`, for example a `support` flow with a `reply` action whose input is `z.object({ message: z.string() })`. The `hc` example (`examples/hello-chat/src/flows/hello-chat/flow.ts:43-45`, `:100-113`) and `packages/fsdev/test/fixtures-chat/flows/chatbot/flow.ts` are chat-shaped; `fixtures-chat/flows/strict/flow.ts` is not (its input is `{ ticket }`). **[page: `ts` blocks with a title and every name imported or declared. The page needs at most one flow file, and only if it shows a flow at all; the commands are the page.]**

Flows are found from `src/flows/` and `flows/` unless an `fsdev.config.ts` is in the cwd (`ic:19`; `cmd:151-156`, `resolveRuntimeSource`; `cmd:196-201` the error text for none found). `--flow-dir` with a config is an error (`cmd:171`; `api:218`). **[ref]**

## Step 1: start a chat

1. **Command.** `fsdev chat [flow] [action]` (`cmd:45`). Both positionals are optional. The flow positional is the flow's kind (`tg:355-356`, "the instance's global id (a singleton's kind)"). **[page]** In a project that runs it through the package manager the docs write `pnpm fsdev chat hello-chat chat` (`ic:16`, `api:207`). **[page: same form]**
2. **The flow and action become the default target**: where typed text goes (`st:290-291`; `ic:19`). **[page]**
3. **What starts unbound or bound** (`cmd:116-138`):
   - positional flow given: that flow, with the action if given. An unknown flow is an error naming the flows available, exit code 4 (`cmd:127`, `exit-codes.ts:18`). An unknown action: error naming the actions, exit 2 (`cmd:129`). A flow with several actions and no action named: error `Flow "<flow>" has multiple actions: ... Specify one: fsdev chat <flow> <action>`, exit 2 (`cmd:131`; `cct:113-124`). **[test]**
   - no positional and `chat: { default }` set on `createFlowState`: binds that, `"<flow>"` or `"<flow>.<action>"` (`cmd:99-112`, `cmd:134`; `packages/engine/src/flowstate/types.ts:386-391`). A bad default is a config error, exit 3 (`cmd:107-111`). **[page: one sentence; the full rules are [ref].]**
   - exactly one target in the whole project: binds it (`cmd:136`; `cct:107-111`). **[test]**
   - otherwise starts unbound (`cmd:137`).
   - no targets at all: `No flow targets available to chat with.`, exit 4 (`cmd:225-227`); with no flows discovered and no config, `No flows found. Searched: ...` exit 4 (`cmd:196-201`; `cct:78-88`). **[page: "no flows at all is an error, not an empty prompt"]** **[test]**
4. **The opening lines** (`cmd:304-318`): bound: `Chatting with <flow> · <action> (session <id>).`, then `Type /help for commands, /exit to quit.` Unbound: `No default target bound. <n> target(s) available — /targets to list, /use <flow> to bind.` then the same second line. **[page: shows the first line, since it carries the session id the resume step needs.]** [source]
5. **The session id is minted at bind time**, before any turn, in the form `sess_<ms>_<hex>` (`st:310-313`, `st:322-332`). The comment gives the reason a reader can observe: a turn never runs under an engine-minted `ephemeral_` id, which would not keep history across turns (`st:315-321`; `cct:126-138` asserts the session id starts `sess_` and none starts `ephemeral_`). **[page: "the session id is printed when you start"; the `ephemeral_` mechanism stays off.]** **[test]**
6. **A message** is any line that does not start with `/` (`pa:262-264`, `pa:280`). It is sent to the default target as `{ message: "<text>" }` (`turn:313`; `ic:30`). The reply streams as the model produces it (`rn:129-138`); a provider that does not stream prints the reply once when it finishes (`rn:139-151`; `chat-render.test.ts:135`). Each turn is one run of the action. **[page]** [test for render]
7. **What prints besides the reply.** Tool calls print one line `· tool call: <name>`; status items `· status: <message>`; errors `· error: <message>` (`rn:49-56`). Reasoning, traces, sources and the echo of your own message are not printed (`rn:57-61`; `chat-render.test.ts:33-48`). An aborted turn prints `(interrupted)` (`rn:163`). **[ref: the rendering rules; the page may say "tool calls and errors print as one-line notes".]**
8. **In-flight status line.** A transient status (a block's "what is running now") overwrites one line in a TTY and prints nothing when piped (`rn:109-120`; `chat-render.test.ts:77-102`). **[ref]** (`ic:34`)
9. **An empty or whitespace-only line does nothing** (`pa:268`; `tg:428-429`). A lone `/` or an unreadable command prints `type /help for commands` (`tg:431-433`; `pa:275-277`). **[ref]**
10. **A target that is not chat-shaped.** If the action's input schema rejects `{ message }`, the turn fails with the validation error plus: `That target isn't chat-shaped (its action rejected { message }). Pick another with /use, or /targets to list them.` and the session stays open (`turn:199-201`, `turn:322-327`, `turn:337-343`; `cct:179-186`). **[page: one sentence in Step 1 or Step 3; the matcher is the phrase `input validation failed` in the error message (`turn:249`), which stays off the page.]** **[test]**
11. **Leaving.** `/exit`, Ctrl-D, or two Ctrl-C presses in a row while idle (`reg:159-164`; `loop:7-11`, `loop:66-68`, `loop:101-113`). The first idle Ctrl-C prints `(press Ctrl-C again or /exit to quit)` (`loop:110`). Ctrl-C **during** a turn aborts that turn and keeps the session open (`loop:7-11`, `loop:199-207`; `turn:278-303`; `chat-turn.integration.test.ts:82-112`, `:190-234`: a turn after an abort still succeeds). The aborted turn prints `(interrupted)` and is not counted as an error (`turn:348-349`; `rn:163`). **[page: "Ctrl-D or `/exit` leaves; Ctrl-C stops the turn that is running".]** **[test]**
12. **Exit code.** On a terminal, leaving always exits 0. With piped stdin, the command exits 1 if any turn failed, any built-in failed, or text was sent with no target bound (`loop:235-238`, `loop:124-129`, `loop:134-136`; `cct:70-76`, `:174-186`). A turn held on a stop is not a failure (`clt:77-78`). **[ref: `reference/cli`; skip on the page unless it shows piped use.]** **[test]**
13. **Who the turns run as.** Asked once per turn, for that turn's flow, as `fsdev run` asks (`loop:164-175`; `cmd:329-336`). With no resolver anywhere, the user is `devuser` (`pr:30`, `core/src/types/auth.ts:47`) in `__fsd_default_org__` (`core/src/types/auth.ts:39`), the user the DevTool defaults to (`cfg:135`; `ic:55`). `--user <id>` names the user; `--org <id>` names the organization and skips the resolver (`cmd:49-50`); that is how it gets past a resolver that refuses the terminal (`cfg:148-150`: "Pass --org <id> to name the organization yourself"). A flow whose resolver refuses the terminal fails that turn only; the session continues; the message names the flow and `--org` (`cfg:148-150`; `cpt:402-426`). **[page: one sentence and a link to `cfg#who-a-run-is`; the detail is [ref].]** **[test]**

## Step 2: continue a session (the sitemap question)

How do you resume yesterday's session? Four facts the answer needs.

14. **Find the id.** It prints on the first line of every chat (`cmd:313`), and again from `/status` (`reg:115`) and `/session` with no argument (`reg:138-141`). There is no `fsdev` command that lists sessions (the subcommands are `benchmark`, `block`, `chat`, `dev`, `gen`, `run`, `serve`, `ui`, `list`, `add`, `worktrees`; `packages/fsdev/src/commands/*.ts`, `.command(` calls; `ui add` and `ui list` belong to `ui`). The DevTool lists a flow's sessions for the user and shows the open one's id (`dt:85`), and a chat run under discovery shows in that list because it runs as `devuser` (`ic:55`; `clt:65`). **[page: "copy the id from the opening line, `/status`, or the DevTool's session list". Do not claim a `fsdev` command lists sessions.]**
15. **Resume at startup.** `fsdev chat <flow> <action> --session <id>` (`-s`) (`cmd:47`; `api:214`; `fsdev` README line 221 shows `fsdev chat hello-chat chat --user devuser --session sess_abc`). The first line then reads `Chatting with <flow> · <action> (session <id>, resumed).` (`cmd:310`). **[page]**
16. **`--session` needs a bound target.** With no positional flow, no `chat.default` and more than one target, `--session` is an error: `--session requires an initially bound target. Pass a positional flow (fsdev chat <flow> [action]), or bind one with /use and then /session <id>.` exit 2 (`cmd:289-295`; `cct:188-199`). **[page: give the fix: name the flow, or `/use` then `/session <id>`.]** **[test]**
17. **Resume inside a running chat.** `/use <flow>` then `/session <id>` binds the id to that flow; it prints `Bound session: <id>.` (`reg:149-155`). `/session` needs a bound target (`reg:135`: `No target bound. Use /use <flow> first.`). **[page]**
18. **What a session id can be bound to.** An id whose stored record belongs to a different flow is refused: `Session <id> belongs to flow "<other>", not "<this>".` At startup this ends the command, exit 2 (`cmd:305-307`; `cct:201-232`). In `/session <id>` it prints the message and leaves the current session unchanged (`reg:151-152`; `chat-dispatch.test.ts:155-165`). An id with completed request history from another flow is refused too, with `Session <id> has history from flow "<other>", not "<this>".` (`cmd:274-280`; `cct:140-172`). The history check reads the last 50 completed requests (`cmd:275`). **[page: "a session belongs to one flow; naming it under another flow is refused" and the start-up exit code is [ref]. Do not state the 50.]** **[test]**
19. **A session also belongs to one user and one organization.** Before the first turn on a session record that exists, the loop compares the record's organization and user to who this turn would run as. A mismatch prints: `Session "<id>" belongs to user <u> in organization <o>; this run is <u2> in <o2>. Nothing was written. A session keeps the user and organization it was created with; use a new session id.` then `Rotated to a fresh session (<new id>); resend to continue.` and the turn fails (`pr:188-203`; `loop:176-184`; `cpt:275-310` pins the same refusal for `fsdev run`). So: resume as the same user and organization that started it, which means the same `--user` / `--org` flags or the same resolver result. **[page: one sentence; this is the second edge case of the resume question.]** [source for the chat path; test for the check itself]
20. **A session record from before organizations were required** is refused with the engine's migration message and left unchanged (`cpt:355-380`, `pr:194-195`). **[ref]**
21. **Where "yesterday" lives.** Under discovery: SQLite file `.fsdev/data/fsdev.db` in the working directory (`ls:26-28`; `cmd:217`), so resume from the same directory. Under a config: the app's stores (`cmd:184-187`); persistent only if the app set `stores` (fact 1). With a persistent store, `fsdev run -s <id>` and `fsdev dev` read the same sessions (`api:87`; `dt:41`). **[page: the directory and the config caveat, one sentence each.]** **[verify: a second `fsdev chat` process resuming a first one's session and the model seeing the earlier turns was not run. What is pinned: two turns under one session id advance session state across turns (`chat-turn.integration.test.ts:44-80`, in memory), and the SQLite file holds the turn's request and session (`clt:57-79`). The page may say the session's state and history carry on; it does not need to show the model recalling a name unless the example is run and its real output pasted at pass 3.]**
22. **What "carries on" means.** The flow's session state and, for a generator with `history: true`, the earlier conversation (`hc` flow `:59-67`: `history: true`, comment "load prior conversation from persisted request items"; `:109-112` session state `messageCount`). A flow whose generator has no `history` slot does not replay the conversation to the model; its session state still persists. **[page: "history is loaded when the flow's generator asks for it (`history: true`)", linked to the history page. The `history: true` option name is from the example, not invented.]**
23. **Start over without leaving.** `/session new` mints a new id for the current flow and prints `New session: <id> (history reset).` (`reg:142-147`). The old session stays stored and can be bound again by id (`reg:129-157`; the old record is not touched: only the in-memory map changes, `reg:144`). **[page]**
24. **Turn counter.** `Turns:` in `/status` counts turns sent in this chat run, across all flows, whether they succeeded or not (`st:299-300`; `loop:142`). It starts at 0 in each new run, even on a resumed session, so it is not the session's length. **[page: omit or one clause. Don't let a reader read `Turns: 1` after a resume as a lost session.]** [source]

## Step 3: switch flows

25. **List and switch.** `/targets` prints `Targets:` then one line per `flow · action`, with `*` on the current default (`reg:64-79`; `chat-dispatch.test.ts:134-142`). `/use <flow> [action]` switches (`reg:82-105`); omit the action when the flow has one; a flow with several actions and no action named prints `Flow "<flow>" has multiple actions: ... Pick one: /use <flow> <action>` (`reg:98`; `chat-dispatch.test.ts:126-132`). An unknown flow prints the flows available (`reg:94`); an unknown action prints the actions (`reg:96`). **[page]** **[test]**
26. **`/use` prints the session.** `Now chatting with <flow> · <action> (session <id>, new|resumed).` `new` the first time this run binds that flow, `resumed` when this run already had a session for it (`reg:103`; `st:322-332`). **[page: shows this line. "resumed" here means resumed within this chat run, not from yesterday.]** **[test: `cct:90-105`]**
27. **Each flow has its own session within a run.** Switching away and back returns to the first flow's session, with its history; history from one flow does not reach the other (`st:292-298`; `cct:90-105`: `chatbot` has one session with `messageCount` 2 after two turns, `chatbot2` one with 1). **[page]** **[test]**
28. **Two instances of one flow kind are two targets**, addressed by instance id (`tg:370-384`). **[ref]** (collection flows; not in the page's example)
29. **Switching does not change who you are.** Who a turn runs as is asked again per turn, for the new flow's resolver (fact 13; `cpt:402-426`: a refused turn on `admin` fails, then `/use echo` succeeds, and `/status` shows the organization `echo` ran in). `/status`'s `Org:` shows the active flow's last turn, or `(asked on each turn)` before its first (`reg:117-122`). **[page: one clause.]** **[test]**
30. **Slash commands the built-ins do not claim are sent to the flow** only when the line matches `/^\/([a-z0-9][a-z0-9-]{0,63})(?:\s+([\s\S]*))?$/` (`pa:31-39`; `core/src/helpers/slash-command.ts:19`): lowercase letters, digits, hyphens. A lone `/`, an uppercase name, or a path such as `/etc/hosts` prints the `type /help` hint and is not sent. The matching line goes, with the slash, unchanged, to the default target; with no target bound, they print the "No default target" hint and count as a failure when piped (`tg:438-441`; `loop:124-129`; `pa:253-263`; `chat-dispatch.test.ts:35-47`). To send a message that starts with `/`, put a space first (`pa:262-264`; `chat-parse.test.ts`). **[page: one sentence; it is how a flow's own commands (skills) arrive. Name no skill.]** **[test]**
31. **The six built-ins**, in `/help` order: `/help`, `/targets`, `/use <flow> [action]`, `/status`, `/session [new|<id>]`, `/exit` (`reg:167`, the `usage` strings `reg:53,67,85,111,132,163`). **[ref: `reference/cli`; the page uses `/targets`, `/use`, `/status`, `/session` and `/exit` only and need not list all six.]** **[test: `chat-dispatch.test.ts:105-180`]**
32. **The `/help` text** ends `Anything else after / is sent to the flow — that's how skills are invoked.` (`reg:59`). **[ref]**

## Stored data: the four questions

The page's subject keeps one thing: **a session** (with its requests and the flow's session state). Chat itself writes no other record of its own. The session is the engine's session record; the turn's request records are written by the same call `fsdev run` makes (`turn:310-321`; `cmd:219-221` publishes the writes on the change bus).

| Question | Answer | Source |
| --- | --- | --- |
| Who owns it | The user and organization the turn that created it ran as. A session keeps them; a later run as a different user or organization is refused before any write, and chat rotates to a fresh id. | `pr:188-203`; `loop:176-184`; `cpt:275-310` |
| Who can see it | The same user in the same organization, through the DevTool's session list (under discovery, `devuser`, the user the DevTool defaults to). It belongs to one flow instance; another flow's id is refused. | `dt:85`; `ic:55`; `cmd:262-282` |
| Where it is stored | Without a config: SQLite file `.fsdev/data/fsdev.db` under the working directory, shared with `fsdev run` and `fsdev dev`. With a config: the app's stores; in memory, so lost on exit, if the app sets none. | `ls:3-14`, `:26-28`; `cmd:184-187`, `:212-217`; `types.ts:170-172` |
| How many exist | One per flow per chat run, minted when the flow is first bound; `/session new` and a refused resume each mint another. A new `fsdev chat` run mints a new one unless `--session` names one. Nothing deletes old ones. | `st:322-332`; `reg:142-147`; `loop:150-153`, `:179-183`; `cmd:310-313` |

## Cut or left to Reference

- The abort sequence (record the intent, then signal; "aborted" vs "interrupted") (`turn:178-184`, `:278-303`). Mechanism. **[cut]**
- The per-turn session re-check that catches another process appending a foreign-flow request after bind (`loop:145-155`). The page needs only the user-visible refusal (fact 18). **[ref]**
- Dispatch runs: `fsdev chat` waits for in-process background work when you leave the session, not after each turn (`apps/docs/docs/cli/overview.md:80-101`). **[ref: `reference/cli`; off this page.]**
- `--model`, `--dotenv`, `--config`, `--no-config`, `--quiet`, `--log-level` (`cmd:48-56`; `api:212-223`). **[ref]** The page may name `--model` as an aside; it needs none of them.
- Exit codes (facts 3, 12, 16, 18). **[ref]**
- Plain-text renderer rules, including that a future renderer is a second implementation (`rn:3-7`). **[cut]**
- `chat vs run vs dev` (`ic:59-63`). The page links `reference/cli` and the debugging recipe instead. **[ref]**

## Not stated on the page: no observable surface found

- That `fsdev chat` loads `.env.local` before the config: the fsdev README says so at line 426 and it is a CLI-wide rule, not a chat fact. **[ref]**
- Anything in the sitemap's source `cli/interactive-chat` beyond what is cited above is kept as is: the page keeps its sections on targets, messages, slash commands and sessions, rewritten as three steps.

## Revise round 1

- Page states the slash passthrough with its name pattern (fact 30), says `--org` skips the resolver (fact 13), and no longer calls the DevTool one-shot.
- Moved to Reference (linked to `/docs/api/cli`): `--org`/`--user` detail, `/session` edge cases, the status-line rules, the held-turn notice text (fact 3 stands), the not-chat-shaped note wording (fact 10).

## Revise round 2

- Sample session id now has the real `sess_<ms>_<hex>` shape (fact 5). A nonexistent `--session` id is confirmed not rejected (`cmd:262-282` guard passes a missing record; fact 4); the page keeps the sentence.
- Terms: the resolver refuses the request (not "the terminal"); `--org` sets the organization and skips the resolver; per-flow sessions are scoped to one `fsdev chat` process; a held turn prints the question and its id.

## Revise round 3

- `/status` row now names who turns run as and the config and store (fact 5; `reg:114-124`). `development-default` in the sample is the `from` label (`principal.ts:38`) and is not explained on the page.
- `--org` without a resolver: turns run as `--user`, or `devuser` (fact 13; `principal.ts`).
- Cut the `chat vs run vs dev` section to Reference (sheet line: cut or left to Reference).
