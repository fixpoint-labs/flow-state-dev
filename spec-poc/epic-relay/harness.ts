/**
 * POC CODE ON A NEVER-MERGED BRANCH (`epic/relay`, epic FIX-1197, PR #1357).
 * Throwaway. Not to be reviewed as code, never merged, dies with the PR.
 * See `spec-poc/README.md` and `spec/_epics/relay.md` §3.
 *
 * Shared shell for the two Relay questions: an in-memory engine host plus a
 * flow whose actions can be dispatched at each other.
 *
 * THE ONE HACK THAT IS ALSO THE FINDING: `HOST` below is a module-level
 * variable a block closes over. Nothing on `BlockContext` reaches
 * `host.dispatch`; `ctx.requestHost` is closed at four verbs and none takes a
 * session id. If a block could get there today there would be no epic.
 */
import { defineFlow, handler } from "@flow-state-dev/core";
import type { BlockContext } from "@flow-state-dev/core";
import { z } from "zod";
import {
  createFlowRegistry,
  createInMemoryStores,
  createInboundTransportHost,
  defaultBodyUserIdPrincipalResolver
} from "../../packages/engine/src";
import type { InboundTransportHost } from "../../packages/engine/src/transports/types";
import type { StoreRegistry } from "../../packages/engine/src/stores/types";

export const FLOW_KIND = "relay-poc";

/** The seam a block cannot reach. Set once the host exists. */
let HOST: InboundTransportHost | undefined;
export function theHostABlockCannotReach(): InboundTransportHost {
  if (HOST === undefined) throw new Error("host not wired");
  return HOST;
}

/**
 * Everything the send verb needed that a block does NOT get from `ctx`.
 * Assembled by hand so the gap is enumerable rather than asserted.
 */
export function whatCtxCouldNotSupply(ctx: BlockContext): string[] {
  const missing: string[] = [
    "host.dispatch — the seam itself; not on ctx in any form (module-level hack above)"
  ];
  if ((ctx as { flowKind?: unknown }).flowKind === undefined) {
    missing.push("flowKind — the recipient's flow; ctx does not even name our own");
  }
  missing.push("source — an InboundSource for provenance; a block has no legal value for it");
  if (ctx.requestHost === undefined) {
    missing.push("requestHost — absent on this context (and closed at 4 session-less verbs anyway)");
  }
  return missing;
}

/** Identity a block CAN read off ctx, for the BP-031 comparison. */
export function identityFromCtx(ctx: BlockContext): Record<string, unknown> {
  return {
    sessionId: ctx.session.identity.id,
    userId: ctx.session.identity.userId,
    orgId: ctx.session.identity.orgId,
    tenantId: ctx.session.identity.tenantId,
    requestId: ctx.request.identity.id
  };
}

export type SendSpec = {
  /** Session to land the new request on. */
  to: string;
  text: string;
  /** Principal to put on the envelope. The point of the experiment. */
  asUserId: string;
  /** true → await the recipient's run; false → fire and forget. */
  wait: boolean;
};

/** What `receive` saw. Read back after the run. */
export const received: Array<Record<string, unknown>> = [];

export function buildFlow(concurrency?: "queue" | "allow") {
  return defineFlow({
    kind: FLOW_KIND,
    ...(concurrency !== undefined ? { request: { concurrency } } : {}),
    actions: {
      /** Creates/touches a session so the recipient exists before anyone sends. */
      seed: {
        inputSchema: z.object({ note: z.string() }),
        block: handler<{ note: string }, { seeded: true }>({
          name: "seed",
          execute: (input, ctx) => {
            ctx.emit.message(`seed: ${input.note}`);
            return { seeded: true } as const;
          }
        })
      },

      /** The recipient side of the send verb. */
      receive: {
        inputSchema: z.object({ text: z.string(), from: z.string() }),
        block: handler<{ text: string; from: string }, { handled: true }>({
          name: "receive",
          execute: (input, ctx) => {
            received.push({ ...identityFromCtx(ctx), text: input.text, from: input.from });
            ctx.emit.message(`received from ${input.from}: ${input.text}`);
            return { handled: true } as const;
          }
        })
      },

      /** The sender side. Reaches the host it should not be able to reach. */
      send: {
        inputSchema: z.object({
          to: z.string(),
          text: z.string(),
          asUserId: z.string(),
          wait: z.boolean()
        }),
        block: handler<SendSpec, Record<string, unknown>>({
          name: "send",
          execute: async (input, ctx) => {
            const gap = whatCtxCouldNotSupply(ctx);
            const me = identityFromCtx(ctx);
            const started = Date.now();
            let handle;
            try {
              handle = theHostABlockCannotReach().dispatch({
                source: "http", // no inside-world source exists
                flowKind: FLOW_KIND, // not readable from ctx
                action: "receive",
                input: { text: input.text, from: String(me.sessionId) },
                sessionId: input.to, // the address, on the envelope that already has it
                principal: { userId: input.asUserId }, // the BP-031 surface
                responseEmitter: null
              });
            } catch (error) {
              return {
                gap,
                me,
                dispatched: false,
                threwSynchronously:
                  error instanceof Error ? `${error.name}: ${error.message}` : String(error),
                elapsedMs: Date.now() - started
              };
            }
            if (!input.wait) {
              return {
                gap,
                me,
                dispatched: true,
                mode: "fire-and-forget",
                requestId: handle.requestId
              };
            }
            try {
              const result = await handle.finished;
              return {
                gap,
                me,
                dispatched: true,
                mode: "wait",
                requestId: handle.requestId,
                recipientError: result.error?.message,
                elapsedMs: Date.now() - started
              };
            } catch (error) {
              return {
                gap,
                me,
                dispatched: true,
                mode: "wait",
                requestId: handle.requestId,
                awaitThrew:
                  error instanceof Error ? `${error.name}: ${error.message}` : String(error),
                elapsedMs: Date.now() - started
              };
            }
          }
        })
      },

      /** Reads this session's own item history through the framework's view. */
      inspect: {
        inputSchema: z.object({}),
        block: handler<Record<string, never>, { items: string[] }>({
          name: "inspect",
          execute: (_input, ctx) => ({
            items: ctx.session.items
              .all()
              .map((i) => `${i.type} :: ${JSON.stringify(i.payload).slice(0, 80)}`)
          })
        })
      }
    }
  })({ id: FLOW_KIND });
}

export function boot(concurrency?: "queue" | "allow"): {
  host: InboundTransportHost;
  stores: StoreRegistry;
} {
  const registry = createFlowRegistry();
  registry.register(buildFlow(concurrency));
  const stores = createInMemoryStores();
  const host = createInboundTransportHost({
    registry,
    stores,
    resolvePrincipal: defaultBodyUserIdPrincipalResolver,
    // Quiet: the default logger writes every block trace to stdout and buries
    // the report. Warnings and errors still surface.
    runtimeConfig: {
      logger: {
        warn: (m, c) => console.warn("[warn]", m, c),
        error: (m, c) => console.error("[error]", m, c)
      }
    }
  });
  HOST = host;
  return { host, stores };
}

/** Dispatch from OUTSIDE — what an HTTP request does today — and await the run. */
export async function fromOutside(
  host: InboundTransportHost,
  action: string,
  input: unknown,
  sessionId: string,
  userId: string
) {
  const handle = host.dispatch({
    source: "http",
    flowKind: FLOW_KIND,
    action,
    input,
    sessionId,
    principal: { userId },
    responseEmitter: null
  });
  return { requestId: handle.requestId, result: await handle.finished };
}

export function show(label: string, value: unknown): void {
  console.log(`\n--- ${label} ---`);
  console.log(JSON.stringify(value, null, 2));
}
