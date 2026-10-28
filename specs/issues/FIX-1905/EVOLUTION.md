# FIX-1905 · Evolution

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md) · **Evolution**

| Prior intent and precise source | Treatment | Why / evidence | Replacement | Compatibility |
|---|---|---|---|---|
| **This spec's first D2**: "The key reaches Claude Code in its own MCP config, not through an FSD-side relay." Source: this PR at `03b54c9`, `DECISIONS.md` | **Superseded** by the product owner | Jake, [comment 6131359139](https://github.com/fixpoint-labs/flow-state-dev/pull/3174#issuecomment-6131359139): "D2 can't be through Claude … We need to provide a settings page which allows keys to be configured." Then: "We don't have a concept of admins, just let each user set their own key" | [D2](DECISIONS.md#d2), [D4](DECISIONS.md#d4) | Nothing was built |
| **Epic FIX-1903, as merged** (the statements listed below) | **Contradicted here; amended by the epic's own follow-up PR from `main`** ([ER-17](../../epics/FIX-1903/BUSINESS-RULES.md#what-no-child-may-do)) | The same two calls. What holds unchanged: a row names a host-approved alias only, never a URL, variable or key (ER-14); servers are read at run start from the run's own project, never a hand-over (ER-5, D4's chosen option, ER-8); the value reaches the MCP connection only | This spec, until the amendment lands | — |
| **LAB-138 decision 3**: "A per-run working directory is the only thing this adds to the published framework, and no harness-swapping interface is built anywhere." Source: [LAB-138 — Implementation Spec](https://linear.app/fixpoint-labs/document/lab-138-the-harness-manager-implementation-spec-8444a9f240f9), §6 item 3, [spec PR #1437](https://github.com/fixpoint-labs/flow-state-dev/pull/1437) | **Retained, and not engaged** | Its text scopes it to LAB-138's own change set. `claudeCodeAgent` has since gained `resume`, `onSession`, `env`, `sandbox`, `settingSources`, `uses` and `onErrored` without amending it | [D3](DECISIONS.md#d3) adds `mcpTools` under [ER-9](../../epics/FIX-1903/BUSINESS-RULES.md#what-no-child-may-do) | Unset is today |
| **`ask.ts`'s reading of it**: "There is no MCP-server option … cannot be built without widening the framework — which LAB-138's decision 3 rules out." Source: `packages/harness-manager/src/ask.ts`, header | **Amended** (S12) | Its option list omits `env`, `sandbox`, `resume`; decision 3 forbade nothing beyond LAB-138; after this issue a run can take tools | The header keeps the ask a file for its own reasons (the marker path) and says an ask tool is now possible, not built | The ask is unchanged |
| **The epic's lineage row** calls LAB-138 "an incubation lab; no retained source". Source: [FIX-1903 EVOLUTION](../../epics/FIX-1903/EVOLUTION.md), row 5 | **Corrected here, not edited there** | A retained source exists, above | The LAB-138 row | None |
| **The issue's first framing**: "the coordinator flow attaches a project's MCPs to the workers it hands work to." Source: [FIX-1905](https://linear.app/fixpoint-labs/issue/FIX-1905), as filed | **Superseded**, by the epic | A run from Inbox or the chief of staff passes no coordinator ([FIX-1903 D4](../../epics/FIX-1903/DECISIONS.md#d4)) | [BR-13](BUSINESS-RULES.md#what-a-run-reaches) | Nothing was built |
| **A repository is a remote, never a folder**: [FIX-1762 BR-5](../FIX-1762/BUSINESS-RULES.md), `repository-value.ts` | **Retained**, and mirrored | The row's second field: it names, the host resolves | [BR-2, BR-3](BUSINESS-RULES.md#what-a-project-can-say) | Rows without it read `[]` |

## The epic statements this spec now contradicts

Quoted from `main`'s `specs/epics/FIX-1903/`. Each is for the epic's amendment, not edited here.

| Where | Statement | What changes |
|---|---|---|
| `BUSINESS-RULES.md` ER-6 | "the host config gives each alias its endpoint and the environment variable that holds its credential, and the host reads it" | The host gives the endpoint; the credential is each user's stored key. The variable seeds the operator identity only |
| ER-6 | "The dev profile's host config has one alias, `linear`, whose variable is `LINEAR_MCP_API_KEY` … each person signing in to Linear as themselves is a later epic" | The variable is a seed. Each person's runs act in Linear as them, with their own pasted key; OAuth sign-in is still later |
| ER-7 | "A server whose credential variable is unset is said out loud … with `LINEAR_MCP_API_KEY` unset, the closure's leg a must FAIL its title check" | The missing thing is the requester's key; the closure's control is that key cleared, since a key set on Settings passes without the variable |
| ER-9 | "`claude-code` get[s] at most one generic option each: … per-run MCP servers" | The one option is `mcpTools`, relayed in-process tools. `tools` also gains a call path on `createMcpManager`, a package ER-9 doesn't list |
| `DECISIONS.md` D4, Locks in | "Read when a coding run starts and handed to its harness; the harness gets a per-run MCP option, a generic one" | FSD connects; the harness gets tools only |
| D4, Locks in | "the alias's endpoint and the environment variable that holds its credential are host config, and the value reaches the MCP connection only" | Endpoint in host config; credential per user in the store. The second half holds |
| D4's figure, alt text | "the price: the harness gains a per-run MCP option" | The price is FSD's connection per run and a relayed-tools option |
| Decided in review | "endpoint and credential variable are host config" · "A missing `LINEAR_MCP_API_KEY` is a degraded run, not a pass: the closure's leg a must FAIL" | As ER-6 and ER-7 above |
| `SPEC.md`, Bigger | "each person signing in to Linear as themselves" (not this epic's) | Per-person keys are in; OAuth sign-in stays out |
| `SPEC.md`, the goal's Input | "the credentials a person has in their shell" | The Linear key is set on Settings; the shell variable is the headless seed |
| `PLAN.md`, FIX-1905's row | "the host config they resolve against (ER-14), … a per-run MCP option on the Claude Code harness" · size "Medium" | Adds per-user keys and a settings page; about half again larger, still one PR |
| `DOCS.md`, shared paragraph | "Set `LINEAR_MCP_API_KEY` to a Linear API key and every coding run on either project can read and update Linear. Without it the Lab starts, says Linear is off" | Set your key on Settings; the variable is for runs with nobody at the keyboard |
| `DOCS.md`, "Tools a project's coding work gets" | "its config gives each one a name, its address, and the environment variable that holds its credential" · `credentialEnv: "LINEAR_MCP_API_KEY"` · "the agent's shell never sees it" | No variable in the example; keys per person. "Never sees it" overclaims: the key is never handed to the run, but an unsandboxed shell can read the Lab's store |

Re-check each source against `main` before S3 and S12; approved intent alone is not shipped behaviour.
