# FIX-1332 — Workforce foundation L2

## 1. Purpose & objective *(the gated sign-off surface)*

**Objective.** Make a multi-seat workforce an ordinary FSD application shape: an author
adds convention-based definitions, the setup layer discovers them into the existing
registries, and each roster seat resolves to one configured flow instance that can run as
an honest Agent. Today the primitives exist, but every application still has to invent the
scan-to-registry and seat-to-worker wiring that joins them.

**Holistic necessity.** The minimum useful set has three responsibilities. The convention
loader removes repeated setup code. The seat factory gives a roster entry one exact flow
instance and its create-time configuration. Agent materialization must preserve the Agent
contract on every worker path, or the factory produces workers that silently differ from
their declarations. Team collaboration, a message board, and cross-flow coordination do
not help establish that spine and are deliberately outside this epic.

This epic serves **Project Objective 1, validate through real usage**, by making a real
multi-seat Workforce application possible without bespoke registration code. It also
serves **Objective 4, keep the foundation honest**, by refusing unsupported Agent features
rather than dropping them during materialization.

**Proof.** A fixture workforce made only of conventional files can be scanned, registered,
and used to mint at least two differently configured seats from one collection flow
definition. Each seat resolves by its exact flow id, reads its own immutable instance
configuration, and materializes a worker whose supported Agent contract matches what was
declared. The proof must exercise the assembled path, not only the loader, registry, and
factory separately.

**Not doing:** Team, Channel, or MessageBoard primitives; a second registry; hot addition of
new flow kinds after startup; cross-flow collaboration; chat transport; mutable hire
configuration; or rebuilding an action tree per hire. Those are either later product
layers or contradictions of the instance/config foundation this epic is meant to use.

## 2. Themes & long-horizon direction

1. **Files populate programmatic registries; they do not create a parallel runtime.** The
   convention layer scans authored definitions and feeds the existing Agent, capability,
   skill, and flow registration seams. Programmatic registration remains the escape hatch.
   If the implementation needs a second source of truth to answer what Agents or flows
   exist, the layer has grown past its purpose.

2. **A seat binds a worker by exact flow-instance id.** A roster seat is configuration and
   identity, not a new execution primitive. The seat factory resolves one already-defined
   collection flow, creates an instance with the seat's stable id and immutable config bag,
   and registers that instance through the canonical flow registry. There is no
   first-registered fallback and no kind-only address for collection instances.

3. **One definition, many configured seats.** Harness, model, and persona references are
   instance configuration when they vary without changing the block graph. Learned or
   mutable member data remains instance-isolated state/resources. A difference that changes
   the action tree is a different flow kind, not another config key.

4. **Agent remains a thin declaration on the existing seam.** This epic deepens
   `defineAgent` / `createAgentRegistry` / `materializeAgent`; it does not introduce a second
   Agent type or promote Team/Channel concepts into Layer 1. Every materialization path must
   either honor declared structured output, tools, capabilities, persona, and model, or
   refuse the unsupported combination with an error the author can act on. Silent downgrade
   is never a compatibility strategy.

5. **There is one harness-manager stack.** OpenAI-compatible, Cursor, or other coding
   harnesses are seat configuration behind the same factory and worker boundary. This epic
   does not build another Conductor-shaped orchestration product, an Agent inbox, or a
   management bus.

6. **Sequence the truth-bearing seams before the convenience layer.** Flow-instance
   identity/isolation and create-time config are the floor and have landed. Agent
   materialization honesty comes next; the seat factory may be specified alongside it but
   cannot claim completion against a worker that drops its declaration. The convention
   loader lands against the stable registry/factory contract. The assembled multi-seat goal
   is the completion gate.

## 4. Running index

| Issue | What it contributes | Route | Spec PR | Impl PR | State |
|---|---|---|---|---|---|
| [FIX-1325](https://linear.app/fixpoint-labs/issue/FIX-1325) | Hire/mint collection-flow instances as seats | spec | — | — | Backlog |
| [FIX-1327](https://linear.app/fixpoint-labs/issue/FIX-1327) | Make skill/worker Agent materialization honor or loudly refuse its declaration | spec | — | — | Backlog |
| [FIX-1310](https://linear.app/fixpoint-labs/issue/FIX-1310) | File convention and roster consumer | spec | — | — | Scope alignment required |

The epic also depends on the completed flow-instance floor
([FIX-1320](https://linear.app/fixpoint-labs/issue/FIX-1320)) and create-time config bag
([FIX-1331](https://linear.app/fixpoint-labs/issue/FIX-1331)). They are prerequisites, not
work owned by this epic. [FIX-1311](https://linear.app/fixpoint-labs/issue/FIX-1311)
(message board) and [FIX-1330](https://linear.app/fixpoint-labs/issue/FIX-1330) (chat
transport removal) remain related work, not children.

## 5. Open cross-cutting questions

- **Should FIX-1310 be narrowed into this epic's roster convention, or remain related while
  a smaller convention-loader issue is filed?** FIX-1310 currently describes Team semantics
  in addition to the file/roster convention, while FIX-1332 explicitly excludes Team growth.
  In plain terms, the choice is whether to reuse the existing ticket after cutting it to the
  foundation this epic needs, or preserve its broader promise and create a smaller child.
  **Recommendation:** preserve FIX-1310 as the later Team-level consumer and file a focused
  convention-loader child; that keeps this epic from quietly shipping a partial Team under a
  foundation label. What would change this recommendation is confirmation that no external
  promise relies on FIX-1310's current Team scope. Being wrong either duplicates the loader
  work across two issues or makes this epic absorb collaboration semantics it explicitly
  excludes. This blocks finalizing the child set, not agreement on the objective.

## Epic evolution

- **Epic drafted** — reduced Workforce foundation L2 to one convention-to-registry path,
  one seat-to-flow-instance factory, and honest Agent materialization; kept Team,
  MessageBoard, chat, and collaboration outside the set.
