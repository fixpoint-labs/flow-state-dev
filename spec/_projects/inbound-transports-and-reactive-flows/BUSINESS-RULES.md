# Rules — Inbound Transports & Reactive Flows

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md)

What every epic under this project obeys. Each rule has exactly one owner: the epic that
implements and proves it. Every other epic inherits it.

None yet. A rule lands here when it binds two epics, and one epic is filed. FIX-2471's nine
rules (ER-1 to ER-9) stay in [its decisions](../../../specs/epics/FIX-2471/DECISIONS.md#who-owns-what);
the first epic that adds a provider or an entry point lifts the ones it inherits to here, with
FIX-2471 as their owner.

**No epic may** add an entry point that bypasses `InboundTransportAdapter` · route an outside
event with a generator, or read every event with a model to decide who hears it · add a second
messaging API or sender kind for deliveries · deliver a thread's content to a user who cannot read
it · add a third list of work that fires on its own. See [decided once](DECISIONS.md#decided-once).
