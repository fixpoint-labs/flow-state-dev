# kits › memory installs as a kit

**Issue:** FIX-2816
**Outcome:** An app installs memory with one kit config. A plain flow supplied through the kit's flow-builder slot can use working, episodic, semantic, and digest memory without Workforce. Working state stays with its session; user-scoped state follows a user across sessions; org-scoped state is shared inside one org and isolated from another. Concurrent compare-and-swap updates preserve both writers.
**Input:** Two model-free apps built by `run.mts`: one installs user-scoped memory and one installs org-scoped memory. Their plain flows are returned from `memory.slots.flows`, carry the installed resources, and put the installed capability in `uses`. Actions call capability helpers directly; no provider is invoked.
**Signal:** The running user-scoped app writes and reads working, episodic, and semantic memory, then reads from another session. The running org-scoped app reads the same memory as another user in the org and sees none in another org. Two actions update one semantic fact concurrently and its provenance contains both writes. The installed system also exposes digest and the janitor configured by the app.
**Anti-game:** Assertions use flows registered by `createFlowState` and actions executed by `runAction`, never the kit factory return. Every graded collection is floored with `tell.over`. The scope checks use different session, user, and org identities. The concurrency check updates one stored fact from two requests, rather than checking two unrelated keys.
**Model:** n/a (capability helpers only)
**Run:** `pnpm tsx goals/kits/memory-installs-as-a-kit/run.mts`
**Controls:** `GOAL_CONTROL=without-flow` removes the app's flow-slot contribution before startup. The goal must fail because no memory-backed flow is installed.
