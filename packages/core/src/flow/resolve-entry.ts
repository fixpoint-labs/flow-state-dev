/**
 * The one keyed lookup every arrival resolves through.
 *
 * A flow holds one entry map per dispatch type. This function is the whole of
 * addressing: given the type a dispatch arrived as and the name (or protocol
 * coordinate) it carries, read that type's map and return the entry — or
 * `undefined`, which every caller turns into a refusal that names the type.
 *
 * **No fallback, for any type.** An earlier shape let an event whose
 * coordinate did not match fall through to `flow.actions[name]`, and made the
 * detached source the one terminal exception. The exception was the rule: a
 * dispatch's name is provenance for every type but `public`, and a fall-through
 * hands a framework-stamped dispatch a caller-addressed handler whose key
 * happens to collide. Now every branch is terminal, and the security property
 * the detached branch used to carry alone — a dispatch cannot reach a handler
 * outside its own type's map — holds for all six.
 *
 * The source-to-type mapping is the engine's (`transport-sources.ts`): a
 * dispatch's type is decided by which door it came through, never by anything
 * in its body, which is what makes the map a caller cannot pick a boundary.
 */
import type { DispatchType } from "../types/dispatch";

/**
 * The protocol coordinate a `chat`, `webhook` or `schedule` dispatch carries.
 * Stamped by the adapter into the namespaced metadata slot the engine reads it
 * back from; absent for the three types whose name is the whole address.
 */
export type EntryCoordinate = {
  readonly chat?: { readonly eventKey?: string };
  readonly webhook?: { readonly provider?: string; readonly eventType?: string | null };
  readonly schedule?: { readonly scheduleId?: string };
};

/**
 * The six maps, generic over the entry value so a narrowed view (the
 * concurrency arbiter reads only `concurrency`) resolves through the same
 * function as a full `FlowInstance`.
 */
export type EntryMaps<TEntry> = {
  readonly actions: Record<string, TEntry>;
  readonly internal?: Record<string, TEntry>;
  readonly tasks?: Record<string, TEntry>;
  readonly chat?: { readonly on?: Record<string, TEntry> };
  readonly webhooks?: Record<string, { readonly on?: Record<string, TEntry> } | undefined>;
  readonly schedules?: { readonly static?: Record<string, TEntry> };
};

/**
 * Own-property lookup, so a name that spells an inherited member
 * (`"constructor"`, `"__proto__"`) resolves nothing rather than a function
 * off `Object.prototype`. Names arrive from callers and from models.
 */
function ownEntry<T>(map: Record<string, T> | undefined, name: string): T | undefined {
  if (map === undefined) return undefined;
  return Object.hasOwn(map, name) ? map[name] : undefined;
}

/**
 * Resolve the entry a dispatch is addressed to, or `undefined` when its type's
 * map declares none. Never consults another type's map.
 */
export function resolveEntry<TEntry>(
  flow: EntryMaps<TEntry>,
  type: DispatchType,
  name: string,
  coordinate?: EntryCoordinate
): TEntry | undefined {
  switch (type) {
    case "public":
      return ownEntry(flow.actions, name);
    case "internal":
      return ownEntry(flow.internal, name);
    case "task":
      return ownEntry(flow.tasks, name);
    case "chat": {
      const eventKey = coordinate?.chat?.eventKey;
      return typeof eventKey === "string" ? ownEntry(flow.chat?.on, eventKey) : undefined;
    }
    case "webhook": {
      const webhook = coordinate?.webhook;
      if (typeof webhook?.provider !== "string" || typeof webhook.eventType !== "string") {
        return undefined;
      }
      return ownEntry(ownEntry(flow.webhooks, webhook.provider)?.on, webhook.eventType);
    }
    case "schedule": {
      const scheduleId = coordinate?.schedule?.scheduleId;
      return typeof scheduleId === "string"
        ? ownEntry(flow.schedules?.static, scheduleId)
        : undefined;
    }
  }
}
