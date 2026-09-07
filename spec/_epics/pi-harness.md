# Epic-spec — pi as a harness, and FSD from inside pi

**In one line:** teach FSD to hand coding work to pi, and teach pi to run FSD flows — so a
board row can be dispatched to an agent that can *stop and ask you something*, and you can
watch and answer from the editor you already have open.

## The 60-second version

Today conductor dispatches coding work to Claude Code. That works, but the run is a black
box with a lid: it cannot ask you a question halfway through. Conductor's own `ask.ts` admits
it — the harness "offers no seam for a question, so this ask is forced rather than
spontaneous." The agent has to guess, finish, and be corrected afterwards.

pi can do better, because pi extensions can intercept a tool call and *block on it*. That
turns a run from a black box into a conversation:

```text
  conductor board row  ──dispatch──▶  spawned pi run
                                          │
                          "staging or prod DB?"   │  (run blocks)
                                          ▼
  you, in your own pi session  ◀────  FSD host
         │
         └─ "staging"  ────────▶  run resumes, PR lands
```

**Two directions, one loop.** Direction A is *FSD inside pi*: a `/flow` command, streaming
items, questions surfacing where you already are. Direction B is *pi as harness*: conductor
spawning `pi --mode json` instead of Claude Code. A is the window; B is the engine. The Proof
needs both.

**Five issues.** PI-1..3 build the operator console (no FSD changes needed at all). PI-5 makes
pi dispatchable *against a contract that already exists* — `@flow-state-dev/core`'s
`HarnessBlock`, drawn by the harness-manager epic from Claude Code and Codex and shipped on
`main`. PI-6 wires the question channel that makes the whole thing worth doing. **PI-4 is
dropped**: it proposed extracting the contract this epic now merely conforms to. See theme 6.

**Biggest open risk:** a mid-run question has nowhere durable to live — `announce` fires only
*after* the row parks, and in the published `@flow-state-dev/harness-manager` that is a
**stated invariant** rather than an accident of a lab: "After the park, never before. What is
announced must already be answerable" (`manager.ts:1498–1504`). FSD does ship `suspension` /
`suspension_resume` items and a `"suspended"` status, so a bridge is buildable — but PI-6 now
has to argue against a deliberate decision in a shipped package, not fill a gap in a
prototype. §5, first question. Unowned, and worth more than ten minutes before anyone specs
PI-6.

> **Filing note (delete once the epic issue exists).** This file was drafted on `poc/pi`.
> The convention is `spec/_epics/<name>.md` on branch `epic/pi-harness`, with a never-merged
> epic PR and a Linear parent issue carrying the `Epic` label. Issue IDs below are
> placeholders (`PI-1` … `PI-6`) — replace them with the real Linear IDs when the sub-issues
> are filed, and the `§4` running index becomes live at that point.

---

## How to review this

*(Paste verbatim into the epic PR description's collapsed `<details>` block.)*

This is an **epic-spec**: the shared objective and cross-cutting decisions for a *set* of
issues. It is not an implementation plan and it is not any one issue's design.

**In scope to challenge:**

- The objective — is this body of work worth doing, and is the outcome the right one?
- **Whether the set overbuilds.** Each issue can earn its place while the whole is too much.
- A cross-cutting decision in §2 — shared surface, naming, sequencing, contracts.
- A missing issue the objective implies, or one in the set that doesn't serve it.

**Out of scope — owned by the individual issue specs:**

- Any single issue's approach, architecture, file layout, or test plan.
- Anything that touches exactly one issue. It belongs on that issue's spec PR.
- **Any POC files on this branch, entirely.**

Feedback in the second list is routed to the issue it concerns as an implementer note,
not folded in here.

---

## Parts worth reviewing closely

> **1. §1 — whether this is five issues or three.** The set spans two directions (pi as
> client, pi as harness) and the honest question is whether they are one epic or two. An
> earlier draft justified keeping them together by claiming a harness without the console is
> "a harness nobody can watch"; that was **wrong** — conductor already has run records,
> `status` and an inbox (`labs/conductor/src/manager.ts` 248–263). The set is kept together on
> a narrower claim: the objective is a *loop*, and the Proof requires both ends. If a reviewer
> rejects that, this splits into a console epic and a harness epic joined at PI-3/PI-6.
>
> **2. Theme 1 — two packages, not one.** The opening instinct was a single `packages/pi`
> carrying both halves. It is split on install-model grounds, and this is the decision most
> likely to be re-litigated by an implementer who only sees one half.
>
> **3. Theme 6 — PI-4 is dropped, because the contract already shipped.** Two earlier drafts
> argued about *when* to extract the harness contract and in what order. Both are moot:
> `@flow-state-dev/core`'s `HarnessBlock` / `HarnessRunHandle` landed on `main` out of the
> harness-manager epic, drawn from Claude Code **and Codex**, and `harnessManager` already
> takes a `harness` slot. pi is harness three against an existing contract. This is the
> largest change since the draft that was POC'd — **a reviewer who read the earlier version
> should re-read themes 3, 4 and 6 and §4 rather than skim them.**
>
> **Where I'm unsure:** whether PI-3 survives its own scope-down. It is the weakest issue and
> the POC promoted it from a sequencing preference to a hard dependency of PI-6 (see §3),
> which is the opposite of the direction a weak issue usually travels.

---

## 1. Purpose & objective *(the gated sign-off surface)*

**Objective.** Make pi a coding harness FSD can dispatch to, and make an FSD flow something
you can run and watch from inside pi. Today the harness slot is Claude Code and nothing else,
and a conductor run's questions are discovered by polling `status` rather than by being asked.
When this epic lands, a board row can be worked by a pi run, and the operator is *told* when
that run needs them.

> **Package names.** Two artifacts, named here so no issue has to guess: **`packages/pi`** is
> the FSD-side harness (installed by the FSD host; PI-5), and **`packages/pi-extension`** is
> the operator console a developer installs onto their own machine via `pi install` (PI-1..3).
> Names are provisional — §5's single-source option may change how they are *published* — but
> the two-artifact split itself is theme 1's load-bearing decision and does not change.

**Holistic necessity.** Five issues plus one unowned bridge (§5), and the honest question is
whether it is three. Direction
A (PI-1..3, FSD from inside pi) is independently useful and needs no changes to FSD. Direction
B (PI-5..6, pi as harness) is where the leverage is, and it is **observable without A** —
conductor already carries run records, `status` and a durable inbox. What A adds is that the
operator is *told* rather than having to look. The set is one epic because the objective is
the loop, and the Proof cannot be read off either half alone. The ask seam (PI-6) is what
makes B a capability rather than a substitution: conductor's own `ask.ts` records that the
current harness "offers no seam for a question, so this ask is forced rather than
spontaneous" (that reasoning now lives in `packages/harness-manager/src/ask.ts`, and it was
checked rather than assumed). **PI-3 is the weakest of the five** and is scoped down to wiring the existing
`announce` hook with no new inbox semantics; if it grows a durable store or a second question
shape, that is the signal it should have been deferred.

**Proof.** PI-6's goal check, which that issue must produce as a runnable end-to-end check
rather than an assertion: a conductor board row dispatched to the pi harness raises a question
mid-run, the operator is prompted in their own pi session without polling, answers there, and
the run resumes and settles the row.

**Lead measure.** The set's goal-proven issues, named each report.

**Kill line.** Judged on four observable conditions, and **approval and spontaneous ask are
judged separately** — one can hold while the other does not, and that leads to a scoped cut
rather than an all-or-nothing verdict. For either seam to count: (a) a spawned run blocks on
it; (b) the block is durably correlated to its conductor issue/phase/attempt; (c) an operator
response reaches the blocked run and it resumes; (d) loss of either process fails safe —
the attempt ends and the row is settled or retried, never left running unbounded. If neither
seam meets all four, a pi harness is an alternative to Claude Code rather than an improvement,
and this epic should not finish: ship PI-1..3 as the operator console and stop.

**None of the four is yet discharged.** §3's POC removes a *mechanism* risk underneath (a) and
(c) — an awaited pi extension callback can be settled by another process seconds later — but
it never exercised a tool call or an approval interception, so all four remain PI-6's to earn.
Condition (d) must name its bound, not merely assert safety: an unanswered request or a dead
host has to hit a stated deadline that ends the attempt through the existing run timeout and
settles or retries the row.

**Not doing:**

- **MCP as the transport.** See theme 2.
- **Embedding `@flow-state-dev/engine` in the pi process.** See theme 2.
- **Defining flows in the extension.** The extension dispatches and renders; it never
  defines. The moment flow logic lives in the extension there are two runtimes.
- **A `source: "pi"` inbound transport adapter.** It buys provenance on `RequestRecord.source`
  and a place to hang a principal resolver, and neither direction needs it to work. Deferred
  deliberately, not forgotten.
- **Renegotiating the harness contract.** `@flow-state-dev/core` already carries it, drawn
  from Claude Code and Codex. pi conforms to `HarnessRunInput` / `HarnessRunHandle` and is
  installed through `harnessManager`'s existing `harness` slot. If conforming turns out to be
  impossible, that is a finding to raise on this PR — not a licence for PI-5 to widen the
  contract locally.

## 2. Themes & long-horizon direction

> **The themes below are the cross-cutting decisions — the things that would be expensive to
> change once issues start landing. Skim the bold sentence of each; read the body only for
> the ones you want to challenge.**
>
> 1. Two packages, not one · 2. HTTP, not MCP · 3. The event contract is *not* the type I first
> named · 4. Conductor's coupling is concrete *(now history)* · 5. The question channel ·
> 6. The contract already shipped — PI-4 is dropped · 7. Trust is explicit · 8. Item routing ·
> 9. Auth and usage borrowing

1. **Two packages, and the shared thing is a contract in neither of them.** The operator
   extension and the harness are separate packages because they have incompatible install
   models: the extension is installed by a *developer onto their own machine* (`pi install`,
   landing in `~/.pi/agent/npm/`, with pi's core packages as un-bundled `peerDependencies`),
   while the harness is installed by the *FSD host* (`@flow-state-dev/core`, `workspace`,
   `zod`). Merging them makes every extension user `npm install` a copy of `core` they never
   execute — and pins their extension to a `core` version, which is precisely the coupling
   theme 2 chose HTTP to avoid. What the halves genuinely share is the `HarnessEvent`
   vocabulary, and that cannot live in a pi package because `claude-code` must satisfy it too
   (see theme 3). The division mirrors one the repo already has: `packages/claude-code` is the
   FSD-side integration, `plugins/flow-state-dev` is what a developer installs onto their
   machine.

2. **The transport is HTTP + SSE against a `fsdev` host, via `@flow-state-dev/client`.**
   Not MCP: the MCP adapter is stateless-by-default with a single JSON result and no SSE,
   which discards streaming *and* session continuity — the two properties that make embedding
   FSD in an agent worth doing. Not the in-process engine SDK: a pi extension loads via jiti
   into a long-running interactive process, and hosting the registry, stores, streaming and
   model resolution there means model auth is resolved twice and a flow fault takes the
   operator's session with it. (An earlier draft also asserted flow spend never reaches pi's
   footer; that was never verified against pi's usage accounting and is dropped rather than
   carried as decoration.) The extension owns an
   out-of-process host (spawned in `session_start`, torn down in `session_shutdown`) or
   attaches to a running one. **No issue in this epic imports `@flow-state-dev/engine` into
   the pi process.**

3. **One harness event vocabulary, derived from `TranslatedEvent` — but not by adopting it
   wholesale, and not from `SdkMessageLike`.**
   `SdkMessageLike` (`packages/claude-code/src/sdk/types.ts` ~70–160) is explicitly a
   "structural subset of the SDK's `SDKMessage` union": Anthropic wire format, carrying
   `session_id`, `parent_tool_use_id`, `thinking`/`tool_use` content blocks, and a
   `SdkResultSubtype` of Claude's own vocabulary (`error_max_turns`, `error_max_budget_usd`).
   It is **not** a neutral vocabulary and must not be lifted. The neutral candidate is the
   package's *post-translation* `TranslatedEvent` union (~164–278) — `file_op_observed`,
   `plan_item_observed`, `work_gap_observed`, `status`, `error`, normalized `result` — whose
   own comment states the point: "by the time this exists the tool names are gone, which is
   what keeps the vendor mapping to one site." Even that is not a contract as it stands, for
   two reasons: its file-op and plan-item variants encode the Claude work-recorder's semantics,
   and **its terminal result still carries `SdkResultSubtype`** (`types.ts:270`) whose values
   are Claude's own — `error_max_turns`, `error_max_budget_usd` (`types.ts:13–19`).

   **Both decisions this theme posed have since been made on `main`, and not by this epic.**
   The neutral home is `@flow-state-dev/core` (`packages/core/src/types/harness.ts`) — *not*
   `contracts`, and the file states why: a block declares a **runtime** schema for its output,
   which the zero-dependency layer cannot carry. The neutral terminal type is
   `HarnessRunOutcome` — `"finished" | "stopped-at-limit" | "failed"` — with the vendor's
   richer reason kept on the vendor's own extension, "so no framework code ever branches on a
   vendor string." And work observation is **not** in the contract: `recordWork` stays a
   Claude Code option the host passes inside its own slot closure
   (`harness-manager/src/manager.ts:245`), so no harness owes it.

   **Translation from vendor messages stays inside each harness** is the one part of this
   theme that survives unchanged, and it still binds PI-5.

4. **The coupling this theme was written to break is already broken — read the rest as
   history.** `@flow-state-dev/harness-manager` on `main` "imports no coding agent and reads
   no vendor field: the host hands it a factory," and that factory is `HarnessSlot`:
   `(feeds: HarnessFeeds) => HarnessBlock`, where the feeds are exactly `cwd`, `resume` and
   `onSession`. What follows describes `labs/conductor` as it stood when this was drafted, and
   is kept because PI-5's shape is easier to judge against what the coupling *was*.

   The board/checkout/attempt/verdict flow in `manager.ts` is genuinely harness-neutral and
   should not be rewritten. But the coupling was concrete, not a type annotation: `manager.ts`
   imported `claudeCodeAgent` directly (line 45) and invokes it as a sequencer step (1383–1396),
   forcing `detached: true`, `recordWork: true`, and a `cwd` callback, with a result schema
   expecting `sessionId`/`finalMessage`/`usage`/`costUsd` (1180–1200). `recordWork: true` means
   the manager depends on the Claude integration's **work-observation behaviour**, not just its
   terminal status — so the contract must cover normalized terminal result, cancellation,
   resume-id semantics across retries, and work observation. An issue that finds itself
   changing the manager's *control flow* has hit a cross-cutting question — comment up on this
   PR rather than deciding it locally. **PI-5's real job is now much smaller than this theme
   implies**: supply a `HarnessSlot` closure that returns a conforming pi block, and let the
   published manager own everything else.

5. **A spawned pi run's question and approval seam is a companion extension, not an in-band
   callback — and the channel it speaks is a cross-cutting concern.**

   ```typescript
   // The asset the harness ships and loads into the run via `pi -e`.
   // Claude Code gets this from the SDK's canUseTool. pi has no in-band
   // equivalent — blocking is an extension-side API, so it needs a companion.
   pi.on("tool_call", async (event) => {
     if (!risky(event.toolName)) return;
     const verdict = await host.ask({ tool: event.toolName, input: event.input });
     if (verdict.denied) return { block: true, reason: verdict.why };  // ◀ run stops here
   });
   ```

   Claude Code's SDK exposes
   `canUseTool`, which is why `claudeCodeAgent` has `onToolApproval`. pi has no equivalent: its
   `tool_call` blocking hook is an *extension-side* API living inside the pi process. So the
   harness ships a companion extension as an **asset** (a file loaded into the spawned run via
   `pi -e`), which intercepts `tool_call` and registers an ask tool, and calls back to the
   dispatching flow. Being an asset rather than a dependency is what keeps the harness package
   free of a pi dependency. §3's POC shows an awaited extension callback can be settled by
   another process, but did **not** exercise interception or tool execution. **The channel
   itself is not a detail PI-6 may invent locally**: it needs an authentication posture that is
   per-attempt rather than ambient, run/attempt correlation, cancellation and liveness, and
   defined behaviour when either process dies. PI-6 owns it, but it is stated here because a
   wrong answer strands paid runs rather than affecting one issue's design.

6. **The contract already shipped, so PI-4 is dropped and PI-5 conforms rather than
   generalises.** Two earlier drafts of this theme argued the *order* of extracting a harness
   contract: draw it first (rejected — abstraction for a set of one), then draw it from pi and
   Claude Code with PI-5 before PI-4. Both are moot. The harness-manager epic landed the
   contract on `main` while this spec was being POC'd, drawn from **Claude Code and Codex**:

   - `@flow-state-dev/core` (`packages/core/src/types/harness.ts`) owns `HarnessRunInput`,
     `HarnessRunEnvelope`, `HarnessRunHandle`, `HarnessBlock`, `HarnessResolver` and
     `HarnessSessionHook`.
   - `@flow-state-dev/harness-manager` owns the `harness` slot —
     `HarnessSlot = (feeds: HarnessFeeds) => HarnessBlock` — plus the run record and inbox.
   - `@flow-state-dev/codex` is the proof the contract survives a second vendor.

   **So the sequencing constraints this theme used to impose are gone.** There is no private
   seam in `labs/conductor` to keep unexported, no two-invocation-path window to close, and no
   "PI-4 cannot be specced until PI-5 has a shape to generalise from." PI-5 writes a
   `HarnessSlot` closure returning a pi block whose handle parses against
   `harnessRunHandleSchema`, and names itself `pi/cli-json` under the contract's own
   `<package>/<door>` convention.

   Three obligations the contract hands PI-5 directly, none of which it may renegotiate:

   - **The prompt is the only block input.** Working directory and resumed session arrive
     through `HarnessResolver`s the host feeds, never on the input schema, because that schema
     is model-facing through a capability tool preset (BP-031). The resolver is handed `ctx`
     and *deliberately not* the input.
   - **Abort is not a field.** A conforming harness forwards the block's `ctx.signal` into
     whatever cancels the run, and a cancelled run surfaces as a **throw**, not a handle
     status. This is load-bearing for Kill-line condition (d).
   - **`onSession` fires the moment pi names a session**, during the run and not after it, or
     a run that dies mid-flight leaves nothing to resume.

   Sequencing that remains: PI-1 lands first; PI-2 and PI-3 build on its transport. PI-6
   depends on PI-5 and on the §5 mid-run question bridge. PI-1..3 and PI-5 can all be specced
   in parallel.

7. **Trust is decided explicitly, never inherited.** `claude-code` carries `settingSources`
   because a checkout the run did not come with can otherwise configure the agent working in
   it. pi has the identical hazard with project trust and `.pi/extensions` discovery, and the
   identical control (`project_trust`). Any issue that spawns a pi run states its trust
   posture rather than defaulting to `defaultProjectTrust`.

8. **Item routing is a policy, decided once — and it is a 24-type allowlist, not a two-way
   split.** An earlier draft said "progress and status render TUI-only; outputs and gaps enter
   the tool result." That vocabulary was invented. The real `RuntimeItem` union in
   `@flow-state-dev/contracts` has **24 types** (`block_trace`, `component`, `container`,
   `continuation`, `debug`, `error`, `file`, `generator_step`, `message`, `output_audio`,
   `output_text`, `ping`, `reasoning`, `reasoning_text`, `refusal`, `resource_change`,
   `router_decision`, `source`, `state_change`, `state_snapshot`, `status`, `suspension`,
   `suspension_resume`, `tool_output`), and a trivial handler flow emits `block_trace` — not
   any of the four names the spec used.

   So the policy is: **TUI-only by default, promoted to tool-result `content` by explicit
   allowlist.** Defaulting the other way puts `ping` keepalives and `state_snapshot` dumps
   into the operator's context window. PI-1 sets the allowlist and PI-2 extends it; no issue
   invents a second rule.

   ```text
   flow item ─┬─ default (most of 24)  ─▶ appendEntry()      → operator sees it, LLM does not
              └─ allowlisted          ─▶ tool result content → both
   ```

9. **Borrowing pi's auth is possible and probably right for the extension; borrowing it for
   the harness is neither.** A probe (`spec-poc/epic-pi-harness/auth-findings.md`) confirmed
   `ctx.modelRegistry.getProviderAuth(id)` hands an extension live, actively-refreshed OAuth
   credentials (`source: "OAuth"`), that `modelRegistry.complete()` can run inference through
   pi's own auth, and that a tool returning `usage` lands in pi's footer and `/session` totals
   (`docs/extensions.md:2013`). **The two directions have opposite answers:**

   | | Auth | Usage |
   | --- | --- | --- |
   | **Harness** (conductor spawns `pi`) | Non-problem. The subprocess resolves its own `auth.json`. | Belongs to conductor's cost record, not a footer. |
   | **Extension** (flows run from your session) | Real choice: borrow pi's, or make the host log in separately. | Real opportunity: `usage` on the tool result. |

   So there is **no double-login problem in Direction B** — that intuition, though reasonable,
   does not survive contact: a spawned `pi` is already logged in.

   For Direction A, prefer **`complete()` over token-passing**: it keeps the credential inside
   the process that owns it. Handing a raw token to a separate host process means it can be
   invalidated mid-flow by pi's own refresh, and it puts a secret somewhere its owner cannot
   revoke. Whether FSD generators can run on `complete()` at all is unverified and is §5's
   question, not a decision this document makes.

## 3. Shape of the whole *(POC)*

Three probes, each answering one question. All in `spec-poc/epic-pi-harness/` on this branch,
each with its own findings file. **None of them touch each other — no end-to-end path has
run.**

| Probe | Question | Verdict |
| --- | --- | --- |
| `probe.ts` + `host.mjs` | Can a pi extension block on a remote answer? | Yes, narrowly — see below |
| `auth-probe.ts` | Can pi's auth and usage be shared with FSD? | Yes; `auth-findings.md` |
| `real-flow.test.ts` | What does a *real* flow actually return? | 2 tests pass; `real-flow-findings.md` |

**Built:** a stand-in FSD host, a companion extension loaded into a spawned run via `-e`, a
no-LLM mechanics probe, an auth-surface probe, and a real flow driven through the real
`runAction` engine.

**See it:** `node host.mjs &` then `pi --mode json -e ./probe.ts -p "hi"`; read
`probe-result.json`. The flow test runs from `packages/testing` (see its findings file for
why).

**Showed — stated narrowly, because the first write-up of this POC over-claimed it.** Three
facts: a `-e` extension loads in a headless `--mode json` run; it registers a tool that is
visible to the run (`flow_ask` among 57); and an awaited extension callback stays pending
across a 2136ms cross-process round trip and resolves with the host's answer intact. The last
is the property that matters — a pending promise inside a pi extension can be settled by
another process seconds later — and the file-mailbox transport does not weaken it, since
`await` semantics do not depend on whether the bytes arrive over a socket or a file.

**What it did NOT show, despite an earlier draft of this section claiming otherwise:** the
probe calls the host *directly from its `session_start` listener*, not through the `flow_ask`
`execute()` handler. No `tool_call` event is ever raised, so **`companion.ts`'s approval
interceptor was never exercised**, and the ask tool was never shown to block a real agent
turn. Tool *registration* is not tool *execution*. The model-driven path failed entirely (no
outbound network in the authoring sandbox). pi's docs independently state that `tool_call`
can block (`docs/extensions.md` 778–793), but that is documentation, not demonstration.

It also showed `ctx.hasUI` is **false** in `--mode json`: the companion cannot prompt through
pi's own UI inside a spawned run.

**The other two probes did more damage to the spec than the first one did good**, which is
the argument for having run them:

- The **auth probe** killed a plausible assumption (that a pi harness would force a second
  login) and opened a real design choice for the extension direction. Theme 9.
- The **real-flow probe** caught the spec inventing FSD's own vocabulary: theme 8's item
  routing named four item types that do not exist, against a real union of 24. It also found
  `suspension` / `suspension_resume` items and a `"suspended"` status, which may mean §5's
  blocking question is already answered by the substrate.

**Changed:** the Kill line became four observable conditions with approval and ask judged
separately — but *none* of the four is discharged by this POC; it removes a mechanism risk
underneath (a) and (c) rather than satisfying them. Theme 5 gained the channel's
cross-cutting obligations, which the probe made conspicuous by deliberately having none. And
the mid-run question bridge (§5) was found only because `hasUI: false` forced the question of
where a live question actually goes — which turned out to be the epic's real hole.

## 4. Running index

| Issue | What it delivers | Route | Spec PR | Impl PR | State |
| --- | --- | --- | --- | --- | --- |
| PI-1 | `packages/pi-extension` v1: HTTP client, host lifecycle, `/flow` command, dispatch + render | spec | — | — | Needs spec |
| PI-2 | SSE item streaming and flow-session continuity across pi sessions and forks | spec | — | — | Needs spec |
| PI-3 | `announce` → pi: questions surface in the operator's UI, answered from there | spec | — | — | Needs spec |
| PI-5 | `packages/pi`: `piAgent` conforming to core's `HarnessBlock`, over `pi --mode json`, installed through `harnessManager`'s `harness` slot | spec | — | — | Needs spec |
| PI-6 | Companion extension: approval interception, the ask seam, and the host channel | spec | — | — | Needs spec |
| ~~PI-4~~ | ~~Harness contract extracted from *two* implementations~~ — **dropped**, shipped by the harness-manager epic (`@flow-state-dev/core`, `@flow-state-dev/codex`) | — | — | — | Not filed |

## 5. Open cross-cutting questions

- **Does the operator extension need `@flow-state-dev/client` at all, or should it speak raw
  `fetch` + SSE?** Raised while scoping PI-1. `client` is isomorphic and already implements
  `Last-Event-ID` resume, which maps onto a pi restart for free — that is the argument for
  taking the dependency. The argument against is that it is the extension's *only* FSD
  dependency, and dropping it would make the extension version-independent of the whole
  framework. Blocks nothing; PI-1 proceeds on "use `client`" and folds if resume turns out to
  be the only thing it was carrying.

- **Is the extension published to npm, or installed from git/local path?** Raised while
  scoping PI-1. `pi install` accepts `npm:`, `git:` and local paths, so a v1 can ship without
  answering it. Publishing brings the extension under the repo's changeset discipline and
  makes it a supported surface; git/local keeps it internal while the shape settles.
  Recommend deferring publication until PI-3 lands, since the console is not useful to anyone
  else until it can carry a question.

- **In-process pi SDK, or `pi --mode json` subprocess, for PI-5?** Raised while scoping the
  harness. The subprocess is sequenced first (theme 6 names it) because it matches how
  the manager already treats a run as something that happens in a checkout it owns, and because
  isolation is worth more than latency for a paid coding run. The in-process route mirrors
  `resolveClaudeAgent` more exactly and would make a scripted fake cheaper in tests. PI-5
  decides; a resolver seam should exist either way so the choice is not load-bearing.

- **Who owns a mid-run question, and what bridges it to the operator? — blocking, unowned,
  and harder than the earlier draft thought.** The largest remaining hole, and re-cited: the
  post-park announce is no longer a lab's accident but a **stated invariant of a published
  package**. `@flow-state-dev/harness-manager` calls `board.awaitReview(...)` and only then
  `announce({ question })` (`manager.ts:1498–1504`), with the reason written beside it:
  "After the park, never before. What is announced must already be answerable: a subscriber
  fast enough to act on an announcement sent earlier…". But `flow_ask` blocks **during** a
  live run. PI-3 is scoped to the existing announce path with no new inbox semantics, so
  **PI-3 as specced cannot carry a live question** — and PI-6 must now argue against a
  deliberate decision in a shipped package rather than fill a prototype's gap.

  **Check this before designing anything.** The real item vocabulary contains `suspension` and
  `suspension_resume`, and `testFlow` already reports a `"suspended"` terminal status
  (`spec-poc/epic-pi-harness/real-flow-findings.md`). FSD may already have the durable
  suspend/resume primitive this question assumes must be built. If it does, the answer is to
  *use* it rather than invent a second question shape, and this stops being a design question
  and becomes a wiring one.

  If it does not, someone must decide: does a mid-run ask create a durable conductor question
  immediately (reusing the park/announce path, at the cost of parking a still-running
  attempt), or stay live on the companion channel with separate notification (at the cost of a
  second question shape and no durability if the host dies)? Plus who assigns
  issue/phase/attempt correlation, and who owns cancellation. This decides PI-3's real scope
  and PI-6's feasibility, so it should be resolved **before** the objective gate.

  **What the delivery half costs is now known, and it is cheap.** Whatever the durable answer
  turns out to be, reaching the operator does not need a new pi mechanism. A pi extension can
  hold a background poll or subscription started in `session_start` and injected with
  `pi.sendMessage(..., { deliverAs })`, where `"steer"` delivers **after the current assistant
  turn finishes its tool calls, before the next LLM call** — mid-run, without waiting for the
  agent to settle — and `"followUp"` waits for it to settle. `triggerTurn: true` wakes an idle
  session. `docs/extensions.md` (`pi.sendMessage`, and the `file-trigger.ts` example, which is
  this shape end to end). So **the operator console is not limited to park-time delivery**,
  and PI-3 does not have to solve durability to be useful. That does not close this question,
  which is about where the question durably *lives* and who correlates it — only about how it
  reaches a watching human once it exists.

- **One source package with two publishable artifacts, instead of two packages?** Raised by
  epic review. A single source location could emit a thin pi-package manifest for the extension
  and a separate npm entry for the harness, sharing build tooling but not install dependencies
  — preserving one ownership location while keeping the runtime split theme 1 requires. It may
  collapse back to theme 1 in practice, since `pi install` resolves an npm package name and so
  the extension needs its own manifest regardless. Blocks nothing; theme 1's *runtime/install*
  split is the load-bearing part and holds either way. A simpler interim: run the extension as
  a project-local `.pi/extensions` entry during validation and defer publishing entirely.

- ~~**Where does the neutral harness contract live — `contracts`, or a new
  `packages/harness`?**~~ **Answered on `main`, by the harness-manager epic, not by this
  one.** It lives in `@flow-state-dev/core` (`packages/core/src/types/harness.ts`), and the
  reason rules out the option this question favoured: a block declares a **runtime** schema
  for its output, which the zero-dependency `contracts` layer cannot carry. PI-5 and PI-6
  import from `core`.

---

## Epic evolution

- **After reconciling against `main` (7 Sep)** — the spec was drafted blind to the
  harness-manager epic, which shipped the thing PI-4 proposed to build. `packages/codex` and
  `packages/harness-manager` are on `main`; the neutral contract is in `@flow-state-dev/core`,
  drawn from Claude Code and Codex; `harnessManager` takes a `HarnessSlot`. **Dropped PI-4**
  and rewrote theme 6 around conforming rather than extracting, with the three obligations the
  contract imposes on PI-5 (prompt-only input, abort-as-throw, `onSession` during the run).
  Closed theme 3's two open decisions and §5's neutral-home question — all three were answered
  on `main`, none by this epic. Re-cited theme 4 as history and the mid-run question bridge to
  `harness-manager/src/manager.ts:1498–1504`, where post-park announce is a **stated
  invariant** rather than a prototype's gap, which makes PI-6 harder than the previous draft
  assumed. Added the one piece of good news: `pi.sendMessage`'s `deliverAs: "steer"` delivers
  between turns of a live run, so the console is not limited to park-time delivery.

- **After two more probes** — ran an auth probe and a *real* flow through the real `runAction`
  engine, having previously tested only against a mock host. Added theme 9 (auth/usage
  borrowing: no double-login exists for the harness direction; `complete()` preferred over
  token-passing for the extension). Rewrote theme 8 after the real item union turned out to
  have 24 types, none of them the four the spec had invented — routing is now an allowlist
  with a TUI-only default. Flagged in §5 that `suspension`/`suspension_resume` items and a
  `"suspended"` status already exist, so the mid-run question may be wiring, not design.
  Added an executive summary and diagrams after the spec was called unreadable.
- **After the POC was re-reviewed** — corrected §3, which over-claimed its own probe: the probe
  calls the host from `session_start`, never through the tool's `execute()`, so no `tool_call`
  fires and the approval interceptor was never exercised. Kill-line conditions (a) and (c) went
  back to undischarged. Found that `TranslatedEvent`'s terminal result still carries
  `SdkResultSubtype`, so theme 3 owes a neutral outcome type too. Added PI-5's private-seam and
  single-invocation-path constraints. Opened the mid-run question bridge in §5 after finding
  `announce` fires only *after* `board.awaitReview` (`manager.ts:1244`), so PI-3 as scoped
  cannot carry a live question.
- **Epic drafted** — six issues across two directions under one outcome: pi is a harness FSD
  can dispatch to, and an FSD run is something an operator can watch. Split the proposed single
  `packages/pi` into two packages after the install models turned out to be incompatible, and
  scoped PI-3 down to wiring the existing `announce` hook with no new inbox semantics.
- **After epic review** — corrected theme 3 (the neutral vocabulary is `TranslatedEvent`, not
  `SdkMessageLike`, which is Anthropic wire format) and theme 4 (conductor's coupling is a
  direct import and invocation forcing `recordWork`, not a type-level hardcode), because both
  understated PI-4 as relocation when it is a design. Dropped a claim that
  `PhaseRunContext.harnessPrincipal` exists — it does not. Reversed theme 6 to put PI-5 before
  PI-4, because drawing a contract from one harness is the abstraction-for-a-set-of-one the
  repo rejects. Narrowed §1's necessity claim after review showed conductor's runs are already
  observable without the console.
- **After the §3 POC** — rewrote the Kill line as four observable conditions with approval and
  ask judged separately, two of them now demonstrated; promoted PI-3 to a hard dependency of
  PI-6 on the strength of `hasUI: false` in `--mode json`; and gave theme 5 the host channel's
  cross-cutting obligations.
