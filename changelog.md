# Changelog

All notable implementation-repo changes are recorded here as concise, wave-level summaries.


## 2026-05-18

### Trading-desk: live social-sentiment provider via Grok (FIX-599)

- `get_social_sentiment` now has a live path. In live mode with `XAI_API_KEY` set, the tool routes to a Grok generator that uses xAI's `xSearch` hosted tool to retrieve recent X/Twitter posts about the ticker and returns a schema-valid sentiment payload tagged `source: "xai"`. The sentiment analyst was the one Phase 1 tool with no real live provider after FIX-589 — it ran structurally blind and emitted noise. It now produces grounded signal when an xAI key is configured.
- Without `XAI_API_KEY`, live mode keeps returning the `unavailable` payload. No false data, no silent fixture substitution. Fixture mode is unchanged.
- The dispatch primitive is a `router` with three routes — fixture handler, Grok generator, unavailable handler. First Phase 1 tool to span block kinds; the others use `if` inside a handler because every branch is a deterministic HTTP fetch.
- One new dependency in the example: `@ai-sdk/xai`. The xAI provider is registered through the model resolver's `providers` slot as a function that picks the **responses** model — `xSearch` only works there. Zero changes to `packages/core/*`.
- New `xai` value on the `sourceTag` enum alongside `finnhub` / `yahoo` / `fred` / `polymarket` / `fixture` / `unavailable`. Provider-named to match the existing convention.

### Configurable downstream information flow on Task Board (FIX-610)

- New `@flow-state-dev/utilities-task-flow` package ships two independent layers that plug into `taskBoard` and the patterns built on it: a per-tool result cache and a per-task observation policy.
- Tool blocks opt into memoization via `cacheable: true` or `cacheable: { ttl, scope, keyFn, cacheIf }`. Identical calls within the configured scope (`run` / `request` / `session`) serve from cache; identical in-flight calls in one request coalesce to a single execution. Errors are never cached. Cached `tool_output` items carry `cached: true`, `cacheAgeMs`, and `sourceTask` for cross-task hits so the DevTool transcript can attribute them.
- `TaskBoardConfig.flowPolicy` controls which prior-task observations a freshly dispatched worker sees on its `TaskWorkerInput.priorWork` slot. Built-in policies: `flowPolicy.none`, `declaredDepsOnly`, `ancestors`, `recentTrajectory`, `allCompleted`, `compact`, and `custom`.
- Pattern defaults: `planAndExecute` pins `recentTrajectory({ n: 8 })`; `supervisor` pins `declaredDepsOnly`; bare `taskBoard` defaults to `declaredDepsOnly` for every topology.
- Kitchen-sink's `readArtifact` block in the chat-agent flow is now `cacheable: { ttl: 60_000 }`, so repeated reads of the same artifact within a Task Board run are served from cache.
- New `patterns/flow-policy` docs page; `plan-and-execute` gains a "Sharing context across iterations" section; `tools/overview` gains a "Marking tools cacheable" section; new BP-021 covers when to opt in.

## 2026-05-17

### Turn-aware history windowing (FIX-608)

- `history: { limit: N }` on a generator now counts conversational turns rather than raw LLM protocol messages. A tool-heavy assistant turn no longer evicts the prior user message from the window — the tool calls ride along inside the turn they belong to.
- `{ limit: { tokens: T } }` is turn-aligned: whole turns are packed from the end of the conversation and never split across the budget boundary. If the most recent prior turn alone exceeds the budget it is still included.
- New explicit `{ limit: { turns: N } }` form is preferred in new code that wants to be unambiguous about the unit. Bare `{ limit: N }` continues to compile and now behaves more generously than before — no migration step.
- Live items from the in-flight request are still always included regardless of limit. This preserves the "try again" retry-after-mid-turn-failure scenario the bug was originally reported against.

### Trading-desk: per-agent approach preamble streams visible reasoning in Phases 3–5 (FIX-604)

- Every silent structured-output agent in Phases 3–5 — the trader, the three Phase 4 personas, the risk-assessment consolidator, and the portfolio manager — now streams a one-sentence approach preamble before its structured memo. The transcript pane no longer goes quiet during the pipeline's most consequential phases.
- Preambles are display-only: their text is not fed into the structured generator and does not influence the memo. The mechanism is purely an observability addition with zero correctness coupling.
- Always-fast model. Each preamble runs on `intent/utility` regardless of the user's `costPreset` choice, so the `full` preset doesn't escalate the preambles too.
- All six preamble generators are built via a small `createApproachGenerator` factory that lives inside the example next to the `tradingDesk` capability. Single consumer today, so the pattern stays inside the consumer rather than getting promoted to `@flow-state-dev/patterns`. Each call site only specifies what differs (name, agent name, artifact name, prompt, capability presets).
- Round Robin needs no pattern-level change. Roster blocks were already sequencers after the FIX-597 reshape, so inserting `.then(<approachGen>)` inside each roster sub-sequencer is local to the example.
- Trading-desk walkthrough and README extended for the new Phase 3 / 4 / 5 shape and the in-flow-factory teaching moment.

### Trading-desk: Company Profile analyst grounds the desk in what the business actually is (FIX-606)

- New fifth Phase 1 analyst (`companyProfileAnalyst`) runs in parallel with the existing four and publishes a memo describing the underlying business: name, sector, industry, country/exchange/currency, business description, and rough scale (market cap, employees, IPO date). Downstream phases pick it up automatically via the `tradingDesk` capability's `phase1Memos` formatter.
- Renderer, not synthesizer. The analyst is given structured fields from a deterministic provider fetch and constrained at the prompt level to render them — every body claim must trace to a field in `<data>`, with a "quote one figure verbatim" requirement as a structural defense against fabrication. The shared `<grounding>` clause from FIX-605 reinforces the boundary.
- Provider chain reuses what's already wired: Finnhub `/stock/profile2` preferred (no new key, already called by `get_fundamentals`), Yahoo `quoteSummary` (assetProfile + summaryDetail) fallback for sector and business description. When both providers fail, the analyst emits a memo whose body explicitly states identity could not be resolved rather than inventing the company.
- Fixture coverage for the three pinned tickers (NVDA, AAPL, JPM) at the `2026-05-06` snapshot.
- README, walkthrough, and internal design doc updated to reflect the five-analyst fan-out and the grounding analyst's role.

### Bash tool: working bash on Vercel without operator setup (FIX-587)

- Kitchen-sink's `selectBashProvider()` no longer picks the Vercel adapter on every Vercel deployment regardless of credentials. The deployed demo was returning HTTP 400 on every bash, bash-read-file, and bash-write-file call because `@vercel/sandbox` had no OIDC token or static access-token triple to authenticate with. Auto-detect now requires the `VERCEL_TOKEN` + `VERCEL_TEAM_ID` + `VERCEL_PROJECT_ID` triple before picking the Vercel provider on Vercel; without it, the selector falls back to `just-bash` (in-memory virtual filesystem, ~70 commands, zero auth). Forks deploying to Vercel get a working demo with no environment-variable setup.
- New `BASH_PROVIDER` env var for explicit opt-in (`vercel`, `just-bash`, `local`, `moat`). Operators with OIDC Federation enabled on their Vercel project must set `BASH_PROVIDER=vercel` to opt in — the OIDC token is delivered as a per-request `x-vercel-oidc-token` header, not as `process.env.VERCEL_OIDC_TOKEN` at module init, so auto-detect can't see it.
- The Vercel adapter's `enrichVercelError` now recognizes the SDK's `VercelOidcContextError` and `LocalOidcContextError` (thrown before any HTTP call when no OIDC token is available). Previously these bypassed enrichment because they have no `.response.status` field — the chat UI saw a bare SDK message instead of an actionable diagnostic. The new wrapper produces a single message naming the three remediation paths: enable OIDC Federation, set the static triple, or set `BASH_PROVIDER=just-bash` to disable the Vercel adapter.
- New "Using the bash tool on Vercel" section in the Deploying to Vercel guide documents the credential options, the `BASH_PROVIDER` env var, and cost tradeoffs for public demos. Kitchen-sink and `packages/tools` READMEs cross-link to the guide.
- Default `destination` for the Vercel provider is now `/vercel/sandbox/workspace`. Previously the framework defaulted every provider to `/workspace`, but the Vercel Sandbox runtime user (`vercel-sandbox`) can only `mkdir` under its home (`/vercel/sandbox`), and `Sandbox.writeFiles` extracts tarballs at `/`. The old default produced `tar: workspace: Cannot mkdir: Permission denied` on every `writeFiles` call — the demo never actually wrote a file end-to-end on Vercel even when authentication worked. The new default anchors the workspace inside the user's writable home; other providers continue to default to `/workspace`.
- `enrichVercelError` now wraps every adapter method, not just `Sandbox.create()`/`get()`. Runtime calls (`writeFile`, `executeCommand`, `readFile`) used to pass raw SDK errors through, so a 400 from `/fs/write` surfaced as `Status code 400 is not ok` with no body — the useful detail in `err.json.error.message` (e.g. tar extraction failures) went only to the deploy logs.
- Cold-path bash block names and the ensure-sandbox status message now include the provider type, so the trace makes it obvious which sandbox a request is using (`bash-vercel-ensure-sandbox`, `bash-vercel-write-file-exec`, etc.). Warm-path leaf names are unchanged.


## 2026-05-16

### Sequencer DSL: `.throwIf(condition, error)` guard primitive

- New `.throwIf((value, ctx) => boolean, Error | (value, ctx) => Error)` on the sequencer DSL. Throws the supplied error (or factory-produced error) when the predicate is true; otherwise passes through unchanged. Pairs with `.rescue([{ when: [TypedError], block: handler }])` for typed early-stop patterns. Both predicate and error factory may be async.

### Trading-desk: unresolvable-ticker guardrails + shared grounding clause (FIX-605)

- Pre-flight ticker resolution runs after `seedSession` and before `phase1Pipeline`. A `.tap` probes the active data source (fixture-file existence / live fundamentals fetch) and patches `stoppedReason: "unresolvable-ticker"` when the ticker can't be resolved; the following `.exitIf` bails before any model spend.
- Post-Phase-1 data-quality `.tap` reads memo statuses and patches `stoppedReason: "phase-1-no-data"` when every analyst memo is in `error`; the following `.exitIf` halts the run before phases 2–5 synthesize on no upstream data.
- The `tradingDesk.core` preset now injects a shared `<grounding>` clause into every generator's prompt — "operate strictly on data provided by upstream agents and tools; surface insufficient-data rather than fabricate." Expressed once, applied uniformly across all twelve agents, instead of the Phase-1-only `SHARED_PREAMBLE` line being the only source of grounding discipline.
- Session state gains `stoppedReason` and `stoppedMessage` fields, both surfaced to the client so the navigator can render a terminal stopped banner rather than an in-progress indicator.

### Round Robin pattern reshape: optional referee, `terminateWhen`, synthesizer-as-terminal (FIX-597)

- `roundRobin()` no longer requires a judge. The `judge` config is removed; a new optional `referee` slot runs after every round as a per-round argument-quality auditor (returns `{ critique }`) and does not control termination. Critiques accumulate in outer state as `refereeCritiques` and the default roster agents render prior critiques into their prompts on subsequent rounds.
- New `terminateWhen?: (ctx) => boolean` config drives runtime early-exit; `maxRounds` stays as the hard cap. The synthesizer remains the standard terminal step (`synthesizer: false` opt-out unchanged).
- `RoundRobinFinalShape` drops `done` and `summary`; adds `refereeCritiques: Array<{ round, critique }>`. The `lastJudgeSummary` field is removed from outer state. Schema/factory renames: `roundRobinJudgeOutputSchema` → `roundRobinRefereeOutputSchema`, `createJudge` → `createReferee` (re-exported as `createRoundRobinReferee`).
- Trading-desk Phase 2 collapses from four pre-built `roundRobin()` instances plus a router to one instance with `terminateWhen` driving `maxDebateRounds` and `uses: [tradingDesk]` resolving the model from `costPreset`. Phase 4 drops `judge: stubJudge` and otherwise keeps its three custom roster sub-sequencers. The `stub-judge.ts` workaround and its test are deleted.
- Docs reshape: `apps/docs/docs/patterns/round-robin.md` rewritten around referee + termination + synthesizer-as-terminal; trading-desk walkthrough Phase 2 and Phase 4 prose updated; package README, example CLAUDE.md, and internal design doc reflect the new shape. The remix-primitives docs surface and a future moderator pattern are explicitly deferred.

### Idempotency primitives on handler context (FIX-402)

- `BlockContext` now exposes `idempotencyKey` and `runOnce(key, fn)`. The key is a stable string of the form `${requestId}:${blockPath}` — identical across retry attempts of the same logical step, so it can be passed directly to providers that accept an idempotency header (Stripe, Twilio, etc.).
- `runOnce(key, fn)` memoizes the result of `fn` per `(requestId, userKey)`. The first invocation runs `fn` and persists the result through the `RequestStore`; subsequent calls within the same request — block retries, concurrent same-key races, or any re-entry — return the stored value without re-running the side effect. Concurrent calls with the same key share a single inflight promise so the wrapped work cannot fire twice in a race.
- `RequestStore` gains `getRunOnceResult` / `setRunOnceResult`. Memory, filesystem, SQLite, and Postgres adapters all carry the table; SQLite and Postgres add a `request_runonce(request_id, key, value)` table to their schemas.
- Scope is request-local on purpose. Crash-recovery dispatches that mint a new `requestId` start with an empty `runOnce` namespace — for cross-request de-dup, hand `ctx.idempotencyKey` to the external provider instead. The boundary is documented in the new `advanced/idempotency` docs page.

## 2026-05-15

### Kitchen-sink in-flight status indicator (FIX-600)

- Default fallback verb changed from "Thinking..." to "Working..." so it no longer duplicates the reasoning chrome's header text.
- The in-flight indicator now switches to a muted "Tidying up..." state while a request is in its background-task drain phase. After FIX-554 lifted `.work()` to a request-level pool the SSE stream stays open past the visible end of the main response; the indicator was previously suggesting the assistant was still producing the answer.
- `RequestGroupRenderer` and `RequestGroup` gain an optional `isFinishing` prop (defaults to `false`); host apps thread `useSession.isFinishing` through to drive the drain-state rendering. Downstream consumers that do not yet thread the signal continue to render as today.
- Generator/tool status restore: a tool's status no longer lingers past its own execution. The generator snapshots the slot on the first tool entry of a (possibly parallel) round and restores it when the last tool exits, falling back to the generator's own `activeStatusMessage` (or empty → "Working...") afterward. The "Using <tool>…" hint now also routes through the same slot, so tools that don't emit their own status (e.g. `search`, `fetch`, `crawl`) get a clean restore instead of leaving "Using …" stuck on the indicator.

### Memory system extracted into `@flow-state-dev/memory` package (FIX-588)

- New `@flow-state-dev/memory` package. The full memory system (working / episodic / semantic / digest tiers, capabilities, recall tool, helpers, formatters) previously hosted in `@thought-fabric/core/memory` now ships from a dedicated package. Apps that needed Thought Fabric only for memory can drop the `@thought-fabric/core` dependency entirely.
- Memory is a separate install — it is not bundled with `@flow-state-dev/core`. Add `@flow-state-dev/memory` to your dependencies alongside core when an agent needs cross-turn persistence.
- `@thought-fabric/core/memory` is removed. The `memory` namespace no longer ships from Thought Fabric; the subpath export and re-export shim are deleted. Until Thought Fabric ships its own cognitive memory variants on top of the shared contract, it doesn't address memory at all.
- New minimum read-side contract `MemoryProvider` (with `MemoryContextSections`, `RankedMemoryItem`) lives next to the implementation. The `MemorySystem` returned by `system()` declares it implements `MemoryProvider`, and exposes `formatContext` as an alias of `contextFormatter` so consumers depending on the contract can call it under the contract-shaped name. `contextFormatter` is preserved.
- Block names no longer carry the `tf.` prefix. The recall tool is now `memory/recall` (sanitized for the agent as `memory_recall`); `tf.memory/observe`, `tf.memory/consolidate/*`, `tf.memory/prune/*`, `tf.memory/digest/*` all become `memory/...`.
- Kitchen-sink `chat-agent` and `rich-text-component` flows updated to import from `@flow-state-dev/memory`. Thought Fabric continues to host attention, identity, and metacognition.
- New Ecosystem → Memory category in the docs site (overview, configuration, recall tool), with explicit install instructions. The Thought Fabric README and sub-site lose their memory pages and gain a short pointer to the new home.
- The full memory consumption contract (event-shaped writes, multi-provider composition, snapshot semantics) is intentionally deferred to a follow-up.

### Bash tool: tolerate `./`-prefixed paths in `bashWriteFile`

- `routeWrittenFile` strips a leading `./` before matching mount prefixes. The model regularly supplies `./artifacts/foo.md` even though the schema says workspace-relative; previously these landed on disk but were silently dropped from the collection sync. Now they route correctly.

### Bash tool: background purge of stale MOAT containers

- **New `purgeOldRuns` helper + `bash-purge-stale-containers` block.** Wired via `.workIf(isCold, ...)` into the cold-boot sequencer step, so the purge dispatches as fire-and-forget while `ensureSandbox` is booting the new container. Lists all runs, filters to framework-managed names (prefix `fsdev-`), excludes the current run, sorts oldest-first by `StartedAt`, and destroys whatever exceeds the limit (default 50).
- Bounds the container pool that accumulates when `persist: true` keeps each session's container alive for its full lifetime. Without this, a developer running many sessions over a week would steadily accumulate `fsdev-*` containers; the purge tops up the pool back to 50 on each cold session start. Never touches user-named (non-prefixed) containers.

### Bash tool: MOAT containers persist across requests within a session

- **`provider.persist` now defaults to `true`** for MOAT when the framework derives the workspace. Without it, `cleanupBlock` (wired into `request.onFinished`) destroyed the container at the end of every tool-call request, so each subsequent bash command cold-booted a fresh container (~10–30s). On the apple runtime that cold boot also races `readdir()` on the freshly-mounted host workspace — the first `ls /workspace` would return `Operation not permitted` because the host-fs contents hadn't propagated through the bind mount yet, and the model would invent explanations ("MOAT isolation prevents directory listing") instead of receiving real output.
- With persist, the request-end cleanup only removes the in-process registry entry — the MOAT run stays alive. Next request finds it via the `moat list` reuse path and reconnects in milliseconds. Container count is bounded by the session count (`runName` is `fsdev-<sessionId>`); cleanup is the operator's responsibility — `moat clean` periodically, or rm-rf the per-session workspace dirs.
- Users who explicitly set `provider.persist` still get their choice honored; the new default only kicks in when the field is left undefined.

### Bash tool: explicit `/workspace` mount declaration; kitchen-sink artifact lookup

- **`stripMountsTargeting` now strips *and* injects.** Previously it removed user-declared `/workspace` entries from the yaml on copy-in and relied on MOAT's implicit `moat run <workspace>` auto-mount. On the apple runtime that auto-mount sometimes didn't materialize, leaving the container's `/workspace` absent and the agent's `cd /workspace && ls` failing — which the model dressed up as "MOAT isolation prevents directory listing." The strip now also injects an explicit `mounts: - <abs workspace path>:/workspace` entry into the copied yaml, so the bind mount is declared rather than implied. Eliminates a class of "the container can't see what's on disk" failures and removes the ambiguity that lets the model fabricate explanations.
- **Kitchen-sink: artifact content now renders.** `page.tsx`'s artifact-content lookup compared `item.topic` (which the framework's list endpoint returns stripped of the collection prefix — `"hello.md"`) against a manually-constructed `storageKey` (`"artifacts/hello.md"`). The `find` never matched, `setArtifactContent(null)` ran, and the renderer drew "Empty artifact." Fixed to compare bare-topic to bare-topic.

### Bash tool: artifact content now persists on first write

- **`routeWrittenFile` and `flush()` now upsert via `getOrCreate` + `patchState` + `writeContent`** — the same pattern the framework's own `upsertResource` utility uses for known-good resource writes. The previous `create` + `writeContent` shape registered the ref but the client-side snapshot would sometimes render the artifact with empty content until a *second* write triggered a state-update event. Aligning the bash-block upsert sequence with the framework's canonical pattern fixes the "Empty artifact" symptom on first `bashWriteFile`/`bashCommand`-driven creation.

### Bash tool: `/workspace` is no longer a concept the agent has to know about

- **`bashCommand` runs with PWD = workspace root.** The block factory wraps the agent's command with `cd '<destination>' && <command>` so the shell's current directory is always the workspace root. The agent can now use relative paths (`wc -c artifacts/foo.md`, `ls -la artifacts/`) and never needs to know about magic prefixes like `/workspace`. Single-quoted with POSIX escape so destination paths with spaces are safe.
- **Block + schema descriptions updated** to explicitly tell the model "paths are relative to the workspace root; don't prefix with `/workspace`." LLMs routinely forget non-mandatory prefix rules — the cd wrapper makes the absolute-prefix form *also* work (so the agent isn't punished for forgetting), but the wording nudges toward the simpler relative form.
- **`bashWriteFile` host-fs leaf no longer reads the user's source `moat.yaml`** to derive the mount source. Reading the *unstripped* user yaml resolved against the per-session workspace dir produced a nested path the container couldn't see at `/workspace`, so the host-fs write landed somewhere the agent's subsequent `bash` commands couldn't find. The leaf now uses the workspace dir directly — matching what MOAT auto-mounts at `/workspace` — for trivially consistent read-after-write.

### Bash tool: framework-derived workspaces bypass the marker check

- **New `frameworkManaged` flag on `resolveMoatSandbox`** lets the caller assert the workspace path is framework-derived (i.e. `.fsdev/workspaces/session/<sessionId>` or similar auto-generated dir) and the resolver overwrites `<workspace>/moat.yaml` unconditionally. `createScopedSandbox` passes this through whenever it derives the workspace itself.
- This unblocks the migration case where a yaml was written by a pre-marker version of the framework: previous code treated any non-marker yaml as user-authored and threw `Refusing to overwrite ...`, which blocked every second tool call in a dev-server session. The marker check remains the fallback signal for user-supplied workspaces.

### Bash tool: framework-managed yaml is now safely re-overwritable; flush warns on zero-file walks

- **`configPath` copy path now marker-tags and tolerates re-overwrite.** Previously, every framework-written `<workspace>/moat.yaml` was treated as potentially user-authored on subsequent boots, so the second tool call in a dev-server session (Next.js HMR, request-scoped lifecycles, registry-clearing retries) hit "Refusing to overwrite existing `<sessionDir>/moat.yaml`" and aborted. The copy now prepends `FSDEV_MANAGED_MARKER` to the stripped yaml, and on subsequent boots checks for the marker: present → safe to refresh from source, missing → user owns it, throw. Same pattern the no-`configPath` branch has used since FIX-584.
- **`flush()` warns when its walk finds zero files under writable mounts.** Previously a successful-but-empty walk was indistinguishable from "the agent's write went somewhere the walk didn't visit" — silent failure mode for the "I see the file on disk but my artifact didn't appear" symptom. New warning names the prefixes searched and the host walk source so the cause is visible at the moment of failure.

### Bash tool: align MOAT default workspace with `local` provider; fix cold-boot readiness timeout

- **Default MOAT workspace path** is now `.fsdev/workspaces/session/<sessionId>` (mirroring the `local` provider) instead of `.fsdev/moat/<sessionId>`. One mental model and one place on disk for "this session's stuff" regardless of provider. The user's hand-authored `moat.yaml` is copied (with `/workspace`-targeted mounts stripped) into each session dir; artifacts and other mount contents live alongside it under `<sessionDir>/artifacts/`, etc.
- **`buildSubprocessEnv` runs after the configPath copy.** Previously the env was built upfront, but on a cold per-session boot `<workspace>/moat.yaml` didn't exist yet — `MOAT_RUNTIME` stayed unset, `moat list` silently defaulted to docker (and failed on apple-runtime hosts), and the readiness loop burned the full timeout because the run never appeared in the list. Reordering means the yaml's `runtime:` field is honored from the first poll.

### Bash tool: per-session MOAT defaults + fail-fast on early `moat run` exit

- **Default `runName` is now session-stable** (`fsdev-${sessionId}`). Previous default was a per-call `randomUUID()`, which produced a new container every bash invocation. Sessions still get their own container — sharing one across sessions would race hydrate (session A's artifact contents overwriting session B's view) and is now opt-in (set `provider.runName` explicitly, with the responsibility of avoiding workspace collisions).
- **Default `workspace` for MOAT is now per-session** (`<cwd>/.fsdev/moat/<sessionId>`). The dir is created lazily on first boot. MOAT auto-mounts it at `/workspace`, so each session has an isolated host filesystem the agent sees as `/workspace`. The user's hand-authored `moat.yaml` (typically at the kitchen-sink root) is copied into each per-session dir on demand.
- **`stripMountsTargeting` strips `/workspace` mounts from copied user yamls.** MOAT 0.5.x's workspace positional already auto-mounts at `/workspace`; a duplicate yaml-declared entry triggers `target "/workspace" already mounted`. When the framework copies a user's hand-authored yaml into a per-session workspace dir, it now strips any entry targeting `mountTarget` so the two don't collide. Non-`/workspace` mounts in the yaml are preserved verbatim.
- **`buildRunArgs` no longer emits `-m <workspace>:<mountTarget>`.** Same root cause: MOAT auto-mounts the workspace positional, and our explicit `-m` was a redundant duplicate that produced the same "already mounted" error. Removed entirely; per-target host overrides go through the yaml.
- **`moat run` early-exit is detected within the readiness poll.** `startDetached` now returns a handle exposing the child's exit info. Between `moat list` polls the resolver checks whether the child has died; if so, it throws `MoatRunStartError` immediately with the captured stderr tail (last ~16KB). Previously a fatal launch error (mount conflict, runtime unavailable, etc.) silently exited the host process and the readiness loop blocked the full timeout (default 180s) before failing with a generic "did not reach running" message.
- **Diagnostic warning when `bashWriteFile`'s host-fs leaf finds no mounted collections on `ctx.resources`.** The write still lands on disk, but the file won't be registered in any artifact collection — typically a capability-wiring mistake on the consuming generator. The warning names the path and points at the likely cause so the symptom isn't invisible.

### Bash tool: host-fs sync for bind-mount providers + cold-boot status sequencer

Two related refactors in `@flow-state-dev/tools/bash` aimed at MOAT but
applicable to any future bind-mount provider:

- **Direct host-fs IO under MOAT.** `createMoatAdapter`'s `readFile` and `writeFile` now resolve the container-side path against the bind-mount source and operate on the host filesystem directly when the path is under `mountTarget`. The host directory and the container's `/workspace` are the same filesystem viewed through two paths; going through `moat exec cat` / `moat exec <stdin>` was paying an IPC round-trip per file for no isolation gain. `executeCommand` still goes through `moat exec` — only opaque shell commands need the container runtime.
- **Workspace `moat.yaml` mount-source discovery.** New `resolveMountSource` helper reads the workspace yaml's top-level `mounts:` list and finds whichever entry targets `mountTarget` (default `/workspace`). When the user remaps `/workspace` to a different host directory (e.g. `./.fsdev/moat:/workspace`), the adapter follows. Narrow scope on purpose — we parse only what's needed for path translation, not the full yaml.
- **`flush()` walk via host fs.** When `sandbox.hostMountSource` is set, the per-flush walk uses `fs.readdir({recursive:true})` over each mount-prefix dir on the host instead of `find` via `executeCommand`. Same algorithm, one syscall layer instead of three. Walk-via-`find` retained as the fallback for Vercel/Upstash adapters.
- **`bashWriteFile` skips ensureSandbox under bind-mount providers.** Writes to a host directory don't need the container to be running — the bind mount picks them up when MOAT eventually boots. The leaf does `fs.writeFile` + inline single-file routing into the owning collection (no `find` walk, no hash diff loop). For Vercel/Upstash where the sandbox instance *is* the storage, `bashWriteFile` keeps the ensureSandbox gate.
- **Sequencer split with `tapIf(isCold, ensureSandbox)`.** `bashCommand` and `bashReadFile` under setup-needing providers (MOAT, Vercel, Upstash) are now sequencer-wrapped, with the boot/connect step gated by a runtime "registry is empty" predicate. Warm path: passthrough, no extra trace node. Cold path: status emissions visible in the chat UI ("Preparing bash sandbox…", then "Booting bash sandbox (first run takes 30–60s while the image builds)…" when `probeMoatRun` reports the container is absent). Fast providers (`local`, `just-bash`, `custom`) stay leaf handlers — no sequencer wrapper, no trace overhead.
- New exports: `resolveMountSource`, `probeMoatRun` from `@flow-state-dev/tools/bash`.
- New optional `Sandbox.hostMountSource` property — set by adapters that know which host directory backs `/workspace`, consulted by `flush()` to decide which walk strategy to use.

## 2026-05-14

### `useResourceCollection` invalidates on mid-stream resource changes

- `SessionView` gains a dedicated `resourceChanges: ReadonlyArray<ResourceChangeNotice>` channel. Every `resource_change` SSE item appends a `{ resourcePath, changeType, seq }` notice to this list — independent of the caller's `useSession` items filter. `resource_change` items are transient, so the prior implementation that watched `session.items` for them silently missed every mid-stream mutation whenever the consumer didn't opt into `includeTransient: true` (the default).
- `useResourceCollection` now watches `session.resourceChanges` instead of `session.items`, invalidating its page cache as soon as a notice whose path is under the watched `ref` arrives. `get`'s callback identity also flips on invalidation (matching `list`'s existing behavior), so single-item subscribers via `useResourceCollectionItem` actually refetch.
- User-visible effect: when a viewer is parked on a single collection item that transitions while they watch it (e.g., the trading-desk memo flipping from `writing` to `published`), the pane now updates in place instead of requiring the user to click away and back.
- Additive public API: the new `ResourceChangeNotice` type and `SessionView.resourceChanges` field. No removals.

### Bash tool: MOAT adapter compatibility with MOAT 0.5.x

- `moat version` text-output fallback: MOAT 0.5.x advertises a global `--json` flag but `moat version` ignores it and prints a human-readable block. The adapter's preflight now falls back to scraping the first line (`moat <semver>`) when `JSON.parse` fails. JSON path is still tried first for forward compatibility.
- `moat run` no longer uses the (removed-in-0.5.x) `-d` detach flag. The framework now spawns `moat run` detached on the host (stdio ignored, unref'd) and appends `-- sleep infinity` as the foreground keepalive command so the container stays up long enough for `moat exec` to interact with it. Readiness is observed via the existing `moat list` polling loop. Backwards-compatible with 0.4.x.
- Every MOAT subprocess (`list`, `run`, `exec`, `stop`, `destroy`) now runs with `cwd: workspace` so the workspace's `moat.yaml runtime:` selector is honored. Previously these inherited the Node process CWD and silently defaulted to `docker`, ignoring `runtime: apple` declarations and failing with "docker daemon not accessible" on hosts using Apple's container runtime.
- Default readiness timeout bumped from 10s → 180s. Cold first-run image builds on the apple runtime do apt-get installs and can take 30–60+ seconds; the previous 10s ceiling guaranteed a `MoatRunTimeoutError` on any user's first turn. Subsequent runs against the cached image still come up in seconds.
- `moat list --json` parser now reads both PascalCase (`Name`/`State`) and lowercase (`name`/`state`) keys. MOAT 0.5.x emits PascalCase from Go's default JSON marshaling; under the lowercase-only parser, the readiness loop polled a healthy container forever and the reconnect path never matched, both manifesting as `MoatRunTimeoutError`.
- `MOAT_RUNTIME` env var is now derived from the workspace `moat.yaml`'s top-level `runtime:` field (or explicit caller config) and injected into every MOAT subprocess. Required because `moat list` / `stop` / `destroy` don't read `moat.yaml` — only `moat run` does — so an `apple`-only workspace would fail those commands with "docker daemon not accessible" even when `moat run` worked.
- `startDetached` now pipes `moat run` stdout/stderr through the parent process with a `[moat:<runName>]` prefix instead of discarding it, so the 30–60s cold image build is visible in the dev server logs.

### Bash tool: scope `flush()` walk to mount prefixes

- `flush()` after every bash command/write previously ran `find . -type f` from the destination root (`/workspace`). Under providers that bind-mount the host repo — MOAT, Vercel sandbox — that traversed the entire user repo (every `.next/`, every per-package `dist/`, every source file), routinely exceeded the 60s `execTimeoutMs`, and silently aborted via `if (result.exitCode !== 0) return;` — which dropped any just-written artifact with no warning.
- `find` is now scoped to each mount's prefix path (`./artifacts`, `./skills`, `./tmp`) plus the scratch directory. Mount prefixes are the only paths flush can route into a collection anyway, so the wider walk produced no value to offset its cost. Hydrate now seeds an empty `.keep` marker into each mount-prefix directory so `find` doesn't error on collections that start with zero refs. The flush deletion pass skips this marker explicitly.
### Delta store verbs: `patchField`, `incField`, `pushToArray` (FIX-405)

- `Store` adapters can now implement three optional delta verbs that mutate one field at a time instead of rewriting the whole record. Single-field `patchState` calls map to `patchField`, `incState({ field: delta })` calls map to `incField`, and `pushState` calls map to `pushToArray`. Multi-field patches stay on `set` to preserve single-version semantics per logical mutation.
- The in-memory adapter and `@flow-state-dev/store-postgres` ship the verbs in this change. SQLite and filesystem keep working unchanged — `createScopePersist` feature-detects per call and falls back to `set` when an adapter doesn't advertise the verb.
- Postgres uses native JSONB operators (`jsonb_set`, `||`) wrapped in `UPDATE ... WHERE version = ?` so the row-level CAS contract from FIX-400 still holds for delta paths. A 100-op patchField benchmark against PGlite passes within 2× the cost of 100 `set` calls; on real Postgres the gap widens as the wire payload shrinks.
- Hot-path cleanup on the CAS retry loop: `MemoryStateContainer.read()` no longer deep-clones on every read (callers must treat the read result as immutable, which all in-tree scope ops already do), and the `JSON.stringify` size-estimate that ran on every CAS attempt is gone. The `onStateSizeWarning` callback is removed from `ScopeStateOpsOptions`.
- `docs/architecture/state-and-scopes.md` documents the routing decision tree and the container immutability contract.

## 2026-05-14

### Trading Desk example: wider indicator set and insider transactions (FIX-596)

- The technical analyst's indicator bundle expands from RSI/MACD/ATR/SMA50/200 to also include Bollinger Bands, VWMA(20), the Stochastic Oscillator (%K/%D), KDJ, and OBV. The hand-rolled `indicators-math.ts` is replaced with `trading-signals` (MIT) plus two small helpers for VWMA and KDJ.
- New `get_insider_transactions` tool wired into the news analyst — 90-day window of Form 4 filings with filing date, insider name and title, transaction code, signed share count, price, and derivative flag. Finnhub-only; returns `unavailable` on failure or missing key, consistent with the other single-provider tools.
- News analyst prompt updated to weigh insider transactions as ground-truth signal (cluster buying, executive selling streaks, derivative vs. open-market trades) and treat headlines as complementary context.
- Curated `insider-transactions.json` fixtures added for NVDA, AAPL, and JPM at the `2026-05-06` snapshot. Existing `indicators.json` fixtures extended with the new indicator fields.
- Lives entirely inside `examples/trading-desk/` — no framework changes.

### Observable model identity on generator emissions and block_trace (FIX-518)

- New `ModelIdentity` type exported from `@flow-state-dev/core`. Shape: `{ actual, requested?, gateway? }` — `actual` is always populated (provider-reported model id when present, otherwise the framework's winning candidate string); `requested` is set only when it differs from `actual`; `gateway` is set when the call routed through a gateway.
- Every generator-emitted item — `message`, `reasoning`, `source`, `tool_output`, and the transient `tool_call_progress` — now carries `model: ModelIdentity`. Handler-emitted items (via `ctx.emitMessage`) leave the field absent.
- `BlockTraceItem` for generator blocks gains a top-level `model` field as a sibling of `generator.model` (the requested string) and `modelUsage.model` (the token-accounting key). Populated even when the generator emits no items, so structured-only and tool-only turns have a durable audit trail.
- New `<ModelBadge model={item.model} />` in `@flow-state-dev/react`. Renders the `actual` model id as a pill with the requested/gateway in the tooltip; renders nothing when `model` is undefined. Kitchen-sink wires it next to the thinking-style badge on assistant messages.
- Additive change. Items persisted before this release surface as `model: undefined`, which renderers and audit consumers treat as absent.

### `block.asTool()` — render deterministic block calls as tool pills (FIX-593)

- New method on every `BlockDefinition`. Wrapping a block with `.asTool(opts?)` causes it to emit a `tool_output` item with the same envelope and lifecycle the AI SDK tool-loop wrapper produces inside a generator. The wrapped block runs normally and returns its typed output unchanged.
- Closes the transcript-visibility gap for flows that fetch data deterministically (e.g. inside `.parallel({...})`) and reserve the LLM for synthesis. Tool inputs known up front no longer have to choose between transcript pills and keeping the LLM out of the tool loop.
- `agentType` / `agentName` opts control grouping under the parent agent's card. Failures flip the emitted `tool_output` to `failed` with the error message visible and rethrow.
- Both `.asTool()` and the AI SDK tool-loop path now share a single envelope-emit path, so the two origins produce structurally identical `tool_output` items.
- Trading-desk example: the app-local `callAsTool` prototype is deleted; analysts switch to `.asTool({...})`. No behavioral change to the rendered transcript.

## 2026-05-13

### Trading Desk example: Phase 5 — portfolio manager final decision (FIX-564)

- The `analyze` action now runs end-to-end through five phases. A single `portfolioManager` generator reads the always-on upstream artifacts (Phase 2 investment thesis, Phase 3 trade proposal, Phase 4 risk assessment) and emits a typed `PortfolioDecision`. On the `full` preset it also reads the four analyst memos, the bull/bear debate transcript, and the three persona risk critiques.
- The structured output carries seven extension fields on top of the standard memo body: a five-tier `finalRating` (`Sell | Underweight | Hold | Overweight | Buy`), a one-line `decisionSummary`, a self-reported `decisionConfidence`, a typed `acceptedAdjustments` map that forces explicit accept-or-override with reasoning for each of the three risk-team recommendations, `keyDependencies`, `upstreamReferences`, and a derived `agreesWithTrader` boolean.
- The right-pane PM Hero is now wired — rating bar, design-mandated metrics row, accepted-adjustments panel, key dependencies, and a static citation list referencing each upstream memo's storage key. The PM Hero reads from the same `useResourceCollectionItem` hook every other memo uses; the marquee surface has no special-case data flow. The PM Hero's stale lowercase 5-tier vocabulary is updated to the design-mandated capitalized scale (`["Sell","Underweight","Hold","Overweight","Buy"]`).
- `agreesWithTrader` and `upstreamReferences` are computed at commit time rather than emitted by the LLM — both are fully determined by other stored values, so asking the model to mirror them would only add hallucination surface. Direction mapping: Buy/Overweight → long, Hold → flat, Underweight/Sell → short, compared against `trader.direction`.
- New `runComplete` session-state field, exposed to the client. Resets to `false` at `seedSession` and flips to `true` when the PM commit handler succeeds, so a PM failure leaves the run marked incomplete even though the flow itself completes. New `phase-5` enum value on `activePhase` drives the transcript phase divider.
- New `riskAssessment` preset on the `tradingDesk` capability that bundles the consolidated `memos/p4/risk-assessment` memo (body + typed extension fields). The existing `riskCritiques` preset covers only the three persona memos; Phase 5 reads both. A new `formatRiskAssessmentExtensions` helper in `services/format.ts` renders the typed fields for prompt context.
- Per-step rescue means a PM-generator failure isolates: only `memos/p5/portfolio-manager` flips to `error` while prior phases' memos still publish. End-to-end coverage in `examples/trading-desk/test/phase-5-e2e.spec.ts` exercises both the happy path (verifies all P5 extension fields populated, `upstreamReferences` resolves to canonical keys, `agreesWithTrader` derives correctly, `runComplete: true`) and the PM-fails path (`runComplete: false`, prior memos still published). Strict-mode regression in `output-schemas-strict.spec.ts` adds `portfolioDecisionOutputSchema` to the BP-016 walker.
- README polish: full Phase 5 subsection, "Phase 5 — single generator, weight in the schema" design-decision section, a "What this example is not" section that names the boundaries (not a product, not a backtest, not a recommendation system, not a complete data layer), and pointers to the architecture deep-dive and the public guide. New in-repo architecture doc at `docs/internal/design/trading-desk.md` covers pipeline shape, identity registry, data flow, capability surface, BP-016 schemas at convergence points, cost-preset routing, per-step rescue, and the comparison to what would be painful without the framework. New public guide at `apps/docs/guides/trading-desk-walkthrough.md` walks readers through the example phase by phase.

## 2026-05-12

### Bash tool: MOAT sandbox adapter (FIX-584)

- New `moat` provider for the bash tool, alongside `local`, `just-bash`, `vercel`, and `upstash`. Runs commands inside a MOAT-managed container on the same host as the agent. The host workspace is bind-mounted in; the agent process inherits no environment variables and outbound network calls flow through MOAT's credential-injecting proxy.
- `createBashCapability` now returns a `cleanupBlock` alongside the capability. Wire it into `defineFlow({ request: { onFinished: bashCap.cleanupBlock } })` to release the sandbox at request end. Required for MOAT to avoid orphaning containers; safe (effectively a no-op) for the other providers, so it's returned unconditionally.
- Closes a pre-existing concurrency race in the bash blocks' module-level sandbox registry: two concurrent requests for the same scope key now share a single in-flight sandbox creation instead of both creating one and leaking the loser. Harmless for the cheap adapters, container-orphaning under MOAT.
- Provider-aware context guidance: agents using the MOAT provider now see a system-prompt line that names the allowlisted hosts and explains the workspace boundary, mirroring the existing `local` / `just-bash` / `vercel` lines.
- Kitchen-sink wiring: `BASH_PROVIDER=moat` (with optional `MOAT_GRANTS` and `MOAT_ALLOW_HOSTS` env vars) now selects the MOAT provider for local development. The chat-agent flow wires `bashCap.cleanupBlock` into `request.onFinished` unconditionally so swapping providers via env vars cannot reintroduce a leak.
- `provider.persist: true` opts into reusing one MOAT container across requests. Paired with a stable `runName`, `sandbox.stop()` skips `moat stop` / `moat destroy` and the next request reconnects via `moat list --json`. Generated `moat.yaml` files carry an `# fsdev-managed` marker so a stale file from a prior persistent session is recognized as reusable instead of refused. Kitchen-sink defaults `persist: true` and derives `runName` from a hash of the project dir; `MOAT_PERSIST=0` or `MOAT_RUN_NAME=...` overrides.
- Documentation: `apps/docs/docs/tools/bash.md` and `packages/tools/README.md` describe the new provider, the cleanup wiring requirement, the credentials model, and the v1 limits (UTF-8 reads, 60s default exec timeout, no streaming, no auto-restart).

### Block trace honors the originating block's `transient` flag (FIX-586)

- Auto-emitted `block_trace` items now inherit `transient` from the originating block. Restores the FIX-478 contract that FIX-573's `block_output → block_trace` unification silently regressed by hardcoding `transient: false`.
- Transient blocks (Task Board's `claim-task` / `check-board`, eventActors poll-loop wrappers) keep streaming their trace lifecycle live to active SSE consumers, but the rows no longer enter the persisted items log or replay on history reload. Multi-worker Task Board runs against long-running LLM calls no longer flood the request items list with thousands of bookkeeping rows.
- Non-transient blocks (the default) are unchanged — their traces are still retained as the canonical record.
- `apps/docs/docs/streaming/emitting-items.md` reflects the live-vs-persisted distinction; the `BlockTraceItem` JSDoc and the `_blockIdentity.transient` type field document the inheritance rule so it can't silently regress again.

### DevTool: surface enough context on block failures to debug without reproduction (FIX-582)

- `block_trace.error` and `tool_output.error` gain an optional `details: Record<string, unknown>` field. The runtime auto-populates it for framework-internal cases that previously discarded context; author-thrown `FlowError.details` flows through verbatim.
- Generator output-validation failures now throw `OutputValidationError` carrying `{ rawOutput, issues, phase }`. The raw model text and the Zod issues survive to the trace instead of collapsing to a single message string.
- `FlowError` relocated to `@flow-state-dev/core` so handler authors in third-party packages can throw it without a server dependency. Server's typed subclasses still extend it; existing `instanceof FlowError` checks keep working unchanged.
- DevTool's failed-block detail panel renders a dedicated "Raw output" pane for the model's text, a typed "Validation issues" list for Zod issues, and a generic "Details" JSON panel for any other keys. Failed tool-invoked blocks gain Input and Tool call sections, closing the "Input: null" gap on the failure path.
- New advanced docs page on error handling, cross-linked from the rescue and DevTool pages.

## 2026-05-11

### Scheduled actions: schedule index, auto-mirroring, and Vercel helpers (FIX-581)

- New `ScheduleIndex` interface in `@flow-state-dev/scheduled` for store-backed schedule fan-out. Implementations track `(userId, key, cron, timezone, nextFireAt)` rows and expose `upsert`, `remove`, and `claimDue` (atomic claim-and-advance).
- `@flow-state-dev/store-postgres` and `@flow-state-dev/store-sqlite` each ship a factory (`createPostgresScheduleIndex`, `createSQLiteScheduleIndex`) that plugs directly into the interface.
- `defineScheduleCollection` in `@flow-state-dev/scheduled` wraps `defineResourceCollection` with the standard schedule state schema and mirrors every create, update, and delete into an attached index automatically. Rows with `enabled: false` are removed from the index, so disabling a schedule stops it firing without deleting the record.
- `@flow-state-dev/vercel/schedules` ships `createGetToPostCronShim` and `createScheduleTickHandler`. Vercel hosts no longer need to hand-roll the GET-to-POST adapter or the polling tick; both helpers authenticate with constant-time bearer comparison and forward the same secret to the dispatch endpoint.
- Vercel Cron and dynamic-schedules guides updated to recommend the helpers; hand-rolled patterns are preserved as "Advanced" subsections for custom auth, storage, or retry requirements.

### DevTool full resource visibility, independent of prefetch / client config (FIX-579)

- New privileged debug read surface under `/api/flows/sessions/:id/debug/resources*` on `@flow-state-dev/server`. Returns the full server-side resource layer for a session — every storage key, raw state, content metadata, and a per-entry `clientView` showing what production clients would receive after `client.data` projection.
- The surface is fail-closed: off by default, opt in via `debugEndpointsEnabled: true` on `createFlowApiRouter` or the `FSDEV_DEBUG_ENDPOINTS=1` env flag. Loopback-origin gate by default; widen with `debugAllowedOrigins`. `fsdev dev` enables it automatically.
- Dual-registered resources (same `DefinedResource` exposed under multiple accessor names) collapse into one entry with both aliases listed, rather than two disconnected rows.
- Collection counts are bounded — `debugCountLimit` (default 1000) caps enumeration on org / flow-scope collections; items beyond the cap report `itemCountTruncated: true`. Items endpoint paginates regardless of size.
- Two adjacent fixes on existing client-facing collection routes: list response now returns both `topic` (bare) and `storageKey` (full) per item; single-item response emits a `hint` field when no `client.data` projection is configured, pointing developers at the debug endpoint.
- **Breaking (internal surface):** the previous undocumented DevTool query params on `GET /api/flows/sessions/:id/state` (`include_internal_resources`, `include=internal_state`) have been removed. The state endpoint is now strictly client-shaped — the same shape a production React app sees. The DevTool reads from `/debug/resources*` instead. Callers using these params would have been internal tooling only; `internalState` and `internal: true` markers no longer appear on the response.

### Server: session-state schema defaults are pre-applied at session creation (FIX-561)

- `handleCreateSession` now parses an empty `body.state` (or any caller override) through `flow.session.stateSchema` before persisting, so a brand-new session's `state` already contains every declared key with its initial value (`z.string().default("...")`, `z.record(...).default({})`, etc.). Previously `state` was initialized to `{}` and schema defaults only landed after the first `patchState` call.
- This was the root cause of the trading-desk navigator showing memos jump `pending → published` with no `writing` flicker on first-run sessions. The chain: empty initial state → `expose`-projected `clientData[scope]` keys are `undefined` → `JSON.stringify` drops undefined values on the wire → client snapshot has no `memoStatus` key at all → `mergeStateChangeIntoSnapshot`'s `hasOwn(prev, field)` guard bails on every mid-stream `state_change` until the terminal-status snapshot refresh. Pre-applying defaults breaks the chain at step one.
- Caller-supplied `body.state` still wins — the schema parse runs over `(body.state ?? {})`, so explicit overrides aren't clobbered. On schema-parse failure (caller supplied invalid data), the handler falls back to the raw caller state to preserve prior behavior; per-action validation still runs at execution time.

### React: `useClientData` no longer misses mid-stream state changes on first-run sessions (FIX-561)

- `useSession` now buffers `state_change` SSE items that arrive while the initial snapshot fetch is still in flight, and drains them onto the snapshot the moment it lands. Previously the reducer (`mergeStateChangeIntoSnapshot`) bailed when `prev === null` and silently dropped every state change between SSE subscribe and snapshot resolve.
- This sits alongside the server-side default-application fix above; the buffer covers the snapshot-fetch-races-SSE case while the server fix covers the initial-state-empty case. Both classes of "first-run misses mid-stream updates" are addressed.
- Internal cleanup: `pendingStateChangesRef` is cleared on session-id change so a session switch can't carry stale buffered events across.

### Round Robin: default roster agents stream text into the transcript (FIX-561)

- The default roster agent (`createRosterAgent`) no longer hardcodes a `z.object({ text })` output schema. It now uses the generator's default `z.string()` output, which makes the streaming gate fire and emit live `message` items — chat-style transcripts render the debate in real time without any custom wiring.
- The default roster agent now stamps `agentName` on its underlying generator. Without this, emitted message items carried no identity and chat-style transcripts that scope to known agents (e.g. `if (AGENTS[message.agentName] === undefined) continue`) silently dropped the messages even though the streaming path was working.
- The contributions resource is unchanged. `record-contribution` already coerces both string and `{ text }` outputs via `coerceText`, so consumers that read the contributions transcript see the same `{ round, agentName, text }` entries.
- Override path: callers who need a roster agent to emit structured output (a vote roster, a structured proposal) supply their own `block` via `RosterEntry`. Setting `outputSchema` on the default agent isn't a configuration option; that's a different agent shape and belongs in an override.
- Visible symptom that motivated the change: trading-desk Phase 2 bull/bear contributions never showed up in the transcript because the default agent's structured-output path skipped the streaming gate at [`generator.ts:1765`](packages/core/src/blocks/generator.ts) (`isTextOutputSchema` returns false for object schemas), and once that was fixed the missing `agentName` caused the consumer-side filter to drop the messages a second time.

### Resource API: multi-segment collection topics now resolve (FIX-561)

- `GET /sessions/:id/resources/:ref/:topic`, `GET /sessions/:id/resources/:ref/:topic/content`, `PATCH .../:topic/content`, and `DELETE .../:topic` now match topics that contain `/`. Previously `:topic` was a single-segment path-to-regexp parameter, so any collection with a `**` pattern (topics like `p1/fundamentals`, `p2/research-manager`) returned 404 from these endpoints even when the resource existed on the server.
- Visible symptom that motivated the fix: React `useResourceCollectionItem` calls failed silently for the trading-desk example's `memos/**` collection — sessions had all 7 memos persisted, but the per-item REST fetch the UI depends on 404'd, so the theses pane and DevTool item bodies appeared empty.
- The route table now uses `*topic` (path-to-regexp v8 wildcard); `stringifyParams` joins the captured array on `/` before the route builder runs, so the resulting `topic` is still a string for downstream handlers. New regression tests cover state, content, and delete with slash-bearing topics.
- Constraint: a topic literally named `"content"` is shadowed by the `/:ref/content` resource-content route and remains unaddressable through the state-get endpoint. Documented in `apps/docs/docs/resources/client-access.md`.

### `makeSchemaStrict` is now public; BP-016 codifies OpenAI strict-mode rules for generator outputs (FIX-561)

- `@flow-state-dev/core` re-exports `makeSchemaStrict(schema)` from the package root. The helper was previously internal; the framework still calls it automatically before serializing schemas to the AI SDK, but authors can now import it to assert their generator `outputSchema` passes OpenAI strict mode at test time.
- `makeSchemaStrict` unwraps `optional` / `default` / `nullable`. It does NOT transform `z.record()` or `z.union()` of differently-shaped variants — both still fail OpenAI strict and must be rewritten at source.
- BP-016 ("Generator outputSchemas must be OpenAI strict-compatible") lands in `docs/contributing/best-practices.md` with concrete rules and canonical patterns. Cross-referenced from the root `CLAUDE.md`.

### Trading Desk example: Phase 2 per-step rescue + end-to-end integration coverage (FIX-561)

- Phase 2's `phase2Pipeline` switched from a single pipeline-level `.rescue([...])` over bull → bear → research-manager to three independent sub-sequencers, each with its own rescue (mirroring Phase 1's per-analyst idiom). A single consolidator failing now flips only its own memo to `error` with a captured `errorMessage`; downstream consolidators still publish.
- The unused `markPhase2ErrorOnWriting` aggregate-rescue handler is removed.
- New end-to-end spec (`examples/trading-desk/test/phase-2-e2e.spec.ts`) exercises the full `analyze` action against mocked generators and asserts all seven memos publish, the research-manager memo carries non-empty `unresolvedDisagreements`, and a bull-side failure isolates correctly.
- New schema-strict regression spec (`examples/trading-desk/test/output-schemas-strict.spec.ts`) walks each generator output schema after `makeSchemaStrict` and fails on surviving `ZodOptional` / `ZodDefault` / `ZodRecord` / non-literal `ZodUnion`. Copy-paste guard for any package defining generator outputs.
- Trading-desk's `memosCollection` adopts FIX-580's identity default (omit `expose` / `exclude` / `data` and ship the full state) — replaces the interim `data: (state) => state` workaround that lived briefly during merge.

### Resource client projection shortcuts: `expose`, `exclude`, and identity default (FIX-580)

- `defineResource` and `defineResourceCollection` now accept `client.expose` (whitelist) and `client.exclude` (blacklist) alongside the existing `client.data` function. Field names in `expose` / `exclude` are type-checked against the state schema, so typos fail at build time with a `Valid keys: …` error.
- The three projection forms are mutually exclusive. Setting more than one throws at definition time with a clear "pick one" message. Omit all three to ship the full state — the new identity default.
- The previous silent-empty footgun is gone: `client.state.read: true` without a `data` projection no longer returns the empty-looking `{ topic }` shape. List and snapshot responses now always carry per-item `clientData` when state reading is gated on.
- Trading-desk's `memosCollection` and the `eventActors` workspace resource migrate to the new shortcuts. The function-form `data` keeps working unchanged — it's now the documented escape hatch for computed fields.

## 2026-05-10

### Scheduled actions: declarative cron + dispatch endpoint (FIX-440)

- New `schedules?` config block on `defineFlow` accepting a typed `static` map for framework-level cron jobs and a dynamic `resolve(scheduleId, ctx)` hook for per-user, per-record, and agent-created schedules. Cron strings (POSIX 5-field) are validated at registration for static entries and at dispatch for dynamic ones via `cron-parser`. The framework owns the dispatch contract; hosts run their own scheduler.
- New `@flow-state-dev/scheduled` package shipping `createScheduledTransportAdapter`, `findScheduledRequest`, and `createResourceCollectionScheduleResolver`. Mounts `POST /api/flows/:kind/schedules/:scheduleId/dispatch` and a sibling `GET /api/flows/:kind/schedules` listing endpoint.
- Two-phase auth: `host.resolvePrincipal` establishes the gateway principal (proves the dispatch caller is the trusted scheduler) and each schedule carries an optional `principal` that wins for the action's effective user. New `createBearerSecretPrincipalResolver` exported from `@flow-state-dev/server` for the canonical shared-scheduler-secret pattern, with constant-time `timingSafeEqual` comparison.
- Resource-collection-backed dynamic schedules via `createResourceCollectionScheduleResolver`. Hosts that store schedule definitions in a flow-state user-scoped collection wire the resolver in one line; the helper parses `<userId>/<key>` from the URL, reads from the user-scoped store, and synthesizes `principal: { userId }`. Because the parsed userId is also the storage scope, a URL aimed at another user's data reads from an empty scope and 404s.
- `RequestRecord.source = "scheduled"` plus structured `metadata` (`scheduleId`, `origin: "static" | "dynamic"`, `cron`, `nominalFireTime`, `dispatchedAt`, `timezone`). DevTool renders a per-row schedule-id label, a static/dynamic origin badge, and a Provenance section in the detail view.
- Idempotency (per-process LRU keyed on `(scheduleId, nominalFireTime)`, default 60s window) and `onOverlap: "skip" | "allow"` (skip is default; uses `findScheduledRequest` over `stores.activeRequests.listAll()`). Multi-process deployments rely on the host scheduler's own idempotency.
- Four integration guides shipped: Vercel Cron, Cloud Scheduler, EventBridge Scheduler, and a longer dynamic-schedules guide covering user-created and agent-created schedules end-to-end. Server reference page and architecture deep-dive added; locked-contracts reference and inbound-transports docs updated.

## 2026-05-08

### Round Robin pattern: `contributions` config option for shared transcripts (FIX-561)

- `roundRobin({ contributions })` accepts an externally-provided contributions resource. When omitted the pattern still creates its own internal instance, so existing consumers are unchanged.
- Sharing one resource across multiple instances behind a `router()` now succeeds — previously the router's resource-merge rejected with `Resource conflict: "contributions" is declared with different defineResource() references`.
- Consumer blocks outside the pattern can declare the shared resource on their own `resources:` slot and read entries via `ctx.resources` instead of threading the transcript through `RoundRobinFinalShape.contributions`.

### Trading Desk example: Phase 2 bull/bear research debate and investment thesis synthesis (FIX-561)

- The `analyze` action now runs through Phase 2 after the analyst fan-out: a bounded bull-vs-bear loop driven by the Round Robin pattern, then three new memos for `bullResearcher`, `bearResearcher`, and `researchManager` cycling `pending → writing → published`. The cheap preset runs one round; the full preset runs two. The ceiling is enforced at the schema boundary regardless of caller input.
- The research manager emits a typed `InvestmentThesis` carrying five extension fields on the memo state — `stance`, `conviction`, `keyRisks`, `keyOpportunities`, and an explicit `unresolvedDisagreements` list. Empty is acceptable but should be the exception on a non-trivial trade. Phase 3+ read these directly to reason about non-convergence rather than papering over it.
- Phase 2 picks Round Robin over Debate because the research manager is a synthesizer, not a judge. The pattern's required judge slot is filled with a 3-line stub that always returns `done: false`, leaning on `maxRounds` for termination — the canonical idiom for fixed-length loops. Phase 4's risk debate keeps `debate()` for its real risk judge.
- A router selects among four pre-built `roundRobin()` instances at runtime, one per `(maxDebateRounds, costPreset)` combination. All four share a single `phase2Contributions` resource registered on the flow; the bull/bear consolidation and research-manager generators declare it on their `resources:` slot and read entries from `ctx.resources`.
- The transcript renders the phase divider, bull/bear speak rows tagged by round, and the research manager's `InvestmentThesis` as a structured-output card. The right-pane sidebar now lights up the three Phase 2 entries live.

### Trading Desk example: Phase 1 analyst fan-out, data layer, and two-pane streaming UI (FIX-575)

- The `analyze` action now runs end-to-end: `seedSession → phase-1-analysts (parallel × 4)`. Four `Thesis`-shaped memo resources are pre-created in `pending`, then transition `pending → writing → published` (or `error`) live mid-stream as each analyst sub-sequencer commits or rescues.
- Ten canonical tools land behind a `DataSource` interface — fixture-backed by hand-curated NVDA / 2026-05-06 JSON (with minimum-viable AAPL and JPM fixtures), and a `LiveDataSource` wrapper that wires Yahoo Finance for prices and fundamentals (no key required); news, sentiment, and macro stay fixture-only with a follow-on.
- The top bar exposes `preset` (`fast` → `intent/utility`, `full` → `intent/chat`) and `source` (`fixture` / `live`) segmented controls so the live-data toggle is observable to a user running the demo.
- Transcript pane renders phase dividers, tool rows with `FIXTURE` / `LIVE` source pills, and analyst speak rows with a streaming-caret tail. The right pane dispatches `(agentName, status)` to `pending` / `writing skeleton` / `ThesisHeader + ThesisBody` / `error`, with `PMHero` shipped (exercised first in Phase 5).
- Session client-data fields (`ticker`, `date`, `costPreset`, `dataSource`, `activePhase`, `memoStatus`) flipped from `client.derived` to `client.expose` so the navigator's mid-stream status flicker comes from `useClientData` directly. Body content reads from `useResourceCollectionItem` keyed on each memo's `collectionKey`.

## 2026-05-07

### `useClientData` reflects mid-stream state changes (FIX-576)

- `ctx.session.patchState`, `ctx.user.patchState`, `ctx.org.patchState`, and `ctx.request.patchState` (and their `setState` / `incState` / `pushState` / `setStateRecord` / `deleteStateRecord` / `atomicState` siblings) now emit `state_change` SSE items with the matching `scope` value. Previously only sequencer / target-state writes emitted on the wire.
- `useClientData` consumers in React see `expose` keys update mid-stream — within the same paint as the block's mutation — instead of waiting for the request to terminate. Derived projections continue to refresh once at terminal status.
- React's `useSession` reduces incoming session/user/org-scope `state_change` deltas into the cached snapshot via a new pure `mergeStateChangeIntoSnapshot` helper that handles `patch`, `set`, `increment`, `push`, `delete_key`, and `setStateRecord` deltas, and skips `atomic` mutations (no structured delta).
- The reducer only updates keys already present in `clientData[scope]` — non-exposed raw state keys can never leak through. Trade-off: the first set of an expose key whose initial value was `undefined` won't surface mid-stream; declare a default in the scope's `stateSchema` if that matters.
- Re-render isolation is preserved: a delta touching one expose key doesn't churn consumers reading a different one — the reducer returns the prior snapshot reference when the merge is a no-op.

### Container lifecycle: live in-flight signal for sequencers (FIX-574)

- `container` items now emit `item.added` with `status: "in_progress"` when a sequencer or router scope opens, then patch to `completed` (or `failed`) via `item.updated` when the scope closes. The terminal `item.done` follows. Previously the container appeared with terminal status in the same flush, so slow sequencers gave no in-flight feedback.
- New optional fields on `ContainerItem`: `startedAt`, `completedAt`, `duration`, and `error: { message }` on failure.
- First public-channel item type to use the `item.updated` primitive from FIX-572. Existing renderers continue to work — the settled snapshot reaches consumers either way.

### Block trace unification (FIX-573) — BREAKING

- Trace channel now uses a single `block_trace` item per block run, replacing the old `block_output` / `block_debug` split. Carries input, output, error, timing, and (for generators) the resolved prompt and model config.
- `block_tool_output` renamed to `tool_output`. Both `tool_output` and `block_trace` now emit when a block runs as a tool; the called block's output is a `ref` to the tool_output to avoid duplication.
- Block traces stream live: an in-progress trace appears the moment a block starts, with input, prompt, and output filled in via `item.updated` events as they resolve.
- Hooks `onBlockDebugCapture` and `onConnectedInput` collapsed into a single `onBlockTraceCapture(payload, ctx)` keyed by phase (`added` / `input` / `generator` / `output`).
- Migration: rename `block_output` → `block_trace` and `block_tool_output` → `tool_output` at consumer dispatch sites. The old `block_debug` payload moves under `block_trace.generator` and `block_trace.input.connected`. See `apps/docs/docs/streaming/items.md` for the full rename table.

### Live tail on Vercel + Neon: opt out of LISTEN, force polling

Kitchen-sink on Vercel + Neon was failing to deliver post-catch-up live events on a midstream refresh. Two issues stacked on top of each other: the auto-created `liveTailPool` in `createPostgresStores` ignored the caller's `poolOptions`, so a Neon `Client` override applied to the main pool didn't reach the tail pool; and even with the right driver, Neon's pooled (`-pooler`) endpoint is pgbouncer in transaction mode, where `LISTEN flow_events` registers on a backend that gets recycled at transaction end and never sees the matching `NOTIFY`. Two fixes:

- `@flow-state-dev/store-postgres`: the auto-created `liveTailPool` now spreads the caller's `poolOptions` so driver-level overrides (Neon's WebSocket `Client`, custom `connectionTimeoutMillis`, etc.) carry over. `max` and `allowExitOnIdle` remain tail-specific.
- `apps/kitchen-sink`: explicitly passes `liveTailPool: null` on Vercel to force the polling fallback. Polling is correct for serverless deployments where listener sessions don't survive function recycles, and the ~250ms tail latency is invisible behind model generation. Local-with-Postgres deployments keep LISTEN/NOTIFY.

Locks the polling path in with a new conformance run against `createPostgresRequestStore` configured with `liveTailPool: null`, so future regressions in the polling code path get caught by `pnpm --filter @flow-state-dev/store-postgres test`.

### Action POST disconnect no longer kills runAction

The HTTP request signal was previously propagated into `runAction` via `actionInput.signal`, so a tab refresh or browser-side cancel of the originating POST aborted the in-flight execution and marked the record `interrupted`. Subsequent reconnect-via-GET-stream then only saw the catch-up replay and no live continuation. The action route no longer sets `signal: request.signal`; runAction's own registered abort controller remains the path for explicit cancellation, and the SSE wire still closes on disconnect at the readable-stream layer. Refresh midstream now resumes against the still-running request.

### Store-driven live tail (FIX-569)

The in-process active-streams registry is replaced by `RequestStore.subscribeToEvents`. SSE clients can now tail an in-flight request from any instance, including multi-instance Postgres deployments and serverless deployments with shared Postgres.

- New `subscribeToEvents(requestId, options)` on the `RequestStore` interface, returning an `AsyncIterableIterator<RequestStreamEvent>`. `getEvents` widens with optional `fromSequence` for cursor reads (backward compatible — omitting it returns the full log).
- Per-store implementations: memory uses an in-process bus; SQLite, filesystem, and Postgres-without-`liveTailPool` poll on a fixed interval; Postgres with `liveTailPool` uses `LISTEN flow_events` on a dedicated client with a signal-only payload, single global channel, and dirty-bit burst coalescing (Notifier Pattern). PGlite falls back to polling.
- `createPostgresStores` accepts `liveTailPool` separately. When omitted on the connection-string shape it auto-creates a fresh `Pool({ max: LIVE_TAIL_POOL_MAX ?? 10 })`. The liveness timeout (`LIVE_TAIL_LIVENESS_MS`, default 30s) governs writer-death detection — on stall the iterator yields a synthetic `request.interrupted`.
- Conformance harness `createRequestStoreConformanceTests` shipped via `@flow-state-dev/server/testing`; memory, SQLite, and filesystem stores all run it.
- Long-running flows are no longer at risk of registry eviction — the legacy 5-minute stale-stream TTL is gone. SSE wire format and `createFlowApiRouter()` shape are unchanged.

### Lazy collection state, query interface, and resource manifest (FIX-427) — breaking

- Collection snapshots dropped the eager `items` map; entries now carry `count` (always) and an opt-in `prefetched` window. Per-item `clientData` in the window requires the new `client.state.read` permission.
- New paginated list endpoint (`GET /sessions/:id/resources/:ref?limit=&offset=&topicPrefix=`) and single-item state endpoint (`GET /sessions/:id/resources/:ref/:topic`). Pagination returns `{ offset, limit, total, hasMore, nextOffset }`; the get-state endpoint returns `null` body when absent.
- New manifest endpoint (`GET /sessions/:id/manifest`) describes every public resource on a flow — kind, scope, pattern, declared permissions, prefetchWindow. Static per `flowKind`.
- `defineResourceCollection` gains `prefetchWindow?: number`. Items are selected by **lexicographic storage-key sort**, not by recency.
- React surface: `useResourceCollection` returns `{ list, get, query, actions, refetch, prefetched, count }`; new `useResourceCollectionList`, `useResourceCollectionItem`, and `useResourceManifest` hooks for the common cases.

### `item.updated` SSE event for shallow-merge field deltas (FIX-572)

Items whose non-text fields evolve between `item.added` and `item.done` now have a structured update primitive on the wire, replacing the prior choice between re-emitting whole items or never reflecting mid-flight state.

- New `item.updated` SSE event carrying `{ itemId, patch }` with shallow top-level merge semantics. Producers re-supply nested objects in full as new top-level values; identity-invariant keys (`id`, `type`, `provenance`, `agentType`, `transient`) are stripped server-side and ignored client-side.
- New `emitItemUpdated(itemId, patch)` on `ResponseEmitter`, sibling to `emitItemAdded` / `emitItemDone`. Also reachable via `response.emit({ type: "item.updated", ... })`. Updates for an unknown `itemId` are dropped with a debug event; updates after `item.done` apply normally.
- Client SSE dispatcher routes the event to a new `onItemUpdated` callback. The DevTool stream consumer and `@flow-state-dev/react`'s `useRequestStream` apply the merge to their items map without touching item order.
- No producers ship in this change — `block_trace` and `container` lifecycles adopt the primitive in follow-up PRs.

### Debate pattern (FIX-328)

New `debate` factory in `@flow-state-dev/patterns` for multi-round adversarial argumentation with assigned stances and a single judge that runs once at the end. Built on the Round Robin chassis with three structural specializations: every debater carries an assigned `stance`, every debater sees all prior arguments from all agents, and the judge produces a structured `{ verdict, winner, reasoning }` after the loop instead of terminating it round-by-round.

- New subpath export `@flow-state-dev/patterns/debate` and matching named exports from the package root: `debate`, `DebaterConfig`, the schemas (`debateInputSchema`, `debateStateSchema`, `debateContributionEntrySchema`, `debateVerdictSchema`, `debateTranscriptStateSchema`), and the building-block factories (`createDebater`, `createDebateJudge`, `createDebateSynthesize`, `createDebateInitTranscript`, `createDebateRecordArgument`, `createDebateTranscript`, `formatDebateTranscriptForJudge`).
- Bias mitigations ship on by default: `anonymizeTranscript` strips debater names from the judge's view to defuse identity-self-bias when the judge model matches a debater model; `shuffleForJudge` randomizes per-round argument order in the judge's prompt to defuse position bias. Both are opt-out. Tests that need deterministic shuffling can call the exported `formatDebateTranscriptForJudge` helper with an injected RNG.
- Default `maxRounds` is 2; values above 4 emit a warning about diminishing returns and sycophantic convergence. The default debater prompt is non-conceding by design.
- Reference docs at `patterns/debate`, package README section, sidebar entry between Round Robin and Event Actors, and cross-links from Round Robin and the patterns overview.

### Memory system: structured-output repair + per-block model overrides (FIX-570)

Hardens the memory system's consolidation and prune generators against the most common LLM structured-output failure modes, and exposes per-block model overrides with optional fallback chains.

- **Output repair.** `tf.memory/consolidate/generate` and `tf.memory/prune/generate` now register a `repairOutput` hook that recovers from common mis-shapes before the schema re-validates: bare arrays (`[{...}]`) wrapped under the envelope key with all sibling keys defaulted to `[]` in a single pass (`{ facts: [...] }`, `{ removals: [...], merges: [] }`) so multi-key schemas don't burn a separate repair attempt to fill in the missing key; narrative text containing a JSON code block parsed out; output truncated mid-stream (typical when `max_output_tokens` hits during a long array) recovered by walking back to the last balanced `}` and synthesizing closing brackets; partial objects missing array keys defaulted to `[]`. Unrecoverable strings degrade to an empty envelope with a `[tf.memory]` warning so a single bad cycle doesn't crash the background `.work()` step. Combined with `repair: { mode: 'auto', maxAttempts: 3 }`, most one-off structured-output drift on smaller models recovers transparently.
- **Fallback chains.** `MemorySystemConfig.model` (and `MemorySystemBlocksConfig.model`) now accept `string | string[]`. Arrays build a `createFallbackModel` chain — the generator walks the list on retryable provider errors.
- **Per-block model overrides.** New optional `consolidationModel?: string | string[]` and `pruneModel?: string | string[]` fields. Defaults to `model` when omitted. Lets operators run a stronger model (or a chain) for the heavier structured-output demands of consolidation while keeping the observer on a small fast model.
- **Recall-tool model coercion.** When `config.model` is an array, the recall tool's strategy defaults to the first entry. Pass `tool.model` to override.

Migration: transparent — existing single-string `model` values continue to work unchanged.

### Filesystem trace store + dev-mode retention defaults (FIX-558)

Trace events now survive `fsdev dev` and kitchen-sink `STORE_TYPE=filesystem` restarts. `createFilesystemStores` wires a paired filesystem trace store under `{rootDir}/traces/` instead of falling back to in-memory.

- New `FilesystemTraceStore` and `createFilesystemTraceStore` (exported from `@flow-state-dev/server`). Append-only `.ndjson` per request plus a `_roster.json` for FIFO insertion order; coalesces concurrent appends per request and round-trips arbitrary request IDs via URL-encoded filenames.
- Registry factories pick `traceStore.maxRequests` from the environment: 1000 when `NODE_ENV=development`, 50 otherwise. An explicit `traceStore: { maxRequests }` always wins. Applies to in-memory, filesystem, and SQLite.
- New shared `createTraceStoreConformanceTests` helper exposed at `@flow-state-dev/server/testing`. The in-memory, filesystem, and SQLite stores all run the same conformance suite; backend-specific cases stay alongside each implementation.
- Trace channel reference doc gains backend overview, local-dev subsection, and production subsection. Server and store-sqlite READMEs document the new option.

### Lift `.work()` background tasks to a request-level pool (FIX-554) — breaking

`.work()`, `.workIf()`, and `.forEachBackground()` previously queued onto the dispatching sequencer and the sequencer auto-awaited its own list before returning. That meant inner sequencers serialized siblings — two parallel branches each calling `.work()` ran one after the other instead of concurrently.

- Background tasks are now queued on a single per-request pool. Inner sequencers no longer auto-await; the request executor drains the pool exactly once before terminal status. Sibling sequencers' `.work()` tasks run concurrently — request wall time is roughly the slower branch, not the sum.
- The SSE stream still stays open until the drain completes. `backgroundTasks: N` status emissions are preserved; they now reflect the request-level pool count.
- `.waitForWork()` semantics tighten: it drains by sequencer-instance scope, so it waits on the calling sequencer's tasks only, not unrelated siblings'. Failure handling unchanged (`failOnError` throws the first failure; otherwise failures are logged).
- **Migration:** if your code relied on the inner-sequencer auto-await for ordering — e.g. an inner `.work(setupBlock)` followed by a parent step that read state mutated by `setupBlock` — add an explicit `.waitForWork()` at the inner sequencer boundary. An audit of `packages/patterns`, `packages/thought-fabric-core`, and `apps/kitchen-sink` found no callers that needed migration.

## 2026-05-06

### Round Robin pattern (FIX-318)

New `roundRobin` factory in `@flow-state-dev/patterns` for fixed-roster, deterministic-order multi-agent coordination. Every agent in the roster contributes once per round in declared order, seeing the full prior transcript. After each round a judge returns `{ done, summary }` and the loop exits on done or when `maxRounds` (default 5) is reached.

- New subpath export `@flow-state-dev/patterns/round-robin` and matching named exports from the package root: `roundRobin`, `RosterEntry`, the schemas (`roundRobinInputSchema`, `roundRobinStateSchema`, `roundRobinContributionEntrySchema`, `roundRobinJudgeOutputSchema`), and the building-block factories (`createRosterAgent`, `createRoundRobinJudge`, `createRoundRobinSynthesize`, `createRoundRobinContributions`).
- The transcript lives in a session-scoped writable resource owned by the pattern. Per-turn audit records mirror it in a sequencer-backed `TaskCollection` so DevTool sees one record per `(round, agent)` turn.
- Roster entries default to a built-in LLM agent that reads the contributions resource and renders prior turns into its prompt; a custom `block` per entry replaces it without losing the audit and transcript wiring. Override blocks may return either `string` or `{ text }`.
- Judge is required and runs after every round. There is no judge-less mode in v1 — for fixed-rounds-only behaviour, supply a stub judge that always returns `done: false` and rely on `maxRounds`. Setting `outputSchema` while `synthesizer: false` is a definition-time error.
- Reference docs at `patterns/round-robin`, package README section, sidebar entry between Routed Specialists and Event Actors, and cross-links from Routed Specialists, Supervisor, and the patterns overview.

### `clientData` privacy fix + API rename to `client.expose` / `client.derived` (FIX-505)

The session snapshot route used to ship raw scope state (`state.request`, `state.session`, `state.user`, `state.org`) alongside `clientData`. Documentation said state was private; the wire format said otherwise. Snapshots are now opt-in for raw state, and the public API for declaring what's visible is one consistent shape on scopes and resources.

- The default snapshot response no longer includes raw scope state. `response.state` is gone. Any consumer reading `snapshot.state.*` breaks at the type level — that's the privacy fix.
- New per-scope `client: { expose: string[], derived: { name: fn } }` on `session`, `user`, and `org`. `expose` lists state fields to pass through verbatim; `derived` names compute functions over `{ state, resources }`. State without a `client` block is private.
- Legacy `clientData: { name: fn }` keeps working with a one-time deprecation warning per scope per process; setting both `client` and `clientData` on the same scope now throws at definition time, as does any `expose`/`derived` name collision or `expose` key not present on `stateSchema`.
- DevTool escape hatch: `?include=internal_state` re-attaches raw state under `internalState` (never `state`). The DevTool opts in automatically. Match for FIX-506's `?include=trace`.
- `FlowClient.state.getSessionState/getUserState/getOrgState` are removed — they were typed against the privacy-broken response. `getSnapshot` stays; read `clientData.<scope>` from it.
- Kitchen-sink and reference docs (`fundamentals/state-and-scopes`, `flows`, `type-system`, `api/core`, `resources/storage`, `models`, `skills/activation`, two guides, the core README, and the architecture overview) reflect the new shape.

### Trace channel separation, public type cleanup, `step_error` removal (FIX-506)

The public `OutputItem` union shrinks from 15 to 10 entries. The four trace types (`block_output`, `router_decision`, `state_snapshot`, `block_debug`) leave the union and are now observability-only — they ride the same SSE wire as production items but are server-filtered by default. Subscribe with `?include=trace` to receive them. The query parameter previously named `?unfiltered=true` is renamed; the old name is gone.

- Public `BlockValue<T>` is now `inline | structure`. The `ref` case and the `refBlockValue` helper move to `@flow-state-dev/core/items/internal`. The four trace type names (`BlockOutputItem`, `RouterDecisionItem`, `StateSnapshotItem`, `BlockDebugItem`) stay exported from `@flow-state-dev/core/items` so first-party imports keep compiling.
- New `traces: TraceStore` on `StoreRegistry` with in-memory (default 50 requests, 5 MB/request) and SQLite implementations. Retention is independent of `RequestRecord` GC, so the DevTool can replay traces from a completed request after its record is gone.
- New `ctx.emit.{message, component, status, trace.*}` namespace. The flat `ctx.emitMessage`, `ctx.emitComponent`, `ctx.emitStatus` continue to work as deprecated aliases that emit a once-per-process console warning on first use. Aliases are removed at next major.
- **Retracts the user-facing portion of commit `8e0bd62b`** ("emit `step_error` for background work failures and render as warning"). `step_error` is removed entirely — the type definition, named export, `emitWorkStepError`, every renderer dispatch, and doc references are gone. Failed `.work()` blocks now surface only via the trace-channel `block_output` and the existing `console.error`. Migration: any code switching on `item.type === "step_error"` should be removed; that case is unreachable.

### Framework: `mapModelOutput` — model-visible representation separate from structured tool output

Adds a new `BlockDefinition.mapModelOutput((output, ctx) => string)` method that lets a tool block declare a separate, model-visible representation of its output. The structured `TOutput` keeps flowing through the framework — `block_tool_output` items, downstream sequencer steps, devtool, tests, and history replay all see the original value. The mapper fires only at the AI SDK bridge boundary, producing the string the LLM observes on its next turn.

- New method on every block kind. Both `TInputSchema` and `TOutputSchema` are preserved — unlike `connectOutput`, `mapModelOutput` does not reshape downstream consumers. When the block is used as a regular sequencer step (not via `tools: [...]`), the mapper is silently inert.
- Plumbed through the AI SDK v6 bridge as `toModelOutput` so providers materialise next-turn tool-result content from the mapper's string instead of the structured envelope.
- Recall tool migrated as the validating consumer: structured `RecallToolResult` keeps flowing through devtool/replay, and the LLM sees a compact bulleted summary built by the new exported `formatRecallSummary` helper. Token cost on a 5-result return drops well below half the previous JSON envelope.
- Devtool inspection: when a tool block declares `mapModelOutput`, the wrapper emits a `block_debug` item carrying the mapper's string. Devtool can render it side-by-side with the structured `block_tool_output`, so you can see what the LLM saw alongside what the block produced. Gated by `FSDEV_TRACE_OBSERVABILITY`; transient, never persisted, never sent to LLM context.
- Mapper is expected to be deterministic: history replay re-runs it on the persisted structured output rather than persisting the string itself.

### Generator: log unparseable candidates + raise consolidation repair attempts

When a generator's output schema rejects the model's response and repair gives up, the framework now logs the actual candidate to stderr alongside the validation error. Previously the only signal was `Generator output validation failed: Expected object, received string` — which tells you the schema saw a string but not *what* string. Operators had to re-run with a debugger or page through the request's block_debug item to see what the model returned.

- New stderr log lines on terminal failure:
  ```
  [generator:generate] "tf.memory/consolidate/generate" output failed schema validation: Expected object, received string
  [generator:generate] candidate (string): Sorry, I cannot consolidate these episodes…
  ```
- Candidate dump is truncated at 2000 chars; full payload is still recoverable from the request's block_debug.
- Same dump fires from both the non-streaming (`generate`) and streaming (`stream`) terminal paths.

Also raises `tf.memory/consolidate/generate`'s repair attempts from the default 1 to 3. Small models occasionally drop out of structured-output mode and return narrative text; with one auto-repair attempt the framework gave up too quickly and surfaced a `step_error` for what was usually transient flakiness. Three attempts let it recover before the background task fails.

## 2026-05-05

### Recall tool: per-source pre-rank — semantic facts always reach the filter

Fixes a structural starvation in the `llm-filter` strategy's prepare gate: when episodic memory was large and recent (200+ episodes at significance 0.9+), the unified intrinsic pre-rank pool filled with episodes and only the most-reinforced semantic facts squeezed in. A real-world repro on devuser showed 47 episodic + 3 semantic in a 50-candidate pool — every wife-related semantic fact was dropped before the LLM filter ran, and the agent answered "Jennifer" by reading episodic chat history while the semantic record about Moni never appeared.

- **Per-source pooling.** `prepareBlock` no longer pools both stores under one cap. Semantic facts pass through unconditionally (the semantic store is bounded by `pruneThreshold` upstream). Episodes are intrinsically pre-ranked and capped at the new `PRE_RANK_EPISODIC_CAP` (default 30).
- **Stage 1.5 exact-phrase pass-through** still runs but only over episodes that didn't make the cap. Semantic facts are all already in.
- **`PRE_RANK_CAP` is deprecated.** Kept exported as the previous value (50) for back-compat with custom strategies that imported it for parity. The strategy itself no longer references it. Will be removed in a future major.
- **Migration:** transparent for `tool: { strategy: 'llm-filter' }` consumers — the change is purely in the candidate pool composition. Custom strategies that used `PRE_RANK_CAP` should switch to `PRE_RANK_EPISODIC_CAP`.

### Recall tool: `RetrievalStrategy` becomes block-factory shaped

Reshapes the public `RetrievalStrategy` contract that custom recall backends implement. Strategies used to expose a single `rank(query, ctx, opts)` method called from inside the recall tool's `execute`. They now expose framework blocks the tool composes as a sequencer (`prepare → optional filter → format`), so no handler in the pipeline reaches into `asRuntime()` to invoke a generator (BP-011).

- **Removed public types**: `RankedResult`, `RetrievalStrategyContext`, `RetrievalStrategyOptions`, and the `rank()` method on `RetrievalStrategy`. Anyone with a custom `RetrievalStrategy` will need to migrate.
- **New public types**: `PrepareInput`, `PrepareEnvelope`. `PrepareInput` is what reaches the strategy's `prepareBlock` (the recall tool defaults/clamps `limit`, stamps `strategyName` and `perItemCharCap`). `PrepareEnvelope` is the carrier threaded between `prepare`, the optional filter+merge, and `format`.
- **`RetrievalStrategy` shape**: `{ name, prepareBlock, filterBlock?, formatBlock? }`. `prepareBlock` is required and produces the envelope; `filterBlock` is the optional LLM filter step (omit it for vector/keyword backends and the tool surfaces the intrinsic top-N directly); `formatBlock` is an optional override on the tool's default formatter.
- **New exports** from `@thought-fabric/core/memory`: `defaultFormatBlock`, `buildResult`, `buildResultMetadata`, `capContent`, `TRUNCATION_MARKER`. Custom strategies that override `formatBlock` can reuse the helpers without re-implementing per-item char capping, hallucination dropping, or score normalisation.
- **Built-in strategy unchanged at the consumer level**: `tool: { strategy: 'llm-filter' }` keeps working; the `llm-filter` strategy now ships `prepareBlock` (intrinsic pre-rank + exact-phrase pass-through) plus `filterBlock` (single bounded LLM call). Token spend per call remains bounded regardless of total store size.
- **Migration**: see `apps/docs/thought-fabric/memory.md` for the new strategy shape and an example.

### Memory capability: orthogonal section presets + configurable formatter (FIX-513 pivot)

Pivots away from the role-named `agent` / `worker` memory capability presets. The original FIX-513 design bundled "context formatter + recall tool" under role labels, which conflated two unrelated axes: which memory tier gets re-injected into the prompt, and whether the agent has a search tool. Authors who wanted only working memory but no digest, or recent episodes alongside the digest, couldn't express that without giving up the formatter entirely.

- **Five orthogonal section presets** replace `agent` / `worker`: `digest`, `working`, `semantic`, `episodic`, `recall`. Default-on set is `['digest', 'working', 'recall']`. Each preset toggles independently with `.presets({...})`. `mem.capability` (no args) keeps the same effective behaviour as the old `agent` preset, so the migration nudge is contained: every consumer of `presets({ agent: …, worker: … })` updates to one of `presets({ digest: …, working: …, recall: …, semantic: …, episodic: … })`.
- **Inclusion is independent of processing.** The capture pipeline still runs `tf.memory/digest/regenerate`, consolidation, and prune for whichever tiers are configured on `memorySystem({...})`. Disabling the `digest` preset on a worker generator just suppresses the section in *that* prompt — the underlying digest stays fresh for any other generator that opts in.
- **Configurable formatter factory.** New export `createMemoryContextFormatter(options?)` from `@thought-fabric/core/memory`. Options: `{ digest?, working?, semantic?: { topN } | bool, episodic?: { limit } | bool }`. The boolean presets use fixed defaults (top-10 facts, last-5 episodes); reach for the factory directly when those defaults aren't right.
- **Pre-FIX-407 sections are back, opt-in.** The simplification that removed semantic-fact and episodic-memory injection from the formatter is partially reversed — they're now selectable sections rather than always-on or always-off. The recall tool path remains the canonical way to fetch *specific* details on demand.
- **Migration:** kitchen-sink's `workerUses` updated from `presets({ agent: false, worker: true })` to `presets({ digest: false, working: false })`. `MemoryCapabilityPreset` type changes from `'agent' | 'worker'` to `'digest' | 'working' | 'semantic' | 'episodic' | 'recall'`. `mem.contextFormatter` direct callers see no change — it remains an alias for `createMemoryContextFormatter()` with default options. Docs at `apps/docs/thought-fabric/memory.md` updated.

### Recall tool: per-source pre-rank gate, semantic facts pass through

Splits the unified pre-rank pool inside the `llm-filter` strategy's `prepareBlock` into two independent gates. Failure mode driving the change: high-significance recent episodes were crowding moderately-reinforced semantic facts out of the unified top-50 pool, leaving the LLM filter with no facts to score against on queries where a fact would have been the right answer.

- **Semantic facts pass through unconditionally.** The semantic store is already bounded by `pruneThreshold`, so the worst case is well within the filter's token budget. No score-based admission, no cap.
- **Episodes are scored intrinsically and capped at `PRE_RANK_EPISODIC_CAP = 30`** (replaces the old unified 50-item cap shared with facts). Stage 1.5 exact-phrase pass-through still runs over episodes the cap dropped; semantic facts skip the pass-through because they're all already admitted.
- New export from `@thought-fabric/core/memory`: `PRE_RANK_EPISODIC_CAP`. Custom strategies that previously imported `PRE_RANK_CAP` for parity should switch to this.
- `PRE_RANK_CAP` is now `@deprecated` but still exported. Internally unused; kept so prior consumers keep compiling. Removed in a future major.
- Visible to consumers: the candidate set the filter sees is different — facts are no longer crowded out, and episodes that would have made the top-50 mixed pool but not the top-30 episodic pool now fall through to the exact-phrase tier rather than the filter.

### Memory pipeline + tool naming reliability fixes

Behavior fixes shipped after the memory + tool-naming work above landed:

- **Memory `contextFormatter` returns an object, not a pre-formatted string.** Returning `<digest>…</digest>\n<working>…</working>` as a single string caused the framework's context aggregator to XML-escape the inner tags as text — the model saw `&lt;working&gt;`. The formatter now returns `{ digest?, working? }`, which the aggregator nests as proper child tags under `<memory>`. Public type on `MemorySystem.contextFormatter` is updated; consumers reading the value directly need to handle the object shape (no behavior change for the standard `context: { memory: mem.contextFormatter }` wiring).
- **Digest regenerates every turn the source signature drifts.** Previously `digestRegenerate` was wired only inside the consolidation and prune `generate-and-persist` chains, both gated by guards that need ≥4 turns and ≥5 episodic writes. Until those gates triggered the digest never refreshed regardless of how much state had changed. Capture now appends `digestRegenerate` as a top-level `.work()` step when `digest` is configured; the block's own staleness guard keeps the cost cheap when nothing has drifted.
- **OpenAI tool-name pattern compliance, end to end.** Framework-namespaced tool blocks like `tf.memory/recall` are aliased to `^[a-zA-Z0-9_-]+$` form before submission to providers that enforce it (notably OpenAI). The alias is now applied in three places: the outbound `tools` dictionary, the auto-described tool listing inside the system prompt, and the `toolName` field on historical tool-call / tool-result messages replayed from session items. Inbound stream chunks and result `toolCalls` are translated back to original framework names so observability stays consistent. `sanitizeToolName` is now exported from `@flow-state-dev/core/utils/tool-name` (and re-exported via the `@flow-state-dev/core/utils` barrel).
- **Tool-call replay reads alias from item metadata, not from the framework name.** Replacing the message-time `sanitizeToolNamesInMessages` band-aid: `BlockToolOutputItem.toolCall` now carries an optional `alias` field (the model-facing sanitised name), populated at emit time inside the generator's `compileToolsWithExecute`. The server's `itemToLLMMessages` reads `bto.toolCall.alias ?? sanitizeToolName(bto.toolCall.name)`, so the toolName the model sees on replay is the same string it produced on the original turn. Items written before this field existed continue to work via the fallback. The `sanitizeToolNamesInMessages` pass is retained as defence-in-depth; it's now a no-op for items emitted on or after this change.
- **Recall tool prompt wording is more directive.** `recallToolDescription` now explicitly tells the model to use the tool for personal/user-specific details that aren't in the visible context summary. The exported constant remains a string; only the wording changed.
- **`workIf` predicate sees the running value.** The condition now takes `(value, ctx)` like `thenIf` and `tapIf` instead of `(ctx)` only. Lets authors gate background dispatch on the upstream output (e.g. skip perspective capture when the assistant produced empty text).
- **Failed background work surfaces as `step_error`.** Rejected `.work()` / `.workIf()` tasks emit a client-visible `step_error` item alongside the existing failed `block_output`, so renderers can show a non-fatal warning instead of treating the failure as a request error. The `ErrorDisplay` renderer now distinguishes by item type — `error` (red, terminal) vs `step_error` (yellow, non-fatal) — rather than by `recovered`.
- **Perspective capture tolerates empty content.** The bundled `${name}/capture` sequencer accepts empty content at its outer schema and short-circuits via `thenIf` so a `.work()` slot receiving an empty assistant response is a no-op instead of a background-work failure. The inner `analyze` block keeps its strict non-empty contract.
- **Kitchen-sink memory now opts into the digest tier.** `memorySystem({...})` was missing `digest: true`; without it the `<memory>` section had nothing to render once working memory was in use. Also fixed `dev:watch` so edits to `thought-fabric-core`, `tools`, `patterns`, and `ui` trigger a Next.js restart — previously those packages' rebuilds didn't propagate without a manual `pnpm dev` restart.

### Memory: simplified `contextFormatter` — digest + working memory only (FIX-407)

- `mem.contextFormatter` now emits a single `<memory>` block containing only the rolling digest (when configured) and current working-memory entries. Output is naturally bounded by the digest's `maxTokens` and the working-memory capacity — no separate budget knob.
- Behavior change: semantic facts and recent episodes are no longer pre-injected into the prompt. Agents retrieve them on demand via the recall tool (FIX-409).
- Returns `undefined` when both the digest and working memory are empty so the generator omits the section entirely.
- No `maxTokens`, `topN`, `strategy`, or `estimateTokens` knobs on the formatter API. Per-generator load behavior moves to the `agent` / `worker` presets in FIX-513.

### Memory: rolling digest tier (FIX-408)

- New `digest` tier in `@thought-fabric/core`'s memory system. A single LLM-generated narrative paragraph that summarises stable knowledge about the user, sitting above atomic semantic facts as the always-on framing layer.
- Regenerates as a side effect of `consolidate` and `prune`. A source-state signature short-circuits the LLM call when nothing has changed; previous digest is fed back into the prompt so framing stays stable across regenerations.
- `memory.system({ digest: true | { maxTokens, topN } })` opts in; default `maxTokens` is 400. Digest scope is inherited from `semantic`.
- `mem.regenerateDigest` exposes a manual escape hatch that bypasses the staleness guard — useful after bulk-loading memory in setup or in tests.
- New `digestMemoryCapability` exposes `get` / `content` for blocks that read the digest. The composed `mem.capability` installs the digest resource alongside the other tiers.

### Resource content moves out of scope records (FIX-347)

- `SessionRecord`, `UserRecord`, and `OrgRecord` no longer carry a `resourceContent` field. Content lives exclusively in `ContentStore`, keyed by `(scopeType, scopeId, resourceKey)`. Concurrent writes to different resources no longer contend on the scope-record CAS path.
- Execution context, state routes, and resource routes all read and write content through `stores.content` directly. The legacy on-record content path and its merge logic are gone.
- Filesystem adapter writes each resource as a real file under `data/content/<scope>/<id>/<key>`. SQLite and Postgres adapters use a dedicated `resource_content` table.
- Operators upgrading from a build that persisted inline content must copy each record's old `resourceContent` map into `ContentStore` before deploying — see the migration note in `packages/server/README.md`.

### Memory: agent-invocable `recall` tool (FIX-409)

- New `mem.tool.recall()` factory on `memory.system()` returns a handler block agents can install on a generator with `tools: [mem.tool.recall()]`. Searches stored memory — semantic facts and past episodes — on demand. Working memory is intentionally excluded; it already lives in the formatter, so surfacing it through the tool would duplicate context cost.
- One unified tool, not three. The agent's mental model is "find a thing I knew" — whether the thing is a fact or an episode is an implementation detail surfaced as a `source` field on each result rather than a routing decision the LLM has to make.
- Pluggable `RetrievalStrategy` interface. V1 ships `'llm-filter'`: query-blind intrinsic pre-rank (top 50 by `confidence × reinforcement` for facts, `significance × exp(-age/50)` for episodes) followed by a single LLM filter call over the bounded candidate set. Token spend per call is bounded regardless of total store size. Optional Stage 1.5 exact-phrase pass-through catches distinctive strings (proper nouns, error codes) buried in low-score memories.
- Result envelope includes `query`, `strategy`, `totalMatched`, `truncatedTo` so the agent can detect "more available" and re-query. Per-item char cap (default 400) with a truncation marker prevents runaway result sizes.
- Configure via `memory.system({ tool: { strategy, model, defaults } })`. Custom strategies implement the same interface; the keyword (FIX-410) and hybrid (FIX-412) backends will plug in without changing the tool surface. The memory capability gains a `tool` preset (off by default in this release; FIX-513 introduces `agent`/`worker` presets that bundle it).

## 2026-05-02 (later)

### MCP server adapter — every flow is reachable from MCP clients (FIX-22)

- New `@flow-state-dev/mcp` package. Mounts as a sibling of the built-in HTTP adapter via `createFlowApiRouter({ adapters: [createMcpTransportAdapter()] })`. Every flow with `mcp.enabled: true` becomes its own MCP server at `POST /api/flows/:kind/mcp`; `GET` and `DELETE` return 405.
- Per-flow `mcp` config and per-action `description` and `mcp.enabled` on `defineFlow`. Tool names derive deterministically from action keys via `decamelize` (`recordPayment` → `record_payment`); collisions and missing descriptions throw at flow registration.
- Authentication runs through the existing `host.resolvePrincipal` hook — bearer tokens, HMAC, or anything else a flow's `authentication.resolvePrincipal` returns. `PrincipalResolutionError` maps to HTTP 401 + JSON-RPC `-32001` with `WWW-Authenticate: Bearer realm="MCP"`.
- v1 ships stateless-only with single-text-content tool results — no `Mcp-Session-Id`, no `notifications/progress`, no `outputSchema`/`structuredContent`. `resources/list` returns the empty list pending a flow-bound resource scope.
- DevTool already renders MCP-originated requests with a purple `MCP` badge from FIX-438; no devtool change needed.

## 2026-05-02

### Quick-start rewrite + new model-setup and first-flow pages (FIX-496)

- `apps/docs/docs/getting-started/quick-start.md` rewritten to introduce ≤6 concepts before the chat works: block, generator, sequencer (mentioned), flow, `useSession`, default item rendering. Removed: counter handler with `return input` (BP-014 violation), `agentType` ceremony, `clientData`, `requireUser: true` boilerplate, the `chatFlow({ id: "default" })` factory ceremony, and the per-item `<ItemRenderer>` map. The example now uses the framework's default `<ItemsRenderer items={...} />` plural renderer and `defineFlow({...})()` to register without a separate factory step.
- New page `apps/docs/docs/getting-started/setting-up-models.md`. Covers env-var-based provider detection (Anthropic, OpenAI, Google, Vercel Gateway, OpenRouter), what `preset/small` resolves to, how to override or define presets, direct `provider/model` strings, and plugging in custom provider instances. Linked from the new quick-start callout so a senior engineer can go from `pnpm install` to a streaming chat in under ten minutes.
- New page `apps/docs/docs/getting-started/your-first-flow.md`. A narrative walkthrough that builds the same chat in five steps, introducing one block, scopes, a `.tap()` state-mutation pattern (BP-012-compliant), sequencer composition, and the React rendering layer. Targets the reader who wants to understand the primitives, not just to copy a recipe.
- `apps/docs/sidebars.ts` Getting Started category reordered to surface the new pages: quick-start → setting-up-models → your-first-flow → installation → project-structure. Sidebar reorg beyond Getting Started is out of scope (FIX-495).

## 2026-05-01

### Per-scope FIFO mutation queue replaces optimistic CAS for in-memory scopes (FIX-492)

- In-memory state scopes (target state, sequencer state — anything without a `persist` callback) now serialize mutations through a per-`StateContainer` FIFO queue. `ConcurrentModificationError` is no longer thrown for these scopes; supervisor patterns with `concurrency > 1` complete reliably under sustained contention instead of intermittently failing once the CAS retry budget exhausts.
- External-store scopes (filesystem, sqlite, postgres adapters) keep the optimistic CAS path. Their `persist` callbacks signal version mismatch when a remote authority advances state; CAS retries with exponential backoff still apply, and `ConcurrentModificationError` continues to surface when retries exhaust.
- New `flow.request.mutationTimeoutMs` (default 30s) bounds the worst-case wait for any in-memory mutation. When a mutator's queue wait + execution exceeds the budget, `ScopeMutationTimeoutError` is thrown instead of hanging the request indefinitely. Set to `Infinity` to disable.
- Supervisor's reviewer chain audit-state moved off the task collection's request scope onto the supervisor sequencer's outer state (`reviewMetadata[taskId]`). The task collection now sees only the irreducible `claim` / `complete` / `fail` writes from `taskBoard`, eliminating the contention surface that drove the original failure.
- No public API change to `atomicState`, `patchState`, `pushState`, `incState`, `setStateRecord`, `deleteStateRecord`. Behavior under `concurrency: 1` is unchanged.

### Tier 1 flow integration test suite (FIX-487)

- New `@flow-state-dev/integration-tests` workspace package (private). Seven scenarios drive whole flows through `runAction` against in-memory stores with mocked generators: hello-chat smoke, ask-mode happy path, tool-loop convergence, build-mode artifact, plan-and-execute, session resume, and the supervisor + task-board regression. Suite finishes in a few seconds; loop guards plus a 30s vitest `testTimeout` catch infinite-loop regressions deterministically.
- `mockGenerator` accepts `{ when, then }` predicate entries alongside plain steps. Predicates match by input and stay matchable on every call; plain steps still consume sequentially. Lets concurrent patterns (supervisor workers, parallel plan-and-execute steps) be mocked without depending on call order.
- `mockGenerator` now simulates the AI SDK's internal multi-step tool loop. When a returned step has `toolCalls` but no terminal `text`/`structuredOutput`, the mock model invokes each tool's `execute` closure and pulls the next script step until a terminal step or `maxSteps` is hit.
- `testFlow` accepts an optional `stores: StoreRegistry`. Multiple runs sharing the same registry preserve session, journal, and resource state across calls. Seeding is idempotent — already-seeded users/sessions/orgs aren't re-`set`.
- New `apps/docs/docs/testing/flow-integration-tests.md` page positions the new tier between `testBlock` and `fsdev run`. Linked from the Testing sidebar.

### Make `fsdev run` the primary CLI dev loop for agents (FIX-490)

- `fsdev run` now emits `[flow-state] *` runtime events to stderr by default at `info` level — action lifecycle, block lifecycle, retries, errors. Previously these were silently dropped because the command never passed a logger to `runAction`. New `--quiet` suppresses them; new `--log-level <debug|info|warn|error>` sets the threshold. The CLI always passes an explicit logger so the server's `console.*`-backed default never writes runtime traces to stdout and corrupt the NDJSON stream.
- New `--capture <path>` writes the full structured run output to a JSON file (`{ command, events, result }`) — additive with stdout NDJSON, parent directories created as needed.
- `AGENTS.md` gains a "Verifying flow changes during development" section that frames `fsdev run` as the default verification tool and shows the kind-of-change → tool routing (CLI for flow logic, vitest for units, browser for UI). `CLAUDE.md` adds a one-line orientation pointer; `apps/kitchen-sink/CLAUDE.md` adds a "Testing this app" section. New `apps/docs/docs/cli/agent-dev-loop.md` page covers the same loop for human readers, linked from `cli/overview.md`.
- Mock-fallback claim in `AGENTS.md` audited and rewritten. `createModelResolver` has no mock fallback — without a configured provider, generator blocks fail with `No provider available for "<provider>"`. The doc now describes the actual behavior and points provider-free smoke tests at vitest.
- `@flow-state-dev/testing` no longer re-exports `createInboundTransportConformanceTests` and `createMockTransportHost` from its index. Conformance helpers import `vitest` at module top level, which made any non-test consumer (notably the CLI) fail to load. They're available via the new `@flow-state-dev/testing/conformance` subpath export.

### Migrate / retire queue-shaped patterns onto `taskBoard` substrate (FIX-448)

- **Removed** `drainPool` and `eventQueue` patterns. The `taskBoard` substrate gives both for free: drainPool's lease/concurrent-drain semantics are exactly what taskBoard provides (CAS-safe claim, lease/reclaim, per-task error policy); eventQueue is a sequential taskBoard with `fifoDispatcher` and mid-run enqueue. Existing call sites migrate to `taskBoard({...})` directly. The kitchen-sink's chat-agent demo action `event-queue` is rewritten as `task-queue-demo` against `taskBoard` with `getOrCreateTaskCollection({ backing: "request" })` for mid-handler enqueue. `EventQueueProgress` removed from `@flow-state-dev/react`.
- **Renamed** `blackboard` to `routedSpecialists`. The controller-pick → specialist loop now stores per-iteration records in a sequencer-backed `TaskCollection` (assignee = picked specialist, output = specialist result); the shared workspace stays as a sibling writable resource. `createBlackboard` → `createWorkspace`. `<Plan />` renders the decision sequence natively. Default controller's "previous decisions" prompt section is now read from `collection.list({ status: "completed" })` ordered by `completedAt` and FIFO-trimmed by `maxHistory`.
- **Renamed** `reactiveBlackboard` to `eventActors`. Each actor invocation becomes a `Task` in a request-backed collection (assignee = actor name, `metadata.depth` = reactive cascade depth). The `mesh()` factory is renamed `eventActors()`; `reactiveBlackboard()` factory is renamed `createEventActorsWorkspace()`. `actor()` unchanged. The reEmit cascade is implemented via in-actor `collection.addTask()` calls with depth tracking; `taskBoard` is the inner drain. Entry log stays as a sibling writable session resource. UI continues to render `container: "reactive-blackboard"` containers — the entry-log timeline component is unchanged.
- Net source LOC reduction: ~−2360 across `packages/patterns/src/` (well past the 40% spec target). Kitchen-sink, UI registry, docs, and skill files updated in the same pass.

## 2026-04-30

### Decouple `emit*` default-transient from `blockTransient`; document the keyed-snapshot pattern (FIX-478)

- `ctx.emitMessage()` and `ctx.emitComponent()` no longer inherit the producing block's `transient` flag. Both default to `transient: false` (persisted) regardless of whether the calling block is transient. The block flag retains its single intended meaning: suppress the framework's auto-emitted `block_output` bookkeeping for that block.
- `ctx.emitStatus()` continues to default to `transient: true` (statuses are naturally ephemeral). All three emitters now accept a per-call `{ transient?: boolean }` override for symmetry.
- Reverts the FIX-447 surgical workarounds (the explicit `transient: false` overrides in `getOrCreateTaskCollection`'s `onChange` and in the `boardMetaActive` / `boardMetaCompleted` blocks) — the architectural fix at the framework layer makes them redundant.
- Documents the **keyed snapshot** pattern (component item with a stable `key`, latest-wins per `${requestId}:${key}`) and the four-cell `transient × key` matrix in `apps/docs/docs/streaming/emitting-items.md`. Cross-links from `OutputItemBase.transient`, `ComponentItem.key`, and the `BlockContext` emit JSDocs. No new APIs — the pattern was already supported, just unnamed.
- Behavior change: third-party blocks declared `transient: true` that previously relied on `emitMessage` / `emitComponent` calls being auto-suppressed will now persist those items. Migration is one keyword: pass `{ transient: true }` explicitly on the emit call.

### Reduce SSE stream noise: no-op `patchState` guard + transient state slots (FIX-477)

- Framework-level no-op guard in `applyMutation`. Every state-write helper (`patchState`, `setState`, `incState`, `pushState`, `setStateRecord`, `deleteStateRecord`, `atomicState`) now compares the proposed next state against the current state. When deep-equal, the persist call is skipped, no `state_change` SSE item is emitted, and the helper returns `false` instead of `true`. Idempotent writes are now free.
- New `transientSlot()` helper in `@flow-state-dev/core` marks top-level fields on a sequencer's `stateSchema` as in-memory only. Transient slots stay readable across the sequencer's run via `ctx.sequencer.state` but never appear on the SSE stream, never write to the durable checkpoint store, and reset to schema defaults on resume.
- `taskBoard` worker schemas mark `lastClaimed` and `currentTaskId` as `transientSlot`. The narrow `lastClaimed` identity-check guard FIX-447 added to `claim-task.ts` is reverted — the framework guard subsumes it.
- **Breaking (internal):** `runWithCAS` now returns `{ state, committed }` instead of bare `Readonly<TState>`. `applyMutation` and the seven `ScopeStateOps` helpers now return `Promise<boolean>`. Existing call sites that ignore the return value are source-compatible; direct shape assertions on `runWithCAS` need updating.

### Streaming-text throughput: `content.delta` reclassified as non-replayable (FIX-479)

- `content.delta` events (covers both message and reasoning streaming — they share the same wire type) are no longer persisted to the events log and no longer await the `flushEvents` durability barrier. Per-token disk round-trips were serializing concurrent worker streams behind a single per-request events queue; under a supervisor with `concurrency: 3` and three streaming workers the queue saturated and the request appeared to lock up.
- Running text is checkpointed via the items snapshot instead. The emitter mutates the in-flight `MessageItem.content[i].text` (and `ReasoningItem.summary[i].text`) in-place on each delta and fires a new `ResponseEmitterItemHooks.onItemUpdate` hook. `runAction` wires this hook to a coalesced `persistItems` write — the `FilesystemRequestStore`'s `itemWriteQueued` sentinel keeps disk I/O bounded by the natural write rate regardless of token rate.
- Resume contract change. Mid-stream reconnects via `Last-Event-ID` no longer replay the exact token sequence — the running text snaps to the latest persisted snapshot and continues from the next live delta, with the eventual `item.done` payload superseding. Page-load bootstrap now shows the latest accumulated text for in-flight messages instead of empty content, which is strictly better than before. Completed messages still replay exactly.
- Live SSE consumers, devtool observers, and the in-memory event buffer continue to receive every `content.delta` event unchanged. Filesystem and Postgres stores benefit transparently — the change is at the emitter, not the store.

### Sub-agent items as first-class data for parent agents (FIX-480)

- `TaskCollectionRef.list` / `get` now return a `TaskHandle` — the existing `Task` data fields plus an `items()` accessor that returns the items emitted during the worker's claim window. Pattern aggregators (synthesizer prompt builders, reviewer input builders, replanners) can now pick from a worker's natural emissions — `message`, `source`, `tool_call`, `reasoning` — instead of relying solely on `task.output`. Sync, throw-free, returns `[]` until the task is claimed.
- Streaming-text generators (`outputSchema: z.string()`, `agentType` set) now emit their `block_output` as `BlockValue { kind: "ref", sourceItemId }` pointing at the just-emitted `MessageItem`, rather than inlining a duplicate copy of the same text. `resolveBlockValue` resolves the ref transparently to the joined `output_text` content. Object-output generators are unchanged. The streaming path's defensive equality check (returned string == accumulated stream) prevents the ref emission when post-validation transforms (`z.string().transform(...)`) mutate the value.
- `BlockOutputLookup` renamed to `ItemLookup`; the old name stays as a non-breaking alias. `buildItemLookup(items)` indexes every item by id (not just `block_output`s) so refs may resolve to messages.
- Substrate utility `extractTaskItems(items, collectionId, taskId)` and `computeTaskItemWindows(items, collectionId)` exported from `@flow-state-dev/tasks`. Same algorithm the kitchen-sink renderer uses for per-task expansion in `<TaskPlan />`; available server-side for any pattern that wants to inspect a worker's window without touching the renderer.
- Supervisor's `buildResults` handler now also returns a `resultItems` field — `Array<{ taskId, goal, items }>` — alongside `results`. The default synthesizer's user prompt appends a deduped `Sources:` block when worker `source` items are present. Custom synthesizers ignoring the new field continue working unchanged.

### `taskBoard` follow-up: dep materialization, sub-agent tool visibility, render hygiene (FIX-447)

- `TaskWorkerInput.deps` is now substrate-supplied. The worker dispatch path resolves each `task.deps[]` entry to its dep's `output` and passes the map to the worker before invocation. Workers read upstream context via `input.deps[depId]` directly — no pattern plumbing required.
- `block_tool_output` items now carry the parent generator's `agentType` and `agentName`. Sub-agent tool calls are now correctly excluded from primary-agent LLM history (the visibility contract in `resolveItemVisibility` was already in place; the framework just wasn't stamping the field).
- `planAndExecute` and `supervisor` no longer emit `task-board-meta` phase markers (`synthesizing`, `completed`-after-synth) from their synthesize step. The substrate's own `boardMetaCompleted` (during board drain) is the canonical board-level meta. Stops the renderer's status badge from flipping back to "Synthesizing…" once the synthesizer ran, and keeps `<TaskPlan />` mounted at a stable chat position.
- `<TaskPlan />` (kitchen-sink + ui registry) row expansions render a vertical timeline of windowed items — compact tool-call rows, message lines, reasoning lines, and the worker's `task.output` Markdown — instead of nesting the chat-thread `<ToolGroup>` card inside the section card. Tool-call summary extraction lifted into a shared `tool-summaries.ts` helper used by both reactive-blackboard and task-plan. Per-task ownership now keys on `item.ts` (timestamps), not `item.itemIndex`, so AI-SDK tool emissions that land after the worker's terminal `task-change` still attribute to the correct task.
- Default P&E executor and synthesizer prompts now thread source URLs through the task chain. Workers see prior-task summaries plus the URLs that actually informed each prior result; the synthesizer is instructed to cite URLs inline as Markdown links and end with a `Sources` section listing only the URLs it relied on. Distinction is explicit: pass and cite sources that were leveraged, not every URL the search returned.
- Substrate-internal task-board blocks (`claimTask`, `checkBoard`, `recordSuccess`, `recordError`, `seedCollection`, board-meta emitters) marked `transient: true` so their auto-emitted `block_output` traces are filtered from client subscriptions and history replay. Idle workers no longer flood the SSE stream with `block_output` trace records every poll tick. `claimTask` also skips its `lastClaimed` state patch when the value is unchanged. Both are point-fixes for FIX-477.
- Pattern-level status messages now describe what the agent is actually doing instead of leaving the chat at the default "Thinking…". `claimTask` emits `Working on: {task.goal}` on each successful claim. P&E, supervisor, and parallelTasks set phase statuses on their planning, evaluation, replanning, review, and synthesis blocks (e.g. `Planning the steps`, `Reviewing progress`, `Adjusting the plan`, `Putting it all together`).

### Connection resilience (FIX-476)

- Server emits `: ping\n\n` SSE comment frames on every live and GET-attach response (default 15 s). Heartbeat injection moved out of `@flow-state-dev/vercel` into `@flow-state-dev/server` so every deployment — including non-Vercel and POST inline streams — gets it.
- New server-internal sweeper marks `in_progress` requests whose executor heartbeat stopped as `interrupted`, releasing session locks. On by default in `createFlowApiRouter` (30 s cadence, 60 s threshold); set `staleSweepIntervalMs: 0` to disable.
- New read-only `GET /api/flows/:flowKind/requests/:requestId/status` endpoint returns a `RequestStatusSnapshot`. Callable when no SSE is connected; used by the client dismiss path to confirm authoritative server state.
- `useSession` now exposes `isStuck` (watchdog-tripped flag) and `dismissRequest(requestId?)` (works without a live SSE handle). `sendAction` auto-dismisses a stuck prior request before opening the new stream, with a synthetic abort item making the prior attempt visible.
- Client SSE parser detects comment frames and fires a new `onHeartbeat` callback alongside regular events.
- `RequestStatus` and `RequestStatusSnapshot` now live in `@flow-state-dev/core/types`. `@flow-state-dev/server` re-exports `RequestStatus` for backward compatibility.
- Vercel adapter no longer injects heartbeats itself — the core handles it. `VercelHandlerOptions.heartbeatMs` is now a deprecated no-op; configure via `createFlowApiRouter({ defaultSseHeartbeatMs })` or per-flow `defineFlow({ request: { sseHeartbeatMs } })` instead.
- Docs: new `apps/docs/docs/server/connection-resilience.md` (linked from the Server sidebar); sections added to `packages/server/README.md`, `packages/react/README.md`, `apps/docs/docs/streaming/overview.md`; deprecation note in `packages/vercel/README.md`.

## 2026-04-29

### Migrate patterns onto `taskBoard` substrate; retire legacy plan items (FIX-447)

- Renamed `coordinator` to `parallelTasks`. `coordinator()` still works as a deprecation-warned alias — same config shape, warns once per name.
- `planAndExecute` and `supervisor` now run on the `taskBoard` substrate with a request-backed `TaskCollection`. Both emit `task-change` (per-task lifecycle) and `task-board-meta` (board-level aggregate) items; pair with `<TaskPlan />` for rendering. The old `plan-meta` / `plan-task` ComponentItems are gone.
- Status vocabulary aligns with the substrate (`errored`, `cancelled` with labels). Public output shapes translate back to legacy `failed` / `skipped` for backward compat.
- `supervisor` replaces its wave-level review loop with per-task review baked into each worker chain: `worker → reviewer → applyVerdict`. On rejection, the substrate re-pends the task with feedback; `maxAttemptsPerTask` (default 3) bounds retries. `workers: Record<assignee, block>` enables per-task worker routing. `legacyWorkerAdapter` translates pre-migration `ExecutableTask` workers automatically.
- `emitPlanMeta`, `emitTaskUpdate`, and `emitPlanSnapshot` runtime helpers retired. `BasePlanSchema`, `BasePlanTaskSchema`, and related types remain exported (deprecated) for backward compatibility.

### Per-flow authentication and principal resolver (FIX-23)

- New `authentication` config on `defineFlow`: `{ resolvePrincipal?, defaultUserId?, requireUser?, requireOrg? }`. The framework owns the contract; the host owns credential verification. Per-flow declarations win over a host-level fallback.
- `createFlowApiRouter({ resolvePrincipal })` adds the host-level fallback. The default reads `body.userId` for backwards compatibility.
- `requireUser: false` is now a real option (the Phase 1 hard lock is gone). `defineFlow` rejects flows that declare user-scoped state, clientData, or resources when `requireUser: false`, naming the offending field at registration.
- New helpers in `@flow-state-dev/server`: `createHmacVerifier` (GitHub/Stripe-style webhook signatures with timestamp tolerance and constant-time comparison), `createHs256JwtVerifier`, `extractBearerToken`. RS256/ES256 are out of scope — hosts plug in their own JWKS verifier.
- Docs: new `docs/architecture/authentication.md` and `apps/docs/docs/server/authentication.md` with three integration patterns (HTTP session, webhook with HMAC, bearer token over `Authorization`). Server README gains an Authentication section.

### `<TaskPlan />` + DevTool task-collection viewer (FIX-445)

- New `TaskPlan` component in `@flow-state-dev/ui` (registry: `task-plan`). Section-grouped renderer for any TaskCollection — subscribes to `task-change` and `task-board-meta` items, latest-wins per task, sectioned by status. Per-task rows show goal, assignee, deps, error/feedback, and a retry indicator.
- Pattern wrappers can extend the status vocabulary; consumers register pattern-specific icons/colors via `statusConfig` without forking. Optional `groupByAssignee` toggle adds sub-groups per assignee within each section.
- Legacy `Plan` is unchanged; both ship side-by-side until FIX-447 migrates `planAndExecute` and `supervisor` onto the unified primitive, after which `Plan` becomes a thin alias.
- New "Tasks" tab in DevTool auto-discovers every TaskCollection in the active session and renders a developer-mode table per collection.

### `taskBoard` re-entry across an outer loop (FIX-471)

- Added `backing: "request"` to `taskBoard({ collection })` so multiple board invocations within one request share a single task collection. Unblocks "wrap a board inside a higher-level loop" patterns like the FIX-447 plan-and-execute replan loop.
- Sequencer-backed remains the default; request-backed reuses the same CAS retry path so concurrency semantics are unchanged.
- Documented in `packages/tasks/README.md` and `packages/patterns/README.md`.

### `taskBoard` capability + framework-idiom revision (FIX-446 follow-up)

- `taskBoard().capability` now returns a `DefinedCapability` with a `tasks()` accessor. Blocks across a flow opt in via `uses: [board.capability]` and address the board through `ctx.cap["taskBoard.<name>"].tasks()` instead of plumbing state-refs by hand. Multiple boards in one flow get distinct namespaces.
- Replaced the custom `task_change` item type with a `task-change` *component item* keyed by `${collectionId}/${taskId}`; clients render latest-wins per task automatically.
- Substrate exposes an optional `onChange` callback for advanced consumers that want a typed event stream without going through item emission.

### `taskBoard` pattern (FIX-446)

- New `taskBoard` pattern in `@flow-state-dev/patterns`. Concurrent drain over a `TaskCollection` with dependency gating, per-task worker routing by `task.assignee`, and CAS-safe claim semantics.
- Five standard dispatchers (`fifo`, `topological`, `priority`, `classifier`, `event`) accepted as instances or string names. Default is `topological`.
- HITL-ready: `awaiting_review` keeps the loop alive until external resume, and standard dispatchers skip those tasks. `reviewPolicy` config and `<Plan />` review affordances are follow-ons.
- Individual remix blocks exported (`createSelectNextReadyTask`, `createClaimTask`, `createRunWorker`, `createRecordResult`, `createCheckBoard`, `createSeedCollection`) so consumers can recompose when the default inner pipeline doesn't fit.

### Inbound transport adapter contract (FIX-438)

- New `InboundTransportAdapter` contract in `@flow-state-dev/server`. Every entry point into the runtime — HTTP, MCP, webhooks, scheduled actions, custom transports — implements the same factory shape that produces routes and dispatchers.
- `createFlowApiRouter` ships with a built-in `HttpTransportAdapter`. Public API is unchanged; an `adapters?: InboundTransportAdapter[]` option mounts additional transports. Path collisions throw at construction time.
- `source` is a first-class field on request records (`http` | `mcp` | `webhook` | `scheduled` | `notification`), surfaced as a badge in DevTool's request list. SQLite migration adds the column with `DEFAULT 'http'`.
- Conformance suite ships in `@flow-state-dev/testing` so future MCP/webhook/scheduled adapters plug into the same harness.

### `@flow-state-dev/tasks` substrate (FIX-444)

- New package `@flow-state-dev/tasks` ships the unified Plan/Task primitive substrate. Patterns (Plan & Execute, Task Board, Supervisor) will migrate onto it in follow-on issues.
- Canonical `Task` shape with status enum `pending | in_progress | blocked | awaiting_review | completed | errored | cancelled` and a `TaskCollectionRef` API across two backings: `sequencer` (default, durable per FIX-401) and `resource` (for collections that outlive a request).
- Five standard dispatchers, a `TaskWorkerInput` worker contract, `task_change` item emissions, and helpers (`taskLoopBack`, `dispatchAndExecute`).
- Substrate is HITL-ready (review lifecycle, `awaitReview` / `resumeFromReview`, audit-trail conventions). `<Plan />` rendering, pattern migrations, and Plan Mode reshape are follow-on waves.

## 2026-04-28

### Interrupted-request recovery: client sweep + resume

- New `POST /api/flows/users/:userId/check-interrupted` endpoint sweeps stale `active_requests` and transitions matching `in_progress` records to `interrupted`. Long-running dev servers and serverless deployments now have an on-demand reconciliation path without restarting.
- New `createRecoveryClient` in `@flow-state-dev/client` with `checkInterrupted` and `retry` methods. `useSession` exposes `latestRequest` and `resumeLatestRequest()`.
- DevTool sweeps on mount and on session-list refresh, and shows a Resume button when the latest request is interrupted. The kitchen-sink example surfaces an inline Resume notice above the prompt.

### Generator debug capture: user messages and history

- `BlockDebugPayload` adds optional `user` and `history` fields capturing the user-slot messages and resolved conversation history sent to the model.
- DevTool block detail panel renders new "User Message(s)" (open by default) and "History" (collapsed) sections with role-tagged bubbles.
- Capture still gates on `FSDEV_TRACE_OBSERVABILITY=true`.

### Durable sequencer checkpoint schema (FIX-401)

- Added `SequencerCheckpoint` type and `CheckpointStore` interface — the persistence seam Phase 2 durable execution will plug into without schema migration. Stores ship for memory, filesystem, SQLite, and Postgres.
- `durable: true` is now the sequencer default. `state_snapshot` items now carry a stable `key` per sequencer instance so consumers update in place rather than appending one row per step.
- DevTool snapshot timeline collapses to one row per sequencer instance. Resume-from-checkpoint runtime is a follow-on (FIX-141).

## 2026-04-26

### Org scope — rename + immutable session binding + `requireOrg` opt-in (FIX-428)

- Renamed `project` scope to `org` across core, server, client, react, devtool, stores, tools, patterns, skills, and thought-fabric. `ScopeType` is now `'request' | 'session' | 'user' | 'org'`. Block configs use `orgResources` / `orgStateSchema` / `orgClientData`. SQLite/Postgres tables renamed.
- Session `orgId` and `userId` are now immutable. Mismatches throw `OrgBindingMismatchError` / `UserBindingMismatchError` at context creation; closes a gap where caller-supplied IDs could silently override stored values.
- New `requireOrg: true` block flag bubbles through sequencers/routers; the HTTP action route rejects requests against unbound sessions with `400 OrgRequired`.
- No data migration; pre-1.0 dev/test data under `project-store/` should be recreated. Dynamic resource routing is deferred to FIX-435.

## 2026-04-25

### Up-front skill activation router (FIX-421)

- New `createIntentSelector()` in `@flow-state-dev/skills` — a three-tier sequencer that decides which skills apply before the main generator runs. Tiers: literal `/<skill-name>`, local keyword scan, structured-output classifier (only runs when 1–2 are inconclusive).
- New `keywords` frontmatter field on `SKILL.md` for tier-2 matching.
- `createSkillsCapability` ships `tools`, `context`, and `runSkill` presets (all on by default). Flows using up-front activation drop the tool path with `cap.presets({ runSkill: false })`.
- Chat-agent flow wiring is intentionally a follow-up — this PR ships the primitive plus the capability option so they can land independently.

## 2026-04-24

### Cross-flow schema registry + per-flow isolation (FIX-431)

- Added `isolateUserState` and `isolateProjectState` flags to `defineFlow`. Isolated flows get their user/project storage namespaced by `flowKind` and skip cross-flow schema checks.
- `FlowRegistry.register` collects every non-isolated flow's user/project schemas and throws `CrossFlowSchemaConflictError` at registration time on incompatible declarations.
- New storage-key helpers (`resolveUserStorageKey`, `resolveProjectStorageKey`) and `FlowRegistry.describeSharedSchemas()` for diagnostics.
- New guide at `docs/fundamentals/flow-isolation.md`.

### Prompt caching: audit and default-enable (FIX-423)

- New `caching` field on `generator()` config. Default `{ enabled: true, breakpoints: 'auto', ttl: '5m' }`. Provider-specific markers applied for Anthropic / OpenRouter / Vercel AI Gateway; OpenAI / Google / DeepSeek cache implicitly so we no-op.
- `GeneratorModelUsage` gains `cacheReadInputTokens` and `cacheCreationInputTokens`, normalized from provider metadata or AI SDK v6 aggregate.
- New audit doc at `docs/PROMPT_CACHING.md`. User guide updated in `apps/docs`.

## 2026-04-11

### DevTool: View Sequencer State (FIX-348)

- Added `SequencerStateSnapshotItem` to `@flow-state-dev/core` — a new trace-only item type that captures the full state of a sequencer at each step boundary.
- Sequencers now emit state snapshots automatically: an initial snapshot before execution begins and one after each step completes. This includes loopBack iterations.
- DevTool trace tree collects snapshots per sequencer block and displays a state indicator badge ("S") on blocks with state.
- Clicking a sequencer block in the trace view shows a new **Sequencer State** inspector panel in the detail sidebar. The panel provides a step timeline for navigating state evolution, a diff mode for comparing adjacent steps, and full JSON rendering of each snapshot.
- Nested sequencers each maintain their own snapshot timeline, navigable independently.
- Works for both live-streaming runs and completed runs loaded from trace history.

### defineCapability() — Reusable Capability Bundles (FIX-351)

- Added `defineCapability()` to `@flow-state-dev/core` — packages resources, state schemas, targets, helper functions, and presets under a single name.
- All four block kinds (`handler`, `generator`, `sequencer`, `router`) accept `uses: [capability]` to install capabilities.
- Capabilities compose transitively (`uses` on capabilities) with cycle detection and diamond deduplication.
- Presets: named opt-in/opt-out bundles of any block config surface (resources, state schemas, targets, generator context, generator tools).
- `.presets()` builder with boolean toggles and function-form overrides.
- Block-kind compatibility enforced at factory time with clear error messages.
- `ctx.cap.{name}.{fn}` provides memoized helper functions at runtime.
- 89 new tests (unit + integration + type inference).

### DevTool: `fsdev dev` command + `@flow-state-dev/devtool` package (FIX-261)

- Added `fsdev dev` command to `@flow-state-dev/cli` — starts an HTTP dev server that serves both the flow API routes and the DevTool UI from a single port.
- Auto-discovers flows from conventional directories, registers them in an in-memory `FlowRegistry`, and creates filesystem stores at `.fsdev/data/`.
- Bridges Node.js `http` to the Web API `Request`/`Response` interface used by `createFlowApiRouter`, with SSE streaming support for live execution traces.
- Options: `--port` (default 4200), `--flow-dir` (repeatable), `--model` (override all generators), `--no-open`.
- Static file server with SPA fallback handles the DevTool single-page app routing.
- Created `@flow-state-dev/devtool` package (`packages/devtool/`) that exports `getAssetPath()` to locate pre-built static assets.
- Includes `build:assets` script that builds the DevTool Vite app (`apps/devtool`) and copies the output.
- CLI lists `@flow-state-dev/devtool` as an optional peer dependency.
- Renamed `apps/devtool` package from `@flow-state-dev/devtool` to `@flow-state-dev/devtool-app` (remains private).
- Updated docs site: DevTool overview rewritten, setup guide added, CLI API reference and quick-start updated, sidebar entry added.
- Updated `CLAUDE.md`, `README.md`, `development-setup.md`, and CLI `README.md`.

## 2026-03-20

### Resource Namespaces — Dynamic + Parameterized Resources (FIX-98)

- Added `defineResourceNamespace()` to `@flow-state-dev/core` for declaring typed dynamic resource collections with glob patterns (`files/*`, `files/**`) and parameterized patterns (`[topic]/observations`).
- Added `ResourceNamespaceRef` runtime interface with `create()`, `get()`, `getOptional()`, `getOrCreate()`, `list(prefix?)`, `delete()`, and `count()` methods.
- Added pattern utilities in `namespace-patterns.ts`: `validatePattern`, `matchesPattern`, `resolveNamespaceKey`, `normalizeResourcePath`, `extractPatternParams`, `getPatternPrefix`, `isParameterizedPattern`, `isDeepWildcard`, `isSingleWildcard`.
- Added `maxInstances` cap with configurable eviction policies: `"none"` (throws), `"lru"` (least-recently-accessed), `"oldest"` (first-created).
- Added per-instance lifecycle hooks (`onInstanceCreated`, `onInstanceUpdated`, `onInstanceDeleted`) with typed `NamespaceHookContext` providing `log` and `scopeType`.
- Extended `DeclaredResources` and block-level resource declarations (`sessionResources`, `userResources`, `projectResources`) to accept namespace definitions alongside static resources.
- Added conditional type mapping in `InferResourcesFromDefinitions`: `DefinedResourceNamespace<S>` → `ResourceNamespaceRef<S>`, `DefinedResource<S>` → `ResourceRef<S>`.
- Implemented full server runtime for namespaces in `createExecutionContext.ts`: flat storage model (instances coexist with static resources), schema validation on create, eviction persistence, and hook context wiring.
- Added `resourceTools()` with 5 generic CRUD handler blocks for LLM tool surface.
- Added 51 core tests and 30 server tests covering patterns, CRUD, eviction, lifecycle hooks, and block integration.
- Updated architecture docs, site docs (resources overview, storage guide, core API), and core README.

## 2026-03-09

### CLI: `fsdev run` command with streaming NDJSON (FIX-212)

- Added `fsdev run <flowKind> <action>` command to `@flow-state-dev/cli` for executing flow actions from the terminal with real-time NDJSON streaming to stdout.
- Added `resolve-flow.ts` with `discoverFlows()` for automatic flow discovery from conventional directories (`src/flows/`, `flows/`) and `resolveFlow()` for explicit file-path loading.
- NDJSON event types: `item_added`, `content_delta`, `state_change`, `flow_complete`, `error`.
- Supports session reuse (`--session`), model override (`--model`), state seeding (`--seed-session`, `--seed-user`, `--seed-project`), and input from inline JSON or file.
- Added 3 test fixture flows (echo, stateful, throwing) and 9 integration tests.
- Added `packages/cli/README.md` with full command reference and programmatic API documentation.

## 2026-03-03

### Core utility block: contextReducer (FIX-73)

- Added `utility.contextReducer(config)` to `@flow-state-dev/core` as a generator factory with three modes: `distill`, `denoise`, and `compress`.
- Added mode-specific default output schemas with caller override support:
  - `contextReducerDistillOutputSchema` → `{ distilled, keyPoints }`
  - `contextReducerDenoiseOutputSchema` → `{ cleaned, removedCategories? }`
  - `contextReducerCompressOutputSchema` → `{ compressed, compressionRatio?, dropped? }`
- Added unit coverage for all three modes, schema override behavior, and sequencer composition.
- Updated `packages/core/README.md` exports documentation for utility block factories.

## 2026-03-01

### Sequencer container item emission groundwork (FIX-8)

- Added optional `container` metadata to the shared block config surface so sequencer/router container settings remain attached to built block definitions.
- Extended execution parent metadata with `parentInstanceId` and resolved container metadata, enabling runtime scope frames to carry parent-child block-instance relationships.
- Updated server execution/context wiring to emit `container` stream items whenever a scoped sequencer/router frame with container config is entered.
- Added server execution coverage asserting sequencer container emission with resolved component/label/metadata payload.

### Block resource declarations and automatic collection (FIX-92)

- Added `DeclaredResources` type and `declaredResources` field on `BlockDefinition` in `@flow-state-dev/core`.
- Blocks (`handler`, `generator`, `router`) now accept `sessionResources`, `userResources`, `projectResources` config properties using `defineResource()` values, surfaced as `BlockDefinition.declaredResources`.
- Added `extractDeclaredResources()` and `mergeDeclaredResources()` utilities in core block internals.
- Sequencers automatically collect `declaredResources` from all child blocks across the DSL chain (`then`, `thenIf`, `parallel`, `forEach`, `doUntil`, `doWhile`, `work`, `tap`, `tapIf`, `rescue`, `branch`), with build-time conflict detection for same-name/different-reference resources.
- `defineFlow` collects `declaredResources` from all action blocks and merges them into flow scope configs (`session`, `user`, `project`). Flow-level declarations take priority over block-declared ones.
- Added compile-time type tests for block resource declarations.
- Added 49 new unit tests covering resource extraction, merge, sequencer collection, and flow-level merge.
- Updated architecture docs, contributing reference, core README, and user-facing docs to document the feature.

## 2026-02-27

### Server runtime logging improvements

- Added structured action/block execution logging in `@flow-state-dev/server` with default console output, bounded payload summaries, retry visibility, and terminal error logs.
- Added `RuntimeLogger` hooks (`logger` option on `runAction`/`executeBlock`) plus reusable helpers (`DEFAULT_RUNTIME_LOGGER`, `summarizeForLog`, `createExecutionLogContext`).
- Added execution-focused tests for retry/failure log coverage and log summarization helpers.
- Updated execution architecture and server package docs to describe runtime log behavior and customization.

## 2026-02-15

### Planning foundation

- Added Wave 1.a execution plan at `docs/waves/wave-1/wave-1.a.md` aligned to canonical Wave A.
- Added Wave 1.b execution plan at `docs/waves/wave-1/wave-1.b.md` aligned to canonical Wave B.
- Added reusable wave template at `docs/waves/WAVE_TEMPLATE.md`.
- Added living best-practices log at `docs/BEST_PRACTICES.md`.
- Added compact architecture cheat sheet at `docs/ARCHITECTURE_CHEAT_SHEET.compact.md`.
- Added implementation repo process guidance at `README.md`.
- Established dual changelog policy: per-wave journal/changelog plus root `changelog.md` summaries.
- Standardized wave naming to Phase 1-prefixed identifiers (`Wave 1.a`, `Wave 1.b`, ...) and renamed wave files accordingly.
- Grouped all Phase 1 wave artifacts under `docs/waves/wave-1/` (for example `docs/waves/wave-1/wave-1.a-changelog.md`).

### Wave 1.a implementation

- Initialized workspace root tooling with `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, and root `tsconfig.json` references.
- Scaffolded required Phase 1 package/app targets under `packages/*` and `apps/devtool` with manifests and TypeScript configs.
- Added minimal `src/index.ts` entrypoints for all six required packages plus `apps/devtool/src/index.ts`.
- Established canonical `@flow-state-dev/core` subpath exports for `.`, `./types`, and `./items` with corresponding source modules.
- Added React compile-time smoke import proof from `@flow-state-dev/core/types` and `@flow-state-dev/core/items`.
- Added offline Wave 1.a typecheck verifier at `scripts/typecheck.mjs` due registry unavailability in this environment.
- Added Wave 1.a execution artifacts: `docs/waves/wave-1/wave-1.a-journal.md` and `docs/waves/wave-1/wave-1.a-changelog.md`.

### Wave 1.b implementation

- Implemented canonical core type contracts in `packages/core/src/types/*` for blocks, flows, state/scopes, and resources/projections.
- Implemented canonical item/content/stream event contracts in `packages/core/src/items/*` aligned to item-first streaming architecture.
- Added shared schema typing helpers in `packages/core/src/schema/*` and wired type/item exports through core entrypoints.
- Added compile-only type smoke checks at `packages/core/src/types/tests/sequencer-connectors.type-test.ts` and `packages/core/src/types/tests/flow-state-inference.type-test.ts`.
- Added `zod` dependency to `packages/core/package.json` for canonical schema typing.
- Updated React smoke import proof to consume real core type/item exports via `packages/react/src/_wave-1a-import-smoke.ts`.
- Added Wave 1.b execution artifacts: `docs/waves/wave-1/wave-1.b-journal.md` and `docs/waves/wave-1/wave-1.b-changelog.md`.
- Synced Wave 1.b stream event typings to updated canonical docs by adding request/user stream event base unions and `scope.state.changed` user-stream event types in `packages/core/src/items/events.ts`.

### Wave 1.c implementation

- Added Wave 1.c execution plan at `docs/waves/wave-1/wave-1.c.md` aligned to canonical Wave C.
- Implemented shared block runtime helper in `packages/core/src/blocks/internal/build-block.ts` with metadata wiring, schema validation, retry handling, and `connectInput`/`connectOutput` rebinding.
- Implemented canonical runtime builders in `packages/core/src/blocks/*`:
  - `handler` in `packages/core/src/blocks/handler.ts`
  - loop-capable `generator` with repair support in `packages/core/src/blocks/generator.ts`
  - sequencer runtime + DSL signatures in `packages/core/src/blocks/sequencer.ts` and `packages/core/src/blocks/sequencer-methods.ts`
  - `router` with route-candidate validation in `packages/core/src/blocks/router.ts`
- Added blocks barrel exports in `packages/core/src/blocks/index.ts` and wired runtime builder exports at `packages/core/src/index.ts`.
- Added sequencer DSL type smoke coverage at `packages/core/src/types/tests/sequencer-dsl.type-test.ts`.
- Added Wave 1.c execution artifacts: `docs/waves/wave-1/wave-1.c-journal.md` and `docs/waves/wave-1/wave-1.c-changelog.md`.

### Wave 1.d implementation

- Added Wave 1.d execution plan at `docs/waves/wave-1/wave-1.d.md` aligned to canonical Wave D.
- Implemented `defineFlow` runtime with callable `FlowType`, shallow merge-based instance overrides, and Phase 1 `requireUser=true` enforcement in `packages/core/src/flow/defineFlow.ts`.
- Added flow runtime barrel export at `packages/core/src/flow/index.ts` and wired root exports in `packages/core/src/index.ts`.
- Wired flow-level tools defaults/hooks into generator action execution by merging flow + instance tools and binding to generator blocks.
- Added Wave 1.d unit tests in `packages/core/test/flow.test.ts` and extended export smoke coverage in `packages/core/test/blocks.test.ts`.
- Added Wave 1.d execution artifacts: `docs/waves/wave-1/wave-1.d-journal.md` and `docs/waves/wave-1/wave-1.d-changelog.md`.

### Unit test infrastructure

- Added workspace Vitest baseline config at `vitest.config.ts`.
- Added `vitest` dev dependency and root `test:watch` script in `package.json`.
- Replaced placeholder `test` scripts with Vitest commands in all packages and `apps/devtool`.
- Added initial package-level unit test files under `packages/*/test/*.test.ts` and `apps/devtool/test/index.test.ts` to verify each workspace target has runnable test coverage.

## 2026-02-16

### Process updates

- Added BP-006 to `docs/BEST_PRACTICES.md`: keep wave labels out of runtime code/tests and reserve them for planning/docs artifacts.
- Added BP-007 to `docs/BEST_PRACTICES.md`: require concise file-level/API documentation for exported methods and important internal runtime helpers.
- Added BP-008 to `docs/BEST_PRACTICES.md`: keep `README.md` onboarding-first and update it whenever onboarding-relevant facts change.
- Reworked `README.md` into a developer onboarding entrypoint (project overview, objectives, key concepts, setup, package responsibilities, command references, and docs map).
- Refined `README.md` to be evaluator-friendly for new users by adding stronger value framing (`why this exists`, `why this repo may be worth your time`), clear maturity status, and a concrete `start here` onboarding path.
- Added `AGENTS.md` to hold agent collaboration protocol and moved wave execution guidance out of `README.md`.

### Wave 1.e implementation

- Added Wave 1.e execution plan at `docs/waves/wave-1/wave-1.e.md` aligned to canonical Wave E.
- Implemented server context runtime and context types in `packages/server/src/context/createExecutionContext.ts` and `packages/server/src/context/types.ts`, including require-user/session enforcement and composed scope handles.
- Implemented CAS primitives and versioned state container/state-op helpers in `packages/server/src/stores/cas.ts` and `packages/server/src/stores/state-container.ts`.
- Implemented filesystem and in-memory store adapters for `session`, `request`, `user`, and `project` scopes under `packages/server/src/stores/filesystem/*` and `packages/server/src/stores/memory/*`.
- Added server store barrel exports in `packages/server/src/stores/index.ts` and wired server root exports in `packages/server/src/index.ts`.
- Added Wave 1.e unit tests in `packages/server/test/context.test.ts`, `packages/server/test/state-container.test.ts`, and `packages/server/test/stores.test.ts`.
- Added Wave 1.e execution artifacts: `docs/waves/wave-1/wave-1.e-journal.md` and `docs/waves/wave-1/wave-1.e-changelog.md`.

### Wave 1.f implementation

- Added Wave 1.f execution plan at `docs/waves/wave-1/wave-1.f.md` aligned to canonical Wave F.
- Implemented streaming runtime modules in `packages/server/src/streaming/response-emitter.ts`, `packages/server/src/streaming/sse.ts`, `packages/server/src/streaming/encode-event.ts`, and `packages/server/src/streaming/resume.ts`.
- Added Wave 1.f middleware-readiness seam support in streaming internals via `packages/server/src/streaming/types.ts` and `packages/server/src/streaming/internal/seams.ts`, with no-op-safe interception points in emitter/encoder paths.
- Added streaming barrel exports at `packages/server/src/streaming/index.ts` and wired streaming exports through `packages/server/src/index.ts`.
- Added streaming unit tests in `packages/server/test/streaming.test.ts` (including no-op seam parity) and expanded server export smoke tests in `packages/server/test/index.test.ts`.
- Consolidated shared store pagination helper into `packages/server/src/stores/shared.ts` and reused it in memory/filesystem helper modules.
- Added Wave 1.f execution artifacts: `docs/waves/wave-1/wave-1.f-journal.md` and `docs/waves/wave-1/wave-1.f-changelog.md`.

### Wave 1.g implementation

- Added Wave 1.g execution plan at `docs/waves/wave-1/wave-1.g.md` aligned to canonical Wave G.
- Implemented error model and normalization utilities in `packages/server/src/errors/flow-error.ts` and `packages/server/src/errors/normalize-error.ts`.
- Implemented execution runtime modules in `packages/server/src/execution/*`, including retry engine, block-kind dispatch wrappers, rescue routing, work queue convergence, and request action runner lifecycle integration.
- Added internal execution seam metadata and no-op seam hooks in `packages/server/src/execution/types.ts` and `packages/server/src/execution/internal/seams.ts`.
- Added execution barrel exports in `packages/server/src/execution/index.ts` and wired server root exports in `packages/server/src/index.ts`.
- Added Wave 1.g unit tests in `packages/server/test/execution.test.ts` and expanded server export smoke checks in `packages/server/test/index.test.ts`.
- Added Wave 1.g execution artifacts: `docs/waves/wave-1/wave-1.g-journal.md` and `docs/waves/wave-1/wave-1.g-changelog.md`.

### Wave 1.h implementation

- Added Wave 1.h execution plan at `docs/waves/wave-1/wave-1.h.md` aligned to canonical Wave H.
- Implemented server flow registry in `packages/server/src/registry/flow-registry.ts`, plus registry exports in `packages/server/src/registry/index.ts`.
- Implemented canonical catch-all path parser and endpoint handlers in `packages/server/src/routes/parseFlowRoute.ts` and `packages/server/src/routes/http-handlers.ts`.
- Implemented catch-all route adapter in `packages/server/src/routes/createFlowApiRouter.ts` with internal no-op request bootstrap seam hooks for future middleware context enrichment.
- Added route exports in `packages/server/src/routes/index.ts` and wired registry/routes through `packages/server/src/index.ts`.
- Added Wave 1.h unit coverage in `packages/server/test/registry-routes.test.ts` and expanded server export smoke checks in `packages/server/test/index.test.ts`.
- Added Wave 1.h execution artifacts: `docs/waves/wave-1/wave-1.h-journal.md` and `docs/waves/wave-1/wave-1.h-changelog.md`.

## 2026-02-19

### Wave 1.i implementation

- Added Wave 1.i execution plan at `docs/waves/wave-1/wave-1.i.md` aligned to canonical Wave I.
- Implemented client transport APIs in `packages/client/src/*`, including action/session/state APIs and request/user SSE clients with resume controls.
- Implemented typed flow-bound client helpers in `packages/client/src/action-client/executeAction.ts` and package exports in `packages/client/src/index.ts`.
- Implemented React wrappers and render surfaces in `packages/react/src/*`, including `useProjections`, simplified `useSession`, context-driven renderer resolution, and `useBlockContext`.
- Aligned core/server contracts to the React direction (`renderKey`, `clientOutput`/`llmOutput`, grouped client projections, filtered session snapshot projections).
- Added Wave 1.i unit coverage in `packages/client/test/*` and `packages/react/test/*`.
- Updated client/react package scripts in `packages/client/package.json` and `packages/react/package.json` for deterministic dependency-build-aware typecheck/test execution.
- Updated `README.md` maturity section to reflect implemented client/react package surfaces.
- Added Wave 1.i execution artifacts: `docs/waves/wave-1/wave-1.i-journal.md` and `docs/waves/wave-1/wave-1.i-changelog.md`.

### Wave 1.j implementation

- Added Wave 1.j execution plan at `docs/waves/wave-1/wave-1.j.md` aligned to canonical Wave J.
- Implemented testing harness runtime in `packages/testing/src/runtime/createTestContext.ts` with seeded in-memory stores, target lookup support, and state-change capture.
- Implemented canonical testing utilities in `packages/testing/src/test-utilities/*`:
  - `testBlock`
  - `testSequencer`
  - `testRouter`
  - `testFlow`
  - `testItems`
- Implemented snapshot trace utility in `packages/testing/src/snapshot/snapshotTrace.ts`.
- Implemented scripted generator mocks in `packages/testing/src/mocks/mockGenerator.ts`.
- Expanded testing package exports in `packages/testing/src/index.ts` and added Wave 1.j test coverage in `packages/testing/test/*`.
- Added Wave 1.j execution artifacts: `docs/waves/wave-1/wave-1.j-journal.md` and `docs/waves/wave-1/wave-1.j-changelog.md`.

### Wave 1.k implementation

- Added Wave 1.k execution plan at `docs/waves/wave-1/wave-1.k.md` aligned to canonical Wave K.
- Corrected Wave 1.k implementation per authoritative correction document by deleting the legacy web example target and replacing it with canonical `examples/*` packages.
- Added `examples/hello-chat` with a minimal generator flow, session projection, React usage sample, and flow tests.
- Added `examples/kitchen-sink` with all four block kinds, session resources/projections, user projections, router-by-context, sequencer DSL coverage, React block-renderer usage, and flow/block tests.
- Updated runtime/test infrastructure to support corrected examples:
  - persisted scope resources in execution context
  - resource-backed projection compute context in session-state route
  - `fsd:block_output` emission for block execution results
  - router selection safety for sequencer routes (thenable edge)
  - nested `state` + `resources` seeding for testing harness helpers
- Added Wave 1.k execution artifacts: `docs/waves/wave-1/wave-1.k-journal.md` and `docs/waves/wave-1/wave-1.k-changelog.md`.

### Documentation updates

- Added package-level onboarding docs:
  - `packages/client/README.md`
  - `packages/react/README.md`
  - `packages/server/README.md`
  - `packages/testing/README.md`
- Added best-practice standard for package README maintenance in `docs/BEST_PRACTICES.md` (BP-009).
- Expanded `packages/react/README.md` with hook-by-hook usage documentation (`useFlow`, `useSession`, `useProjections`, `useAction`, `useRequestStream`) and context renderer guidance.
- Renamed client builders to `createClient` and `createTypedClient` in `packages/client/src/action-client/executeAction.ts` and `packages/client/src/index.ts`, and updated related client/react tests and docs.
- Kept untyped session action execution as `session.sendAction(...)` in `packages/react/src/hooks/useSession.ts` until typed session actions are introduced.
- Updated `packages/client/README.md` for snapshot query options (`include_items`, scope-grouped `projections`).
- Replaced `packages/testing/README.md` scaffold notes with concrete API documentation for Wave 1.j testing utilities.
- Updated root `README.md` documentation map to link directly to package-level READMEs.

### Block execution and generator model correction

- Refactored core block execution contract so framework behavior lives on `block.run(...)` in `packages/core/src/blocks/internal/build-block.ts`, with `config.execute` left as user-provided logic only.
- Added generator model abstraction types in `packages/core/src/types/model.ts` and wired `resolveModel` onto `BlockContext` in `packages/core/src/types/block.ts`.
- Reworked generator runtime in `packages/core/src/blocks/generator.ts` to:
  - remove hidden test-context mock hooks
  - resolve models through `ctx.resolveModel(modelId, blockName)`
  - execute model-requested tool blocks via `tool.run(...)`
  - remove legacy `generate` callback fallback so model resolution is the only generation path
- Updated core block dispatch internals to use `run()`:
  - `packages/core/src/blocks/sequencer.ts`
  - `packages/core/src/blocks/router.ts`
- Updated server runtime to call `run()` and wire model resolution:
  - execution dispatch/executors in `packages/server/src/execution/*`
  - context wiring in `packages/server/src/context/*`
  - route/action bootstrap options in `packages/server/src/routes/*` and `packages/server/src/execution/types.ts`
- Migrated testing mocks to the model boundary:
  - added `createMockModelResolver` in `packages/testing/src/mocks/mockGenerator.ts`
  - removed hidden context-property injection from `packages/testing/src/runtime/createTestContext.ts`
  - added `models` fallback mocking support in `packages/testing/src/test-utilities/types.ts`
- Updated unit tests across `packages/core/test/*`, `packages/server/test/*`, and `packages/testing/test/*` to validate the new `run()` and model-resolver behavior.
- Updated onboarding docs for changed public behavior in:
  - `README.md`
  - `packages/server/README.md`
  - `packages/testing/README.md`
- Added AI SDK adapter and tests:
  - new server utility `createAiSdkModelResolver` (`packages/server/src/models/createAiSdkModelResolver.ts`)
  - new server tests using `MockLanguageModelV3` from `ai/test` (`packages/server/test/ai-sdk-model-resolver.test.ts`)
- Fixed `testFlow` generator mocking parity with `testBlock` by adding `generators` / `models` / `unmockedGeneratorPolicy` options and forwarding them through a mock model resolver.
- Added built-in production resolver wiring:
  - new `createDefaultModelResolver` using Vercel AI Gateway (`packages/server/src/models/createDefaultModelResolver.ts`)
  - `createExecutionContext` now defaults to this resolver when `modelResolver` is omitted, so generator blocks call AI SDK without explicit app wiring.
- Expanded AI SDK resolver behavior/tests:
  - added best-effort structured-output handling from `outputSchema` (JSON response format hint + JSON text parsing fallback)
  - added adapter-call assertions for `maxTokens`, `signal`, tools, and prompt forwarding in `packages/server/test/ai-sdk-model-resolver.test.ts`.

- Updated root docs to reference `examples/hello-chat` and `examples/kitchen-sink`.

- Added token budget awareness primitives: model lookup/cost table, token counter interfaces/adapters, provider metadata pass-through, generator `block_output.modelUsage`, request token/cost rollups, and token-aware LLM history limits.
- Expanded OpenAI model lookup coverage with GPT-5 and GPT-4.1 families for token estimation and pricing resolution.
- Added Gemini 3 family model lookup entries and aligned streaming usage reporting to use `GeneratorModel.modelId` directly.
- Refined token budget runtime behavior: distinct `onExceeded: "stop"` incomplete termination, deduplicated warning emission, typed model-usage rollups, and concurrency-safe active-model resolution with added runAction budget-path tests.

