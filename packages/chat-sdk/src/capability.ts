/**
 * `chatCapability` — exposes the live chat thread to flow code.
 *
 * The adapter records each in-flight request's `Thread` and `Message`
 * in a per-request registry; this capability surfaces them through a
 * stable set of methods on `ctx.cap.chat`. Methods re-read the registry
 * on every call (entries are cleared when the request finishes; reading
 * after finish returns `null`).
 *
 * Two presets are off by default:
 *   - `threadContext` — adds a system-prompt formatter that injects
 *     platform/thread/user identity into a generator's context.
 *
 * `default: []` ensures `uses: [chatCapability]` adds the methods only.
 * Consumers opt into the formatter via
 * `uses: [chatCapability.with({ threadContext: true })]`.
 */
import { defineCapability } from "@flow-state-dev/core";
import type { Thread, Message } from "chat";
import {
  getMessageForRequest,
  getThreadForRequest,
} from "./thread-registry";

export const chatCapability = defineCapability({
  name: "chat",
  fns: (ctx) => ({
    getThread: (): Thread | null => getThreadForRequest(ctx.request.identity.id),
    getMessage: (): Message | null => getMessageForRequest(ctx.request.identity.id),
    getPlatform: (): string | null => {
      const t = getThreadForRequest(ctx.request.identity.id);
      return t?.adapter.name ?? null;
    },
    getUserId: (): string | null => {
      const m = getMessageForRequest(ctx.request.identity.id);
      return m?.author?.userId ?? null;
    },
    isDM: (): boolean => getThreadForRequest(ctx.request.identity.id)?.isDM ?? false,
    getParticipants: async () => {
      const t = getThreadForRequest(ctx.request.identity.id);
      return t === null ? [] : t.getParticipants();
    },
    setThreadState: async (
      partial: Record<string, unknown>,
      opts?: { replace?: boolean }
    ): Promise<void> => {
      const t = getThreadForRequest(ctx.request.identity.id);
      if (t === null) return;
      await t.setState(partial, opts);
    },
  }),
  presets: {
    threadContext: {
      context: [
        (_input: unknown, ctx) => {
          const t = getThreadForRequest(ctx.request.identity.id);
          const m = getMessageForRequest(ctx.request.identity.id);
          if (t === null) return "";
          const parts: string[] = [
            `Platform: ${t.adapter.name}`,
            `Thread: ${t.id}`,
            `Direct message: ${t.isDM ? "yes" : "no"}`,
          ];
          if (m?.author?.userId !== undefined) {
            parts.push(`From user: ${m.author.userId}`);
          }
          return parts.join("\n");
        },
      ],
    },
    default: [],
  },
});
