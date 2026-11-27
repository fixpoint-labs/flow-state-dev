# Fact sheet: Bash (K-34, `catalog/tools/bash`)

Sources cited: the exported surface and doc comments in `packages/tools/src/bash/`, the sync
engine it calls in `packages/workspace/src/projection.ts`, tests under `packages/tools/test/`, the
existing user docs (`apps/docs/docs/tools/bash.md`, `packages/tools/README.md`), and one example
(`apps/kitchen-sink/flows/chat-agent/shared/capabilities/`). No spec is cited.
Paths are relative to the repo root. `B/` is `packages/tools/src/bash/`, `T/` is
`packages/tools/test/`, `W/` is `packages/workspace/src/`, `D/` is `apps/docs/docs/tools/bash.md`,
`R/` is `packages/tools/README.md`, `KS/` is `apps/kitchen-sink/flows/chat-agent/shared/capabilities/`.

## Stored data: the four questions

The page is about a tool that keeps several things. Each stored part, answered:

### 1. The files (collection entries). The thing the reader cares about.

- **Owner.** The app's resource collection, not the bash tool. Bash declares no collection and
  installs none; it mounts whatever collections the block already has. `B/capability.ts:10-16`;
  `D:50` ("inherits ... no coordination needed"). A file written under `artifacts/` is a row in the
  collection whose pattern is `artifacts/**`. `B/blocks.ts:11-14`; `W/projection.ts:459-474`.
- **What a row holds.** State plus separate content. State: `path`, `hash` (SHA-256 of the content),
  `updatedAt` (ISO string), plus whatever `createState` adds; content goes through `writeContent`.
  `W/projection.ts:43,459-473`. The projection owns `path`, `hash`, and `updatedAt` and spreads a
  mount's extra fields first, so `createState` cannot replace them (`W/projection.ts:463-466`).
  The capability's default `createState` adds `title` (the file's basename) only
  (`B/capability.ts:215-217`). A collection whose schema says `updatedAt: z.string()` accepts
  every file bash saves. Do not document `title`; see Contradictions.
- **Who can see it.** Decided by the collection's own `scope` (`"session"`, `"user"`, `"org"`...),
  not by bash. The reader sees the files wherever they read that collection (client, other
  blocks, other flows that declare it). `apps/docs/docs/resources/collections.md:14-21`. The sheet
  cannot give one answer for the page; the page picks one scenario (a session collection) and says
  "scope decides who else sees them" with a link to Collections.
- **Where stored.** Wherever the app's store keeps resources (memory, SQLite, Postgres, per the
  flow's store). Bash adds nothing to the choice. `collections.md:389` ("stored in the same flat
  `resources` map"). Content is separate from state: `D:379`.
- **How many.** One row per file path under the mount. Bash sets no cap. A collection's own
  `maxInstances` applies when the collection sets one, checked only when adding an instance
  (`collections.md:131,273`). UNVERIFIED: what bash's flush does when a new file would trip the cap;
  do not describe it.
- **Not stored:** `node_modules/` and `.git/` trees are never walked, so never saved.
  `B/sandbox-place.ts:110-127`; test list is in `T/bash.test.ts` (no direct test found; code is the
  evidence). Marker files `.fsdev-keep` are seeded and filtered out, never saved.
  `B/sandbox-place.ts:27,85-93`; `B/projection-setup.ts:62-71`.

### 2. The workspace directory (local provider).

- **Owner.** The tool creates it. The app does not declare it. `B/blocks.ts:587-592`.
- **Who can see it.** Anything with access to the server's disk, under the server's OS user.
  `B/adapters/local-fs.ts:49-58` (commands run as the server's user). Which runs share it is `scope`
  (below).
- **Where.** `.fsdev/workspaces/<scope>/<id>/` under the server's `process.cwd()`. `run` and
  `session` add the tenant segment; `run` adds the request's incarnation as a last segment.
  `B/blocks.ts:321-324,417,591`; `D:255-286`; `R:292-306`. With `cwd` set it is that one directory
  instead. `B/types.ts:149-157`.
- **How many.** One per scope id: per request (`run`), per session (default), per user, per org.
  `T/bash-workspace-scope.test.ts:101-134` (two requests in one session: two workspaces under
  `run`, one under the default).
- **Outlives the request?** Yes on disk, whatever the scope. Directories from finished requests are
  left in place and never read again; the user cleans them up. `D:285-288`; `R:305-306`. What changes
  with scope is whether the next request is given the same directory, not whether the files exist.
- **Not a store of record.** The directory is working space. The collection is the copy the reader
  keeps; the next hydrate lays the collection's copy over it. `W/projection.ts:196-221`;
  `B/blocks.ts:810-813`. (Whether a later hydrate happens in a reused sandbox: see Limits.)

### 3. The live sandbox (memory, per server process).

- **Owner.** The bash blocks, in a module-level registry. `B/blocks.ts:208`.
- **Who sees it.** The runs that resolve to the same registry key. Key = scope + the scope's
  identity (tenant, session, request, user, org) with length framing so ids cannot collide.
  `B/blocks.ts:465-475`; `T/bash-workspace-scope.test.ts:276-296`.
- **Where.** In the process, plus whatever the provider holds (a child shell, a container, a remote
  sandbox). Gone on a server restart. `B/blocks.ts:204-208`.
- **How many.** One per registry key. For every provider except `local`, the scope is always
  `session`: `scope` is read only for `local`. `B/blocks.ts:461-463`. Concurrent first calls share
  one in-flight creation. `B/blocks.ts:786-808`.
- **Lifetime.** Released by `bashCap.cleanupBlock` at request end if wired, or after 30 minutes with
  no command, whichever comes first; a command still running keeps it alive. `B/blocks.ts:216,
  244-270`; `B/capability.ts:245-259`; `T/bash-sandbox-release.test.ts:178-250`. Release stops the
  sandbox (a local sandbox's background jobs are killed, with SIGKILL after a 2 s grace). `B/blocks.ts:1174-1196`;
  `B/adapters/local-fs.ts:76,196-200`; `T/bash-sandbox-release.test.ts:103-143`. A background job
  survives the command that started it. `T/bash-sandbox-release.test.ts:91`.

### 4. A MOAT container and its `moat.yaml`.

- **Owner.** The MOAT CLI, spawned by the framework. Credentials live with MOAT, never in app code.
  `D:140,160,243`.
- **Where.** On the host, in the container runtime; the workspace is a host directory bind-mounted in
  (default `.fsdev/workspaces/session/<tenant>/<id>`). `B/types.ts:253-257`; `B/blocks.ts:321-324,607-611`.
- **How many.** One per session by default, named from a digest of tenant and session
  (`fsdev-<session>-<digest>`). `B/blocks.ts:310-318`. A fixed `runName` is one container every
  session shares. `B/blocks.ts:727-734`.
- **Outlives the request?** By default yes: `persist` is on unless set false, so the container
  stays up and the next request reconnects; the 30-minute idle release stops it (per-session
  containers only). `B/blocks.ts:611,727-734`; `B/types.ts:292-307`. Sheet answers in full on a MOAT
  sub-page, not on K-34 (see "Not Bash").
  Note: the existing page says `persist: true` is something you opt into (`D:216-239`); the code
  defaults it on when the block builds its own sandbox. See Contradictions.

## What it is (sitemap question 3: which line gives a generator the tool)

- F1. `createBashCapability(options)` returns a capability named `bash`. `B/capability.ts:209,231-232`.
  Attach it with `uses: [bashCap]` on a generator. `KS/features.ts:129-131,170-172`;
  `D:17,44-48`; `apps/docs/guides/adding-skills-to-your-app.md:276-290`.
- F2. The capability has two presets, both on by default: `tools` (three handler blocks) and
  `guidance` (context text). `B/capability.ts:234-242`. Turn one off with the preset form (`tools:
  false`), as for any capability. UNVERIFIED for bash: no bash test or page shows the preset call, so
  the page leaves it out.
- F3. The three tools the model sees: `bash` (input `{ command }`, output `{ stdout, stderr,
  exitCode }`), `bash-read-file` (`{ path }` -> `{ content }`), `bash-write-file` (`{ path, content }`
  -> `{ success, refused }`). `B/blocks.ts:123-166,921-951,1027-1042`. For `local` and `just-bash`
  the block names are `bash`, `bash-read-file`, `bash-write-file`; for providers that need setup
  (`moat`, `vercel`, `upstash`) the `bash` command is a sequencer still named `bash`, with an
  `ensure-sandbox` step shown on a cold start. `B/blocks.ts:821-848,1063-1092`.
- F4. Bash is not a `tools: [...]` entry. It is `uses: [bashCap]`. The capability returns an object
  that is the capability plus `cleanupBlock`. `B/capability.ts:261`. Tools-overview fact sheet
  already records this as a contradiction in the old overview table:
  `docs/contributing/docs-revamp/pages/catalog/tools.facts.md:11`.
- F5. The capability does not install resources. Attach it beside the capabilities that declare the
  collections. `B/capability.ts:10-16`. A generator with only `bashCap` has no mounts; the guidance
  then says "No collections are currently mounted — files you create or modify will not persist
  beyond this session unless placed under a known collection path." `B/capability.ts:139-143`.
- F6. Import: `@flow-state-dev/tools/bash`. `B/index.ts:25`; `packages/tools/package.json:46`.
- F7. Options (all optional): `provider`, `collections`, `exclude`, `destination`, `createState`.
  `B/capability.ts:43-63`.
- F8. Default provider is `{ type: "just-bash" }` for `createBashCapability` and `createBashTool`.
  `B/capability.ts:55,213`; `B/types.ts:363`; `T/bash.test.ts:214`. The lower-level
  `createBashBlocks` defaults to `{ type: "local" }`. `B/blocks.ts:96,720`. So `createBashCapability()`
  with no arguments gives an in-memory sandbox, not the host shell.
- F9. `just-bash` is an optional peer package (`^2.14.0`). `packages/tools/package.json:110,125`.
  If it is not installed, the sandbox falls back to an in-memory file map where every command except
  `find` fails with exit code 1 and stderr `In-memory sandbox: install just-bash for full bash
  support`. `B/adapters/just-bash.ts:76-123`. (The existing page says only "Falls back to an
  in-memory Map-based sandbox", `D:386`.)
- F10. `createBashBlocks` returns the same three blocks without the capability's guidance text;
  `createBashTool` returns AI SDK tool objects (`bash`, `readFile`, `writeFile`) for `providerTools`
  and takes explicit collections. `B/index.ts:23-25`; `B/types.ts:341-395`; `R:174-192`. Keep to one
  sentence and a link; the page is the capability.
- F11. The guidance text the model is given, rebuilt every turn from the mounts present: the
  provider line, the workspace boundary ("You must only read, write, and operate on files within
  this directory"), each mount as "`<destination>/<prefix>/` — saved to the `<key>` collection",
  and "Use `<destination>/tmp/` for scratch files you do not want persisted. Files created anywhere
  else are discarded on save with a warning." `B/capability.ts:69-71,136-156,239`.
- F12. Command execution always starts in the workspace root: each command is run as
  `cd <destination> && <command>`, so the model uses relative paths (`artifacts/foo.md`).
  `B/blocks.ts:916-919,926-933`. `path` for the file tools is relative to the workspace root; a
  leading `./` is accepted on write. `B/blocks.ts:133-152,686-688`.
- F13. `destination` (the root the model sees) defaults to `/workspace`, and to
  `/vercel/sandbox/workspace` for the Vercel provider. `B/blocks.ts:340-343`; `B/capability.ts:58`.

## Where files written by a command go (sitemap question 1)

- F14. Mounts: every collection ref on the block's `ctx.resources` is mounted at its pattern prefix
  (`artifacts/**` at `<destination>/artifacts/`). `B/blocks.ts:517-572`. A collection whose pattern has
  no prefix (e.g. `*`) or whose prefix is `tmp` is not mounted. `B/blocks.ts:543-545`;
  `T/bash.test.ts:313-347` ("refuses to mount a collection at the reserved scratch prefix").
- F15. Mounts are discovered once, when the sandbox is created. `B/blocks.ts:790`.
  A sandbox for the same key keeps its mounts. UNVERIFIED across requests whether a collection
  installed later is picked up; the capability's guidance is rebuilt per turn but the mounts used for
  saving are not (`B/capability.ts:73-78` vs `B/blocks.ts:790`). Do not promise either way.
- F16. Hydrate: on the first use of a sandbox, every mount's entries are written into it, a `tmp/`
  directory is created, and each mount directory is created even when its collection is empty.
  `B/blocks.ts:663-666,810-813`; `B/projection-setup.ts:62-71`; `W/projection.ts:196-221`.
  Only writable mounts enter the change baseline. `W/projection.ts:215-220`.
  A later request that reuses the same sandbox does not re-hydrate (`entry.hydrated` stays true).
  `B/blocks.ts:810-813`. So a change another writer made to the collection between two requests in
  one session's sandbox is not laid into the workspace. UNVERIFIED by a test; the code reading is
  direct. Flag it before stating it.
- F17. Flush: after every `bash` command and after every `bash-write-file`, changed files go back
  to their collection. Reads do not flush. `B/blocks.ts:926-933` (flush after command),
  `B/blocks.ts:936-951` (read: no flush), `B/blocks.ts:1036-1040` (write: `put`, one path).
  `bash-write-file` commits just the one path it was given, not a walk. `B/blocks.ts:674-700`.
- F18. A flush, per file: under a writable mount, upsert into that mount's collection with the
  prefix removed; under a read-only mount, skipped; under `tmp/`, skipped silently; under nothing
  known, dropped with a `console.warn`. A file the run deleted is deleted from its collection.
  `W/projection.ts:279-335`; `B/projection-setup.ts:199-229`.
- F19. A file is written back only when its SHA-256 differs from the hash the run was given.
  `W/projection.ts:376-379`. Use "only changed files are saved", drop the mechanism.
- F20. Longest prefix wins when mounts nest. `B/blocks.ts:569-571`;
  `T/bash.test.ts:374-395` (files advertised at the paths they are mounted at).
- F21. `tmp/` is scratch: never saved, no warning. Reserved prefix. `B/sandbox-place.ts:30,129-132`;
  `B/blocks.ts:913`.
- F22. Orphans (outside every mount and `tmp/`) are dropped with a warning naming them. A flush
  looks at the mount directories and the files directly in the workspace root; a file in an
  unmounted subdirectory is dropped with no warning. `B/sandbox-place.ts:139-167`;
  `B/projection-setup.ts:199-205`; `D:354-358`. The model is told up front (F11).
- F23. Never saved: anything under `node_modules/` or `.git/` inside a mount. `B/sandbox-place.ts:110-127`.
  Say it in one clause, since an `npm install` inside `artifacts/` would otherwise be a surprise.
- F24. Read-only mount: `collections: ["artifacts", { key: "skills", writable: false }]`. Edits
  stay in the sandbox, never reach the collection. `B/blocks.ts:76`; `B/capability.ts:44-50`; `D:75-85`.
  A string entry is a writable mount. Keys not found on `ctx.resources` are skipped with a warning.
  `B/blocks.ts:558-567`.
- F25. `exclude: ["logs"]` skips keys during auto-discovery; ignored if `collections` is set.
  `B/capability.ts:52`; `B/blocks.ts:536-538`.
- F26. Disk persistence versus collection persistence, for the page's one sentence: the files that
  survive are the ones in the collection. A file left in a `local` workspace directory outside any
  mount is on disk but is not a collection entry and is not saved (and the next request in a fresh
  workspace will not have it). `B/blocks.ts:588-592`; F22.

## When two runs touch one file

- F27. A file whose collection copy changed while the run held it is not overwritten; the flush
  leaves both copies and warns naming the path. A file another run is writing right now is left
  alone the same way ("contested"). Two runs on different files both write. `W/projection.ts:376-420`;
  `B/projection-setup.ts:207-229`; `D:320-334`. Reference territory: the page gives one sentence
  and links (`reference/workspace`-style row). K-35 owns this story.
- F28. The model is told in the tool result. `bash-write-file` returns `{ success: false, refused:
  "<reason>" }` and `success: true, refused: null` when saved. `B/blocks.ts:154-166,1039-1040`;
  `B/projection-setup.ts:172-191`. Four refusals: `orphan` (not under a mounted collection or
  `tmp/`), `conflict` ("changed in its collection while this run held it — the write was NOT
  applied"), `contested` ("is being written by another run — the write was NOT applied"), `readonly`
  (says retrying will not save it). `B/projection-setup.ts:172-191`. A refusal for an orphan write
  counts as `success: false`. `B/projection-setup.ts:166-170`.
- F29. `bash` (the command tool) does not report a refusal in its result; a refused flush only logs
  a warning, and the command still returns its `stdout`, `stderr`, `exitCode`. `B/blocks.ts:926-933`;
  `B/projection-setup.ts:132-147,199-229`. So a model that saved a file with `echo > artifacts/x.md`
  is not told if the save was refused. The existing page implies only `writeFile` reports
  (`D:336`), consistent with this. Say it flat.
- F30. A failed flush walk is skipped and logged, never read as "the run deleted everything". Errors
  from reading or writing the collection itself are not swallowed: they fail the command. 
  `B/projection-setup.ts:115-147`. (Reference row, not page.)

## What the sandbox can reach (sitemap question 2)

The answer is per provider. The page opens on the default and names the others.

- F31. **just-bash** (the capability default): no real processes, an in-process bash emulator with
  "60+ built-in commands" (the model is told this). `B/adapters/just-bash.ts:3-12`;
  `B/capability.ts:94`. No network unless you allow it: `network.allowedUrls` (URL prefixes with
  optional methods and headers) or `network.dangerouslyAllowFullInternetAccess`. `B/types.ts:74-84`.
  The model is told "No network access." / restricted domains / full access accordingly.
  `B/capability.ts:101-108`. `python: true` adds `python3`; `javascript: true` adds `js-exec`
  (QuickJS; no Node). `B/types.ts:244-248`; `B/capability.ts:97-100`. `executionLimits` caps call
  depth, command count and loop iterations. `B/types.ts:86-93,250`. Cannot install packages.
  `B/capability.ts:94`. Files are in memory, not on the host disk. `D:104`.
- F32. **local**: a real `/bin/bash` child on the host in the workspace directory, so the host's
  binaries (npm, python, gcc) are available. `B/adapters/local-fs.ts:77-80`; `B/capability.ts:111-117`.
  Environment: only `PATH, HOME, USER, LANG, LC_ALL, TERM, TMPDIR, TZ` (when set on the server) plus
  `env`; `env` wins. `B/adapters/local-fs.ts:70,99-103`; `T/bash-local-fs-limits.test.ts:74-115`.
  Not an isolation boundary: same OS user, can read the server's environment. `B/types.ts:184-193`;
  `D:111`. The adapter does not restrict network access (verified by absence in
  `B/adapters/local-fs.ts`; nothing there filters sockets). Say "a command can reach whatever the
  server's host can reach" only after confirming with a run; flagged.
- F33. **local path guard** (`strictPaths`, default true): rejects `../`, `~/`, `$HOME`, `$()`,
  backticks, `<()`/`>()`, and unquoted absolute paths outside the workspace; names the offending
  token. Best effort for a cooperative agent, not a security boundary; text inside quotes and heredocs
  is not scanned, so `cat "/etc/passwd"` passes. `B/adapters/local-fs.ts:96,110-117,137-147`;
  `T/bash.test.ts:539-868`; `R:357-378`. `readFile`/`writeFile` paths that escape the workspace root
  throw. `T/bash.test.ts:846-862`. `strictPaths: false` logs a warning. `B/adapters/local-fs.ts:111-117`.
- F34. **local time and output limits**: `execTimeoutMs` default 60 000; on overrun the process
  group is killed and `exitCode` is 124. A process that detaches (`setsid`, daemon) can outlive it.
  Each of stdout and stderr is capped at 10 MiB; over it the command is killed and `exitCode` is 1.
  Signal stops give `128 + n`. `B/adapters/local-fs.ts:71-74`; `B/types.ts:194-200`;
  `T/bash-local-fs-limits.test.ts:118-200`; `R:211-218`.
- F35. **moat**: a container on the same host; the workspace is a bind-mounted host directory;
  outbound network is default-deny except `allowHosts`; credentials come from MOAT `grants` and are
  injected on outbound requests. `B/types.ts:252-277`; `D:136-146`. `grants` named but not granted
  fail before the run starts. `B/types.ts:266-270`; `D:243`. Needs the separate `moat` CLI >= 0.4.0
  installed by the host operator; the framework does not install it. `D:150-156`. Hosts: macOS 15+
  on Apple silicon or Linux with Docker. `D:146`. The default `execTimeoutMs` is 60 000; output is
  buffered; `readFile` is UTF-8 only (`MoatBinaryReadError`). `D:247-253`. Keep to a link; MOAT is a
  deep topic and `tools/bash` is trimmed to 1,100 words. Wiring `cleanupBlock` into
  `request.onFinished` is required for MOAT unless `persist` keeps the container. `D:201-214`;
  `B/capability.ts:245-259`.
- F36. **vercel**: a Vercel Sandbox. You pass the SDK's `Sandbox` class in
  (`{ type: "vercel", Sandbox }`) so the tools package has no dependency on it. Auth is Vercel OIDC
  or the `VERCEL_TOKEN` + `VERCEL_TEAM_ID` + `VERCEL_PROJECT_ID` triple; without either the adapter
  throws naming both. `B/types.ts:202-226`; `B/adapters/vercel.ts:205-240`; `D:117-130`; `R:199`.
  `sandboxId` reconnects to an existing sandbox. `B/types.ts:218-223`. The default workspace root
  for it is `/vercel/sandbox/workspace`. F13.
- F37. **upstash**: not usable today. The provider type exists and the adapter throws `Upstash Box
  adapter is not yet implemented.` when resolved. `B/adapters/upstash.ts:1-10,28-34`;
  `T/bash.test.ts:503-518`. **Contradiction:** `D:105` lists it in the provider table with
  `{ type: "upstash", client, boxId? }` and "Remote sandbox", and `D:117` says to pass SDK for it;
  `R:200` calls it a placeholder. Leave Upstash off the page or say it is not available.
- F38. **custom**: `{ type: "custom", sandbox }` where `sandbox` implements `executeCommand`,
  `readFile`, `writeFile` and optionally `stop`. `B/types.ts:23-45,309`.
- F39. Which providers run real processes on the server host: `local` and `moat` (container on the
  host). Remote: `vercel`. In-process emulation: `just-bash`. Table of six rows is the cap; this page
  needs at most six and the page may shorten it to the ones it shows.
- F40. The reader chooses a provider per environment; the kitchen-sink picks one with an env var:
  `BASH_PROVIDER` (`vercel`, `moat`, `local`, `just-bash`), then the Vercel credential triple on
  Vercel, then `STORE_TYPE=filesystem` -> local, else `just-bash` with python and JavaScript on.
  `KS/bash.ts:61-103`. This is the one worked example of choosing a provider by environment; it
  imports `@vercel/sandbox`, so a page example should show a shorter form of it. The names
  `BASH_PROVIDER` and `selectBashProvider` belong to the example app, not the framework.

## Where the workspace lives and who shares it (`local` only)

- F41. `scope` on the `local` provider: `"run"` (one workspace per request), `"session"` (default,
  one per session), `"user"` (one per user), `"org"` (one per org). `B/types.ts:158-173`;
  `T/bash-workspace-scope.test.ts:101-134`. `user` falls back to the session when the request has no
  user identity; `org` always has an org. `B/types.ts:165-172` (doc comment); `D:299-302`.
- F42. `scope` plus `cwd` throws at construction: `[bash] provider sets both cwd ... and scope ...`.
  `B/blocks.ts:725,1124-1132`; `T/bash-workspace-scope.test.ts:256-263`. `createBashTool` also
  refuses a scope. `T/bash-workspace-scope.test.ts:265-274`.
- F43. The model is told the scope: the `bash` tool description says the workspace belongs to this
  request alone (`run`), or is shared across the user's sessions (`user`), or the organization
  (`org`), or scoped to the session. `B/blocks.ts:894-914`; `T/bash-workspace-scope.test.ts:363-390`.
  Note the capability's guidance text says `(<scope>-scoped)` for `local` only. `B/capability.ts:112-116`.
- F44. Every non-`local` provider has one sandbox per session regardless of anything the reader sets.
  F-sandbox row above (`B/blocks.ts:461-463`).
- F45. Ids that reach the directory name are encoded and bounded, so a traversal-shaped session id
  cannot leave `.fsdev/workspaces/`. `B/blocks.ts:374-385`; `T/bash-workspace-scope.test.ts:136-195`.
  Not for the page; one clause at most.

## What comes back, including on failure

- F46. A command that exits non-zero returns `{ stdout, stderr, exitCode }`; it does not throw.
  `B/blocks.ts:926-933`; `D:383`. `exitCode` is always a number. `R:213-218`;
  `T/bash-local-fs-limits.test.ts:201`.
- F47. Reading a file that does not exist throws. `B/blocks.ts:945-949`; `D:384`. A path that is still
  there but cannot be read throws a named error during a flush. `B/sandbox-place.ts:60-65`.
- F48. A provider that cannot start (Vercel without credentials, `moat` CLI missing, Upstash)
  throws on the first call, not at build time. `D:385`. For setup-needing providers the `ensure
  sandbox` step runs first with the status message "Preparing bash sandbox (<provider>)..." (MOAT:
  "first run can take 30-60s while the image builds"). `B/blocks.ts:833-848`.
- F49. What the model sees when a tool call throws inside a generator: UNVERIFIED for bash (see
  `fetch.facts.md` F44). Do not write it.

## How it pairs with Skills and artifacts

- F50. Skills bundle files are reachable in bash automatically when the skills collection is
  installed beside the bash capability, since it is just another mount. `D:405`;
  `apps/docs/guides/adding-skills-to-your-app.md:276-290`. The kitchen-sink wires skills, an artifacts
  inventory and bash on one generator; bash is the one write path for artifacts. `KS/features.ts:1-12,
  143-172`.
- F51. Resource declaration example for a collection that bash can mount (the existing page's):
  `defineResourceCollection({ pattern: "artifacts/**", scope: "session", stateSchema: z.object({...}) })`.
  `D:360-375`; `apps/docs/docs/resources/collections.md:14-21`. The state schema does not have to
  declare `path`, `hash` or `updatedAt` for hydrate to work, since hydrate keys off the ref's storage
  path, not `state.path` (`W/projection.ts:196-203`); but flush stamps all three into state (F-state
  above), and the existing page says the schema "needs" them (`D:360`). UNVERIFIED whether a schema
  without them is rejected on write. Either test it or leave the claim out; if the page shows a
  schema, show all three, which is safe.
- F52. A phantom in the old example: `uses: [artifactsCap, skillsCap, bashCap]` (`D:46`) uses
  `artifactsCap` and `skillsCap` with no import. The page must declare or import every name. The
  smallest honest example is one collection declared on a block (`resources: { artifacts }`) in the
  same generator plus `bashCap`. The framework rule that a block's `resources` bubble up to the flow
  is in `apps/docs/docs/resources/collections.md:14-31` (the example declares on a handler). UNVERIFIED
  that a generator carrying the collection in `resources` and `uses: [bashCap]` mounts it in
  `bash`: the tool blocks read `ctx.resources`, which holds the flow's merged resources
  (`B/blocks.ts:530`), so it should. Run it with `fsdev run` before the page shows it.

## Not Bash (do not put on this page)

- MOAT install, grants, persistent containers, limits: one sentence and a link, or a Reference row.
  The existing page spends about 45% of its length here (`D:132-251`).
- The conflict and contested story in depth: K-35 (Workspace), which owns projecting a collection to
  disk. Link.
- `createBashTool`, `createBashBlocks`: one sentence at most. F10.
- Deployment recipe for Vercel (OIDC vs token triple, cost): the Deploying to Vercel guide. Link.
- Hash/diff mechanism, registry keys, framed keys, run-name digests, purge of stale containers.

## Existing-docs claims the page should not repeat (code or tests disagree or are silent)

1. `D:386` "`just-bash` not installed: falls back to an in-memory Map-based sandbox." Incomplete:
   commands fail with exit 1 (F9).
2. `D:105,117` Upstash listed as working. It throws (F37).
3. `D:216-239` "`persist: true` ... Skip it in production" reads as opt-in. For a blocks-built MOAT
   sandbox `persist` defaults to on (`B/blocks.ts:611`). Not on this page, but a neighbour page that
   states it is wrong.
4. `D:360` state schema "needs" `path`, `hash`, `updatedAt`: not shown to be required (F51).
5. `D:304` "On the first bash call in a session": for `local` with `scope: "run"`, the first call in
   a request. Say "first command a sandbox runs".
6. `D:62` "explicitly dropped with a warning": true only for files in the mount directories or the
   workspace root; an unmounted subdirectory is dropped silently (F22). Say the true thing or only
   the first half and link.
7. `D:64` guidance "tells the agent this up front": true (F11), but `B/capability.ts:152-154` says
   "discarded on save with a warning".
8. `D:328-330` "Content hashing ... flush is cheap even for large workspaces": a claim about cost, not
   shown. Drop; keep "only changed files are saved".
9. `createState` JSDoc on the blocks says the default is `() => ({})` (`B/blocks.ts:110-116`). The
   capability's default adds `title` only (`B/capability.ts:215-217`). Do not document the default.
10. `R:378` "wait for OS-level sandboxing in a future release": the container provider (`moat`) exists.
11. `apps/docs/docs/tools/overview.md` "All three tools follow the same provider pattern" is already
    flagged in `tools.facts.md:14`; not repeated here.

## Gaps for the writer to resolve by running, not by reading

- Does a generator that declares an `artifacts` collection in `resources` and `uses: [bashCap]` mount
  it? (F52.) `fsdev run` a tiny flow; also confirm the model-facing filename the tool reports.
- Does a later request in the same session see a collection change made between requests (F16)?
- What a `bash` command returns when its flush was refused (F29): confirm `exitCode: 0` with a
  warning only.
- Whether the local provider can reach the network (F32). A one-line `curl` through `fsdev run`.
- What the model reads when a bash tool throws inside a generator (F49).

## What the page states after revise round 1 (cut to the Tools reference, R-42)

The page keeps the model, one worked example and the guarantees. Everything below moved to the Tools
reference (R-42, `reference/tools`) or the Resources reference (R-08) and is linked, not stated:
provider option table, `local` environment and timeout, `just-bash` options, MOAT (install, grants,
persist, cleanup behaviour, limits), the scope table and workspace paths (tenant segment, run
incarnation, cleanup of old directories, `user` and `org` fallbacks), the sync steps, change detection,
the refusal cases, the orphan scan depth, the error table, `createBashTool`, and the state fields a
collection needs. Facts the page does state, and where they sit above: tool names and shapes (F3);
`uses: [bashCap]` and that the capability installs no collections (F1, F4, F5); mounting by pattern
prefix and longest-prefix routing (F14, F20); `tmp/` and orphan handling (F21, F22); no
`node_modules/` or `.git/` saving (F23); default provider and the `just-bash` fallback (F8, F9);
`collections` with a read-only entry, and `exclude` (F24, F25); the five provider types in one clause
each (F31, F32, F35, F36, F38; Upstash is left off, F37); `scope` on `local` and its refusal with `cwd`
(F41, F42); `local` not an isolation boundary (F32); hydrate on a sandbox's first command and flush
after `bash` and `bash-write-file` only (F16, F17); only changed files saved (F19); a changed or contested
file leaves both copies and logs (F27); a refused `bash-write-file` returns `{ success: false,
refused }` and a read-only refusal says retrying won't help (F28); a refused save from `bash` is only
logged (F29); non-zero exit returns, missing read throws, an unstartable provider throws on first call
(F46, F47, F48); `cleanupBlock` on `request.onFinished` and the 30-minute idle release (sandbox
lifetime in "Stored data" 3).

Name check for the model-facing write tool: it is `bash-write-file` (F3). `writeFile` is the
`createBashTool` key only (F10). `scope` is a `local` provider option (F41); the page names it in
the `local` example.

Example verified: the five `ts` blocks type-check against the workspace packages. F52's open question
(whether a generator carrying the collection in `resources` mounts it) is answered by the mount
discovery reading `ctx.resources` (`B/blocks.ts:515-570`); not run through `fsdev run`.

## Revise round 2

- F9 `find` exception confirmed: the fallback answers a command starting `find ` with exit 0 and the
  file keys; every other command exits 1 (`B/adapters/just-bash.ts:93-115`). The page keeps the clause.
- F24 read-only: a `bash` command's edits are skipped silently by the flush (`warnUnsettled` has no
  `readonly` branch, `B/projection-setup.ts`); `bash-write-file` returns the `readonly` refusal. The page
  now says which tool each sentence means.
- F27 conflict and contested: the run's copy is not committed and stays in its sandbox; the collection
  keeps the other writer's version; `warnUnsettled` names the path. The page says so in those terms.
- F22: the page states the orphan warning only for the workspace root, matching the scan depth.
- F42: `cwd` is glossed on the page as one fixed directory in place of a scoped one.

## Revise round 3

- Pass 9 miss (what the default sandbox reaches): the page now answers in a "What the default sandbox can do" section right after the tool table, before the example. Facts: F8, F9, F31 (emulator, 60+ commands, memory, no processes, no installs, no network unless `network.allowedUrls` or `dangerouslyAllowFullInternetAccess`), F32 (`local` real `/bin/bash`, server's user, not isolation), F35/F36 (`moat`, `vercel`). The claim that `local` can reach the network stays unstated, still UNVERIFIED (F32).
