# Language

Shared vocabulary for every suggestion this skill makes. Use these terms exactly — don't substitute "component," "service," "API," or "boundary." Consistent language is the whole point.

## Terms

**Module**
Anything with an interface and an implementation. Deliberately scale-agnostic — applies equally to a function, class, package, or tier-spanning slice.
_Avoid_: unit, component, service.

**Interface**
Everything a caller must know to use the module correctly. Includes the type signature, but also invariants, ordering constraints, error modes, required configuration, and performance characteristics.
_Avoid_: API, signature (too narrow — those refer only to the type-level surface).

**Implementation**
What's inside a module — its body of code. Distinct from **Adapter**: a thing can be a small adapter with a large implementation (a Postgres repo) or a large adapter with a small implementation (an in-memory fake). Reach for "adapter" when the seam is the topic; "implementation" otherwise.

**Depth**
Leverage at the interface — the amount of behaviour a caller (or test) can exercise per unit of interface they have to learn. A module is **deep** when a large amount of behaviour sits behind a small interface. A module is **shallow** when the interface is nearly as complex as the implementation.

**Seam** _(from Michael Feathers)_
A place where you can alter behaviour without editing in that place. The *location* at which a module's interface lives. Choosing where to put the seam is its own design decision, distinct from what goes behind it.
_Avoid_: boundary (overloaded with DDD's bounded context).

**Adapter**
A concrete thing that satisfies an interface at a seam. Describes *role* (what slot it fills), not substance (what's inside).

**Leverage**
What callers get from depth. More capability per unit of interface they have to learn. One implementation pays back across N call sites and M tests.

**Locality**
What maintainers get from depth. Change, bugs, knowledge, and verification concentrate at one place rather than spreading across callers. Fix once, fixed everywhere.

## Principles

- **Depth is a property of the interface, not the implementation.** A deep module can be internally composed of small, mockable, swappable parts — they just aren't part of the interface. A module can have **internal seams** (private to its implementation, used by its own tests) as well as the **external seam** at its interface.
- **The deletion test.** Imagine deleting the module. If complexity vanishes, the module wasn't hiding anything (it was a pass-through). If complexity reappears across N callers, the module was earning its keep.
- **The interface is the test surface.** Callers and tests cross the same seam. If you want to test *past* the interface, the module is probably the wrong shape.
- **One adapter means a hypothetical seam. Two adapters means a real one.** Don't introduce a seam unless something actually varies across it.

## Relationships

- A **Module** has exactly one **Interface** (the surface it presents to callers and tests).
- **Depth** is a property of a **Module**, measured against its **Interface**.
- A **Seam** is where a **Module**'s **Interface** lives.
- An **Adapter** sits at a **Seam** and satisfies the **Interface**.
- **Depth** produces **Leverage** for callers and **Locality** for maintainers.

## Rejected framings

- **Depth as ratio of implementation-lines to interface-lines** (Ousterhout): rewards padding the implementation. We use depth-as-leverage instead.
- **"Interface" as the TypeScript `interface` keyword or a class's public methods**: too narrow — interface here includes every fact a caller must know.
- **"Boundary"**: overloaded with DDD's bounded context. Say **seam** or **interface**.

## FSD vocabulary mapping

The architectural overlay above coexists with FSD's primary domain vocabulary. When suggesting refactors, name things by what they are in FSD-land first, and use the overlay terms to explain the architectural shape.

### Native concepts → overlay analogues

| FSD concept | Acts as | Interface includes |
|---|---|---|
| **block** (handler / generator / sequencer / router) | a **module** | `name`, `inputSchema`, `outputSchema`, contract behavior, `retry`, `rescue`, `emit` flags, lifecycle hooks (`onStarted`/`onCompleted`/`onErrored`/`onFinished`) — *and* any state/resource invariants the block relies on. The `execute` body is the **implementation**. |
| **generator** | a **deep module** by construction | The model-loop contract — `prompt`, `context`, `history`, `user`, `tools`, `maxIterations`, output emission flags. The provider plumbing (Vercel AI SDK) sits behind the seam. |
| **sequencer** | a **module** composed of other modules | The chain's input → output transformation + its rescue/retry semantics. Internal `.then()` steps are **internal seams**; the sequencer's own `inputSchema`/`outputSchema` is the **external seam**. Don't expose intermediate step shapes through the external interface. |
| **router** | a **module** with dynamic dispatch | The set of named routes + the selection contract. |
| **pattern** | a **deep module factory** | The factory's input config (often takes `uses`, `tools`, model overrides) → the produced sequencer's interface. Patterns are FSD's primary unit of architectural leverage. |
| **capability** (`defineCapability`) | a **deep module of resource + context + tool wiring** | The tiny `uses: [cap]` (or `uses: [(ctx) => [cap]]`) surface vs. a potentially large bundle of resources/context formatters/tools behind it. Capabilities are the textbook example of high depth — small interface, high leverage across many blocks. |
| **store adapter** | a literal **adapter** at a real seam | `StoreRegistry` interface (sessions / state / resources / etc.). Two adapters today (`@flow-state-dev/store-sqlite` + in-memory) = real seam, not hypothetical. |
| **flow** | the **top-level module** | Actions + scope schemas + resources + capabilities. The flow's `actions` map is its external interface to callers (`fsdev run`, server routes, client). |
| **action** | an **entry point on a flow** | `inputSchema`, the root block it dispatches to, side-effects on declared scopes. |
| **scope** (request / session / user / project) | a **lifetime contract**, not a module | Not a module itself, but determines how a module's state mutations propagate. |
| **item** (message / reasoning / block_output / component / etc.) | the **wire format** at the streaming seam | Item types are part of the streaming contract documented in `docs/architecture/items.md` and `docs/architecture/streaming.md`. Changing the item taxonomy is a cross-cutting change that ripples through server, client, react, and all renderers. |
| **provider** (e.g. Vercel AI SDK) | a **true-external dependency** behind a seam | Currently single-provider in Phase 1; the seam exists for future providers. |

### Practical rules for suggestions

- A "block" stays a block in suggestions — don't rename it "the X module." Say "the X handler" / "the X generator" and add the architectural framing alongside ("…which is currently a shallow module whose interface is nearly as complex as its body").
- A capability is the FSD answer to "I keep plumbing the same tools + context + resources into many blocks." When suggesting one, frame it explicitly: "Extract a capability — this is FSD's mechanism for collapsing repeated wiring into a deep module."
- The boundary between `@flow-state-dev/server` and `@flow-state-dev/client` is a *real* seam (server must never depend on client/react per package-boundary rules). Don't propose refactors that would cross it.
- The boundary between `@flow-state-dev/client` and `@flow-state-dev/react` is a *real* seam (react wraps client; no transport logic in react). Same rule.