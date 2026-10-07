# FIX-1802 · Evolution

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md) · **Evolution**

| Prior intent and precise source | Treatment | Why / evidence | Replacement | Compatibility |
|---|---|---|---|---|
| FIX-1794's split: [S8](../FIX-1794/PLAN.md#surfaces), [S10](../FIX-1794/PLAN.md#surfaces), [BR-7, BR-30 to BR-32](../FIX-1794/BUSINESS-RULES.md#the-chain), [V6](../FIX-1794/PLAN.md#checks), goal leg b, carried here by its [Q](../FIX-1794/DECISIONS.md#q) | **Retained** as written, with both review fixes: the server-written parent binding (round 1) and the settle-owed marker (round 2, [#2828](https://github.com/fixpoint-labs/flow-state-dev/pull/2828)) | The POC shows today's board settles a parked row in a later request through a stored ticket (P2, P3) | S4, BR-14 to BR-18, V3; goal leg a | Nothing shipped from it |
| FIX-1794's [D2](../FIX-1794/DECISIONS.md#d2): five boards deep, and each board's own caps as the breadth bound | Depth **retained**, fixed; breadth **amended**: a count per chain, 100 by default and raised by the app, is added beside the board caps | FIX-1794's own review asked for a fan-out bound; per-board caps allow 11,110 tasks under one top task at ten a board | [D2](DECISIONS.md#d2), BR-20 to BR-22 | The board caps stay as FIX-1794 sets them |
| FIX-1794 *decided, not asked*: "a worker that splits its task is a coordinator"; [S4](../FIX-1794/PLAN.md#surfaces): filing on coordinator conversations, a task session refused | **Superseded** | The product owner, 2026-10-06 ([epic D8](../../epics/FIX-1786/DECISIONS.md#d8)) | [D1](DECISIONS.md#d1); S2, S6 swap the interim answer for the delegate rule | None: nothing shipped. FIX-1794, amended on this PR, ships the board per session and wires Orchestration's eight task tools to it; only its answer to "may this session file?" is interim |
| FIX-1791's delegates as the coordinator's: the `delegates` key ([S1](../FIX-1791/PLAN.md#surfaces)), [BR-1a](../FIX-1791/BUSINESS-RULES.md#delegates) (actions only on a coordinator), [BR-4](../FIX-1791/BUSINESS-RULES.md#delegates) (a delegate's flow must take a post), `coordinatorSessionId` | The records, the copy on first read and the one check **retained**; BR-1a, BR-4 and the key's name **amended**, marked in FIX-1791's spec; FIX-1791 ships the key as `filingSessionId` (renamed from `coordinatorSessionId`; never shipped) | One list for who works for a worker (D1); the EM's `coder` takes tasks, not posts | S2, S3; BR-4, BR-7, BR-9 | None: nothing shipped |
| FIX-1789's contract: `workerConfigSchema()` "with its six keys" ([SPEC](../FIX-1789/SPEC.md#what-stays-as-it-is)) | **Amended**, marked in FIX-1789's spec: it gains `delegates` | D1: a key in the contract reaches every flow | S2 | None: nothing shipped |
| The epic's [D2](../../epics/FIX-1786/DECISIONS.md#d2): "a board is session state any worker flow may keep" | **Retained**, and now the rule: the board is the filing worker's session's | — | BR-11 | n/a |

The epic's D8 is this issue's charter, not a predecessor. FIX-1789's, FIX-1791's and FIX-1794's
merged specs each carry a matching post-merge note in their EVOLUTION.md, amended on this PR. Before
implementation, compare these intents with `main`: none of FIX-1788, FIX-1791 or FIX-1794 has
shipped as this is written.

<a name="amendment-cross-spec"></a>
## Amended after merge (cross-spec alignment, 2026-10-07)

**The alignment.** Reading the epic's merged child specs against each other found places where
siblings read two ways. Each was an engineering call, made under decisions already taken, and
recorded in the epic's [How it got here](../../epics/FIX-1786/DECISIONS.md#how-it-got-here). This
spec changed:

| What | Treatment | Why | What is retained |
|---|---|---|---|
| S2, BR-1, BR-2, BR-5, the sketch, D1's *Locks in* and *decided, not asked*: the grant read from the file's `delegates:` | **Amended**: read per call from the session's current delegates, the list the assignee check reads | Delegates change per conversation (FIX-1791), and the roster is read per call (FIX-1794 T1); D1's own reason, one list with nothing beside it to disagree | No flag; the file's list is where each session starts |
| S3 and the failure taxonomy: nothing refused at load | **Amended**: FIX-1791 BR-11's refusal reaches every standard worker with `delegates:` (new BR-10a), and delegate state is server-only on every flow that carries it | FIX-1791 BR-11 and epic ER-6 refuse a standard coordinator naming a non-standard delegate | Nothing about the grant refuses a file |
| BR-6: a delegate list on a session create is ignored, or refused | **Amended**: refused with a 400 naming the field | FIX-1791 BR-8 and FIX-1797's sweep require it | Action and tool input as FIX-1794 BR-8 |
