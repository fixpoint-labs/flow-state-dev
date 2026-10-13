# FIX-1927 · Evolution

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md) · **Evolution**

| Prior intent and precise source | Treatment | Why / evidence | Replacement | Compatibility |
|---|---|---|---|---|
| A mapped run with no `baseRef` is cut from the checkout's `HEAD`, "Nothing is fetched"; [FIX-1906 BR-9](../FIX-1906/BUSINESS-RULES.md#the-place-and-the-branch), and its *Decided, not asked* line "Absent means `HEAD` … with no fetch" ([FIX-1906 DECISIONS](../FIX-1906/DECISIONS.md#decided-not-asked)) | **Amended**: still cut from `HEAD`'s branch; its upstream is now fetched for a new branch | Without a fetch the run starts from whatever was last pulled, and the shipped docs tell people to pull by hand | [D1](DECISIONS.md#d1); BR-1 to BR-6 | A `HEAD` with no upstream behaves as before (BR-6) |
| "Never fetch, reset, switch or clean the operator's checkout"; [FIX-1906 PLAN → Guardrails](../FIX-1906/PLAN.md#guardrails) | **Amended** for *fetch* only; reset, switch and clean are retained, and no local branch moves | A fetch of one upstream branch changes only its remote-tracking ref, which holds no unpushed work (BR-9) | BR-9; [PLAN → Guardrails](PLAN.md#guardrails) | The person's branches, index and files are untouched, as before |
| "A run branches from local `main`, never fetched", in the *Locks in* of [FIX-1904 D3](../FIX-1904/DECISIONS.md#d3) | **Superseded in part**: the fetch is added. The rest of D3 is retained: the profile allows no remote, and a missed run is refused by name, never cloned | The allowlist rule would leave the Lab stale forever; listing the checkout admits only its own upstream | [D3](DECISIONS.md#d3); BR-15, BR-16 | The Lab's config is unchanged. A project a person adds is still refused (BR-16) |
| An app passing a fixed `sourceRepo` behaves as before; [FIX-1762 BR-22](../FIX-1762/BUSINESS-RULES.md#a-project-with-a-repository) | **Amended**: same path, so it fetches its base's upstream too | One host path for both entry points ([tenet 5](../../../docs/philosophy.md#5-fix-at-the-owning-layer)) | BR-19 | A `sourceRepo` with no upstream, as in every harness-manager test, is unchanged |
| A retry gets the same checkout, with no fetch, rebase or reset; [FIX-1762 BR-18](../FIX-1762/BUSINESS-RULES.md#a-project-with-a-repository), and the host's rule "Existing work is never discarded" (`packages/workspace/src/local-host.ts` header) | **Retained** | The fetch sits only where a new branch's base is chosen | BR-17 | Unchanged |

Before implementing, compare these against `packages/workspace/src/local-host.ts` and
`packages/harness-manager/src/workspace.ts` on the commit you build on: approved intent is not
shipped behaviour.
