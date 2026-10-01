# The Default Workforce Worker Kind

A worker file (name, description, body) hires a working agent with no `flow:` key: it resolves to the built-in kind `agent`. User-facing: [The built-in worker](../../apps/docs/docs/workforce/built-in-worker.md), [Workers on disk](../../apps/docs/docs/workforce/workers-on-disk.md), [`packages/workforce/README.md`](../../packages/workforce/README.md). This page holds the constraints a change to the kind or the hire step is still bound by. (It began as the locked contract between the issues that built the kind; that work has shipped. Where `docs/internal/design/kitchen-sink-agent-drift.md` disagrees, this page wins.)

## Admission has exactly one gate

`hireWorkforce` is the only admission check; a second one downstream is how "absent means default" and "wrong means error" drift apart.

| Worker file says | Result |
|---|---|
| no `flow:`, or `flow: agent` | the built-in kind |
| `flow: <registered>` | that kind |
| `flow: <not registered>` | **refused by name**, listing the kinds passed. Never a fallback to the default (that's the typo risk) |
| roster passes `kinds: { agent: … }` | the app's flow wins; the built-in is merged *underneath* |

- **Adding the implicit default weakens no existing refusal.** A replacement registered as `agent` must declare `kind: "agent"` (`factory.kind !== kind` in `hire.ts`) **and** `cardinality: "collection"`. Without the latter it's a singleton: seats mint, then registration refuses each as `singleton-id-mismatch`. Loud, at boot, but surprising.
- Every admission problem is a startup misconfiguration: fatal, collected (one run names every bad worker), nothing hires partially.
- The organization is the principal's. A request to a seat sends `userId` and no org id; the kind never invents one or reads one off the request.

## The settings bag

`configSchema` = `workerConfigSchema().extend({ model, tools, skills })`.

| | Keys | Rule |
|---|---|---|
| Admission contract | `instructions?`, `teamInstructions?`, `seatSkills`, `seatTools`, `seatPackages?`, `seatId` | Imposed by hire on **every** kind; `workerConfigSchema()` (`packages/workforce/src/worker-config.ts`) |
| The default kind's own | `model`, `tools`, `skills` | Top level; the set is closed, unknown keys refuse by name |
| The hire step's | `flow`, `description`, `resources` | Removed before admission; no kind ever sees them |

- **Admission is structural, not nominal.** Nothing checks that a kind *called* `workerConfigSchema()`; what's checked is whether its closed schema accepts what hire imposes. A hand-rolled kind is admitted identically, but when the contract gains a key it refuses at boot naming it, while a composed kind tracks automatically. Loud, so a second nominal gate isn't worth a second authority.
- **Imposed vs never-authored.** `seatSkills`, `seatTools`, `seatPackages`, `seatId`, `teamInstructions` are refused by name if a file authors them, from shared constants in `manifest.ts` (`teamInstructions` at three doors: `TEAM.md`, `WORKER.md`, hire). `instructions` is imposed *and* authored (it's the body). `persona` is refused by name. A body plus an `instructions:` key is refused (two sources).
- **Optional keys are absent, never empty.** `teamInstructions` only when the team wrote a `TEAM.md`; `seatPackages` only when the seat holds a package. An empty layer would be a value every kind's schema sees, and would let a hand-rolled kind that predates the key break for seats that hold nothing.
- `seatId` is the seat's logical id (what a channel's `members:` lists). A block can't see which seat it runs in (core keeps the flow id off the block context), so the settings are the one per-seat fact a block can read, and every mint path stamps it.
- **`resources` is consumed, not a setting.** It narrows that seat's resource map (`seat-resources.ts` is canonical); a kind declaring its own `resources` setting would never receive a value.
- **`tools` is reserved across all kinds for one meaning**: tool names the seat may call. Not a contract key (a kind may declare it or not), but a kind that declares it may not repurpose it, because hire rewrites it: names resolve against the seat's `blocks/`, its team's, then its held packages' blocks; those move onto `seatTools` as live blocks; the rest go to the kind's catalog. A package block that shadows an `agent` catalog key is refused at the mint. Hire preserves **whether a `tools:` line was written** (never filling `[]` for an omitted line), so a kind can tell them apart. Written down, not enforced: probing kinds was removed after a probe produced a false accusation (`admissionHint`).
- No memory switch, no nested settings bag (open data gets one declared record-typed key).
- **C1a: settings are a default layer, not the only one.** Model and thinking style stay overridable per end user; per-turn feature switches stay per-turn input.

## Prompt order is position, not precedence

`prompt: [default, teamInstructions, instructions, package instructions]`, absent layers dropped (the shared `default` isn't shipped yet; when it lands it goes first, and **no second default-prompt configuration may be defined anywhere else**). The order is fixed and checkable. It is **not** precedence: assembly is plain concatenation, so a team's "never touch production" and a seat's "restart the production queue" are resolved by whatever the model does. A test on the composed prompt proves order, not precedence.

## The tools fence

A written `tools:` line is a hard fence over the app catalog: exactly those names, `[]` means none, regardless of the catalog, a skill's `allowed-tools`, or `uses` capabilities ([Capabilities → tools fence](./capabilities.md#the-tools-fence)). A seat with **no** line gets the tools of the capability presets its own file picked and the blocks of its held packages; kind-default presets grant nothing. Skill delegation is fenced to listed names (`toolSeatFence`). Don't add a per-consumer fence; core is the one enforcement point. (`registerCatalogTools: false` and memory preset opt-outs are cost choices, no longer safety.)

**Controls cross the fence by design** (`controlTools`):

- the skill loader, when the seat sets `skills.activateTool: true`;
- the task board's tools, when a held skill declares `agents:`;
- **`discover`**, on for every seat by composing `createWorkforceCapability`. A file's `discover:` only **narrows** it (list = those domains, `[]` = none, omitted = all the scope carries), applied to the registry, not filtered in the tool, so it can never widen past what the app installed. To withhold the tool, turn off the capability's `door` preset.

## Skills: stored per seat, *and* filled per seat

- **Isolation (the drawer).** The skills collection declares `flowIsolation`; a seat is a flow instance minted with the worker id, so storage keys on `${identity}:${seatId}` with no new primitive. Still **org-scoped**.
- **Population (the contents).** Isolation alone gives every seat its own empty drawer filled from the same jar: a static `initialSkills` captured once per kind seeds N identical catalogs. So the seat's union (`org ∪ teams/<team> ∪ workers/<seat>`, `read-seat-skills.ts`, same name from two levels refused) rides `WorkerManifest.skills` → the `seatSkills` setting → an `initialSkills` resolver reading `ctx.flow.config`. **Separate keys with identical catalogs is a failure**, not a pass.
- **Copy-in is the honest lock-in.** Seeding copies and records `_meta.seededNames`, so later upstream body edits don't reach a seeded seat, and a deliberate deletion is never undone (`needsResed` is false when the manifest is gone). Exception: `ensureSeeded` re-seeds on a **schema** mismatch with the current parser (legacy `contextMode`, missing `agents:`, changed `contextMode`), never on a body edit, so the renderer doesn't silently skip a record. Deliberate refresh is `refreshSeededSkills`: replaces touched folders whole (withdrawn files don't outlive withdrawal), only for names whose manifest exists.
- **Entry point is `createSkillsLibrary` + per-generator binding**, not `createSkillsCapability`: binding activation is per generator, where the capability keeps a session-global `activeSkills`. The kind passes the app catalog with `registerCatalogTools: false`, so `allowed-tools` validate against it but registration stays solely the seat's `tools:`.

## Memory

- **Memory is a build-time composition seam, not a setting.** The default kind and the hire package's required graph contain **no memory resources and no static memory imports**; "attached" means an app composed memory into its own kind. Declaring memory on the default and gating it off is the same violation with a switch on it. (The seat still reads its own conversation through `history`.)
- Once composed, defaults are read-side; the skill-matching classifier and the memory capture pipeline are opt-in, one setting each. Light → heavy is additive; heavy → light breaks hired rosters.
- "Member" means **seat**. Per-seat memory is `isolateUserState: true` on the kind (instance-keyed); no isolation primitive or memory field on the seat. Limit: the flag is set once on the worker flow definition and memory tiers declare no `flowIsolation`, so a roster can't mix shared and per-seat tiers (FIX-1396). Renaming a seat orphans its isolated data.

## Must not be invented

- No second Agent type at framework level; don't grow `AgentRegistry` into one. `defineAgent` / `materializeAgent` are not the teach path; nothing in the kind imports them.
- Seats are flow instances of a kind; there is no `worker.ts` seat door. No Channel/MessageBoard types follow from this.
- The kind id is `agent`; don't copy the old placeholder `worker-agent` from older examples.

## Known gaps

- Two overlapping skills entry points; deprecating `createSkillsCapability` is FIX-1390.
- Per-seat cost is unmeasured: one bucket and one cold-start seed per seat; skill-less seats do no storage work, but roster × catalog hasn't been run.
- Memory isolation is set on the flow definition, not per tier (above).
