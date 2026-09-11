# Kitchen-sink drift audit — `chat-agent` and the skill activator

**Read as of `5affd6912` (2026-09-11).** Point-in-time characterization for the FIX-1359 epic
(out-of-the-box `agent` flow kind), written so FIX-1361, FIX-1362, FIX-1363, FIX-1364 and
FIX-1366 do not each re-read `apps/kitchen-sink` and reach five different conclusions.

**This is not documentation and is not maintained.** It describes what the demo app did on the
commit above. If FIX-1363 slips well past this epic, re-read before citing. Every claim names
the file it came from; re-check by opening that file, not by trusting this prose.

Vocabulary is the epic's: **seat** = flow instance, **kind** = factory, **agent kind** = the
opinionated default. There is no "thin" or "fat" agent here — only different kinds.

---

## 1. Start here — what will bite you

**Kitchen-sink never hires anybody.** `grep -rn "hireWorkforce\|WORKER.md" apps/kitchen-sink`
returns nothing. No `configSchema`-driven instantiation, no roster, no `flow:` resolution. The
closest working composition of the agent shape we own proves a great deal about the **flow** and
precisely nothing about the **seat**. Port from it without knowing that and you ship a kind that
cannot be hired.

→ Every hire-side claim belongs to `packages/workforce` — `hire.ts`, `manifest.ts`,
`test/hire.test.ts`, the hire README. Never to kitchen-sink.

**Kitchen-sink runs the expensive half of both subsystems the agent kind shares with it.** It
picked `system()` over `createMemoryCapability` for memory, and the activator with its LLM
classifier tier left on for skills. Copied forward as defaults, that is a recurring model-call
bill on every seat anybody ever hires. **§2c prices it precisely** — read that table before
citing a number.

**The epic has already ruled on that** (signed off on PR #1736, 2026-09-11): the canonical
out-of-the-box paths are the **light** ones — skills **library + binding**, and **read-side**
memory. The LLM classifier tier and the full `system()` capture pipeline are **opt-in, one
config line each**. The implementing calls stay with their owners (skills merge and activation
→ FIX-1362, the kind's composition → FIX-1363).

The asymmetry is why: light → heavy is additive, one line. Heavy → light is a breaking change
to rosters already hired.

---

## 2. Do not copy this

### 2a. Two parallel skills entry points — kitchen-sink picked the heavier one

| Path | Canonical docs | Kitchen-sink |
|---|---|---|
| `createSkillsLibrary` + `.with(binding)` + separate `createSkillActivator` | `apps/docs/docs/skills/binding.md`, `activation.md` | **Uses this** (`flows/chat-agent/shared/capabilities/features.ts`) |
| `createSkillsCapability` + `readSkillsDirectory` — one capability carrying collection, `activeSkills` fragment, catalog tools, body formatter, default-on `runSkill` preset | `createSkillsCapability` header | Not used |

The two overlap heavily and cross-reference each other. **Both work with the activator** —
`createSkillsCapability`'s own header tells callers doing up-front activation to drop its
default `runSkill` preset, and it exposes the same `skills` collection and session
`activeSkills` slot the activator drives. The differentiator is not activation: it is the
**per-generator binding surface** (`.with(binding)`), which is what a per-seat register
composes with. **Library + binding is the epic-approved canonical path for the kind** on that
basis. FIX-1362 should reconcile the two entry points, not assume only one can activate.

→ **FIX-1362** owns the final merge/activation rule. The comparison above is so it need not
re-derive one.

> **Author trap.** `apps/docs/guides/adding-skills-to-your-app.md` teaches the
> **capability-first** path, while kitchen-sink and the epic's decision both use
> **library + binding**. A sibling author who reads the published guide and the app will see two
> different answers.

### 2b. The activator kitchen-sink builds is missing its first-turn seed

`features.ts` passes `initialSkills` to `createSkillsLibrary` but constructs the activator as
`createSkillActivator({ activeState })` — **no `initialSkills`**. The matcher runs upstream of
the generator, so it cannot rely on the binding reader's lazy seeding: on a fresh collection all
three tiers see an empty catalog on turn 1 and match nothing. `createSkillActivator` only
prepends its seed step when `initialSkills` is non-empty, so kitchen-sink's activator has no seed
step at all. → `packages/orchestration/src/skills/skill-activator.ts`, the `initialSkills`
option contract.

**This is a bug in the demo, not a shape to port.** The kind must pass the same `initialSkills`
to both. → **FIX-1362** / **FIX-1363**.

### 2c. The per-turn cost, stated precisely

Corrected from an earlier "two or more on every turn". The real shape is per-gate, and each gate
is a different kind: one unconditional, one input-conditional, one threshold-latching, one
cadence-limited. The conclusion survives all four:

| Cost | When it fires |
|---|---|
| LLM classifier — one structured-output generator call | Only on turns **not** resolved by the slash or keyword tier. Both later tiers are `.tapIf(!ctx.sequencer?.state.resolved, …)`, so a `/skill` prefix or keyword hit short-circuits it. Ordinary conversational turns match neither and do pay it. |
| `system()` capture observer — one background generator call | **Every** turn (`captureFromItems` as a `.sideChain` in `run/run.ts`) |
| Semantic **prune** — one generator call | **Threshold-gated, and it can recur every turn.** `pruneGuard` tests only `facts.length >= pruneThreshold` (default 20) — there is no cadence or last-run condition, and `memorySystemCapture` wires prune as a `.sideChain()` on every turn. Once the store sits at or above the threshold, a conservative prune that removes nothing leaves it there, so the call fires again next turn. |
| Consolidation / digest / janitor chains | Genuinely cadence-gated. `consolidationGuard` tests `turnsSinceConsolidation >= minInterval` against `lastConsolidationTurn`; `run/cognition.ts`: the digest "refreshes after consolidation/prune actually mutate the semantic store … not on every turn" |

So: one extra call on every turn, two on every turn that skills don't resolve deterministically,
and a third on every turn once the semantic store is at its prune threshold — plus genuinely
periodic consolidation. That is the bill a default sets for everybody. Note the asymmetry: prune
is the one maintenance chain that is *not* cadence-limited, so it is the one most likely to be
mis-costed as "occasional".

### 2d. App-flat, session-global activation is not a per-seat register

Kitchen-sink's active-skill set lives at `{ scope: "session", field: "activeSkills" }` — one
session-wide set shared by every generator in the turn, over one flat catalog read from one
directory (`readSkillsDirectory` on `apps/kitchen-sink/skills`, at module init). FIX-1356's model
is `org ∪ team ∪ worker-local`, per seat. **Name the difference; do not copy the flat shape.**

### 2e. Most of `chat-agent` is not agent-kind material

The spine is `flows/chat-agent/run/` plus `shared/capabilities/features.ts`. **Everything else
under `flows/chat-agent/` is demo surface** — thinking-style pipelines, bias check, perspective
capture, artifacts, a bash sandbox, optional MCP, human-in-the-loop actions, voice, auto-titling.

All of it is good demo surface. **None of it belongs in an out-of-the-box default.** "Present in
kitchen-sink" is not evidence of "belongs in the kind".

### 2f. The killed agent surface is still taught where users can reach it

`defineAgent` / `materializeAgent` / `AgentRegistry` are FIX-1344's kill targets. Outside
`packages/workforce/src` and its tests they survive across four categories of user-reachable
surface: **published docs pages** (`apps/docs/docs/`, `apps/docs/guides/`), **the Atlas**,
**package READMEs**, and **one runnable example** (`examples/guides/research-team/` — code a
user copies).

The count drifts, so it is deliberately not enumerated here. The one finding worth carrying is
the easy-to-miss one: **the Atlas is four rendered `.html` files, not just its README.**
`docs/atlas/{workforce,conductor,framework,roadmap}.html` are not drafts —
`.github/workflows/pages.yml` uploads `docs/atlas` as the GitHub Pages site root, so each serves
at `/<name>.html`. A repair that greps only `*.md` misses all four.

→ **FIX-1366** owns the repair and should derive its own list:

```
grep -rl "defineAgent\|materializeAgent\|AgentRegistry\|createAgentRegistry" \
  --include=*.md --include=*.mdx --include=*.html --include=*.ts . \
  | grep -v node_modules | grep -v "^./packages/workforce/src"
```

Note that the Atlas hits are mostly **anti-teaching** ("do not teach `defineAgent` as a block
factory"), which is a different repair job from the published guides that teach it as the path.
Internal design docs and archived changesets also reference it; those are historical records, not
teach surface — only `docs/internal/design/agent-primitive-gaps.md` is a live design doc.

---

## 3. Named gaps — say these out loud, invent nothing

### 3a. Registration does not isolate storage

`createSkillsLibrary` defaults its collection to key `"skills"` at **`org`** scope
(`packages/orchestration/src/skills/library.ts`, the `options.collection ?? "skills"` and
`options.scope ?? "org"` resolutions). Kitchen-sink overrides to `scope: "user"`, and its own
comment records why:

> Org scope would be nicer for team-shared skills, but the chat-agent flow has no project wiring
> yet — "org" falls through to an ambient org with no persistence identity, which is why nothing
> seeds.

So two seats in one org registering the same bare `SKILL.md` name resolve to the same collection
entry. **A per-seat *register* over one shared collection gives isolation at the view level, not
at the storage level.** Real per-seat isolation needs a real resource identity — a distinct
collection key, prefix, or scope.

→ Contract is **FIX-1361**'s to state; **FIX-1362**'s to implement. This corroborates epic
theme 7 from source rather than from the epic's own assertion.

### 3b. Memory is per end-user, not per member

Kitchen-sink registers `mem.userResources` at `user` scope (`run/cognition.ts`, `flow.ts`). That
is durable per **end user**; there is no member or seat identity in it. A multi-seat roster
serving one user would share one memory.

The same app states the consequence plainly elsewhere — `flows/rich-text-component/memory.ts`:

> Because user-scoped resources are stored at bare `userId` (no flow-isolation by default), the
> same user's memories are visible to both flows — chat-agent writes them, this flow reads them.

→ **FIX-1364** names this gap. It does not paper over it with seat-local state that looks
durable and isn't, and it does not invent a new isolation primitive here.

### 3c. Which package exports the kind — narrowed, not decided

The kind must compose skills (`@flow-state-dev/orchestration`), memory
(`@flow-state-dev/memory`) and the hire surface (`@flow-state-dev/workforce`). Of those, only
`workforce` already owns the hire path the kind has to reach. → **FIX-1361**'s call; this is
evidence, not a decision.

---

## 4. What kitchen-sink still proves — port this shape

| Proves | Where | Why the kind cares |
|---|---|---|
| **The pipeline shape** | `flows/chat-agent/run/run.ts` | `sequencer(…).tap(…) ×4 → .step(router) → .sideChain(…) ×3 → .tap(terminal)`. Pre-generator taps decide state, one step produces the answer, background side-chains capture. This is the spine. |
| **Up-front skill activation works** (FIX-421 lineage) | `packages/orchestration/src/skills/skill-activator.ts`; wired as `skillActivatorBlock` in `features.ts` | Three tiers — literal `/<skill>` prefix, keyword scan over `keywords` frontmatter, LLM classifier. Returns a `.tap()`-able sequencer that patches state and passes input through, so it drops into any chain. Tier 3 is opt-out via `enableLlmClassifier: false`. |
| **Activator and reader agree through one state slot** | `features.ts` — activator `activeState` mirrored on the library binding | Matched skills land in the slot; the binding's formatter reads the same slot and injects bodies under `<skills>`. **This handshake is the mechanism to re-home**, whatever scope it ends up at. |
| **Per-generator skill scoping works** (FIX-911 lineage) | `createSkillsLibrary({ itemVisibility })` in `features.ts` | Attached as a **static** `uses` entry, because dynamic `uses` callbacks contribute tools and context but **not resources** — the collection must install at build time. Visibility stops worker generators inside patterns replicating skill bodies. |
| **Cross-turn memory works** | `run/cognition.ts`, `flow.ts` (`resources: { ...mem.userResources }`) | Four tiers (working / episodic / semantic / digest), capability on the generators, resources registered flat on the flow per FIX-435. |
| **Capability bundling** | `featuresCapability` in `features.ts` | One capability composing static `uses`, a dynamic `uses` callback for the optional MCP surface, and a `presets` block for feature-gated tools. This is the shape the kind's default tool/context surface should take. |

---

## 5. What must be re-homed onto the agent kind

1. **The pipeline becomes the kind's body, parameterized.** Kitchen-sink hand-wires the chain in
   application code. The kind owns the chain and takes its variable parts from configuration.

2. **Prompt composition moves onto `instructions`.** Kitchen-sink assembles its system prompt
   from `shared/prompts.ts` plus per-mode `*.prompt.md` files. The kind consumes
   `prompt: [default, instructions]` (epic theme 2) and **defines no second default-prompt
   config** — FIX-1344 part 2 owns shipping `default`; until it lands the kind ships against
   `instructions` alone with an explicit seam.

3. **Skill sources become tiered.** Kitchen-sink reads exactly one app-flat directory. The kind
   registers `org ∪ teams/<thatTeam> ∪ workers/<thatSeat>` (convention owned by FIX-1356,
   runtime bind by FIX-1362).

4. **Hire-time configuration and runtime overrides are *different things* — keep them apart.**
   This is the correction that matters most in this section, because kitchen-sink's controls are
   not all the same kind of control:

   | Control | Where it actually lives today | Where it belongs on the kind |
   |---|---|---|
   | Model choice | **User state** — `setSelectedModel` calls `ctx.user!.patchState` (`flows/chat-agent/settings.ts`) | `configSchema` seat **default**, still overridable per user |
   | Extended thinking | **User state** — `setThinkingEnabled`, same file | Same: seat default + user override |
   | Feature flags (search / fetch / crawl / bias check) | Arrive on **every `run` input**, copied to session state by the `apply-features` step (`run/steps.ts`) | Stay **per-turn runtime input**; a seat default is fine, replacing the runtime path is not |

   Folding all of these into `configSchema` alone would delete per-user preferences and per-turn
   controls the app has today. `configSchema` is how `hireWorkforce` fills a seat from
   `WORKER.md` — the shape `workerAgentFlow` demonstrates in
   `packages/workforce/test/hire.test.ts` (`configSchema: { instructions, model, tools }`) — and
   it is a **default layer**, not the only layer. → **FIX-1361** (contract) / **FIX-1363** (kind).

---

## 6. One thing that is *not* a blocker

**The skills module's coupling to the kill-target cluster is optional injection, and
kitchen-sink does not use it.** This is easy to get backwards, so precisely:
`createSkillsLibrary` accepts optional `agentRegistry` and `materializeAgent`
(`packages/orchestration/src/skills/library.ts`), and `skills/delegation-surface.ts` and
`skills/worker-materializer.ts` thread them through; a skill whose `agents:` map names a registry
agent throws without them.

Kitchen-sink passes **neither** — its skills resolve board workers through
`workerModelId: "intent/chat"` instead. So the path the agent kind would inherit is the one that
does *not* touch the cluster, and **FIX-1344's deletion does not block FIX-1362** (epic theme 3,
corroborated from source). The seam is real and stays optional.
