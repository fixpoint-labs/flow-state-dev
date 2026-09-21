/**
 * The app's catalog as a seat's tool source — the primary recipe FIX-1416
 * wires: a block under `workforce/blocks/`, handed to the kind as `catalog:`,
 * named by a seat's `tools:`.
 *
 * Two rules are pinned here and both were found by a POC rather than by
 * reading:
 *
 * - **One tool has one name.** The map key and the block's own `name` must
 *   agree, refused when the KIND is built — before any seat exists — because
 *   the catalog is a kind-construction argument. A seat authorizes by key and
 *   the model is advertised the block's `name`, so two spellings means a seat
 *   authorizing one tool and a model calling another.
 * - **A catalog tool's declared stores are installed on the kind.** A seat
 *   reaches its tools through a resolver that runs per turn, so a block
 *   arriving that way is outside `defineFlow`'s static walk over action blocks.
 *   Left alone, the tool is hired, advertised, called — and its handle is not
 *   there, while the turn reports success.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineCapability, handler } from "@flow-state-dev/core";
import { defineResource } from "@flow-state-dev/core/types";
import type { FlowInstance } from "@flow-state-dev/core/types";
import { createTestContext, mockGenerator } from "@flow-state-dev/testing";
import { executeBlock } from "@flow-state-dev/engine";
import { hireWorkforce, type HireOptions } from "../src/hire";
import type { WorkerManifest } from "../src/manifest";
import { AGENT_KIND, defineAgentWorkerFlow } from "../src/agent-worker-flow";

function record(over: Partial<WorkerManifest> & { id: string }): WorkerManifest {
  return { declared: {}, body: "", ...over };
}

function hire(manifests: WorkerManifest[], kinds: HireOptions["kinds"]): FlowInstance[] {
  return hireWorkforce(manifests, { kinds });
}

/** A model script that "calls" a tool by name. */
const callTool = (toolName: string) => ({
  toolCalls: [{ toolCallId: "call-1", toolName, args: {} }],
});

async function runSeat(seat: FlowInstance, toolName: string) {
  const runtime = await createTestContext({
    flow: { ...seat, cardinality: "singleton" },
    orgId: "test-org",
    org: { state: {} },
    sessionId: "test-session",
    sequencerName: seat.actions.run!.block.name,
    declaredResources: seat.actions.run!.block.declaredResources,
    generators: {
      "agent-answer": mockGenerator({
        name: "agent-answer",
        script: [callTool(toolName), { text: "done" }] as never,
      }),
    },
  });
  return executeBlock({
    block: seat.actions.run!.block,
    input: { message: "use your tools" },
    ctx: runtime.ctx,
  });
}

describe("one tool, one name — the app's catalog", () => {
  const mismatched = handler({
    name: "lookupCustomer",
    description: "Looks a customer up.",
    inputSchema: z.object({}),
    outputSchema: z.object({ found: z.boolean() }),
    execute: () => ({ found: true }),
  });

  it("refuses a catalog key that disagrees with its block's own name, when the kind is built", () => {
    expect(() => defineAgentWorkerFlow({ catalog: { "lookup-customer": mismatched } })).toThrow(
      /lookup-customer/,
    );
  });

  // The refusal has to say which of the two the model would have been
  // advertised, because that is the half an author cannot see.
  it("names both spellings, and says which one the model would have seen", () => {
    let message = "";
    try {
      defineAgentWorkerFlow({ catalog: { "lookup-customer": mismatched } });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain("lookupCustomer");
    expect(message).toContain("lookup-customer");
  });

  // The other half of the rule, and the one that makes the check falsifiable:
  // agreement must NOT refuse. Without this the guard could be a bare `throw`.
  it("does not refuse when the key and the block's name agree", () => {
    const agreeing = handler({
      name: "desk-note",
      description: "Answers a note.",
      inputSchema: z.object({}),
      outputSchema: z.object({ ok: z.boolean() }),
      execute: () => ({ ok: true }),
    });
    expect(() => defineAgentWorkerFlow({ catalog: { "desk-note": agreeing } })).not.toThrow();
  });

  // A kind built with no catalog at all must not acquire a refusal.
  it("builds with no catalog", () => {
    expect(() => defineAgentWorkerFlow()).not.toThrow();
  });
});

describe("a catalog tool's declared stores are installed on the kind", () => {
  const auditLog = defineResource({
    scope: "session",
    stateSchema: z.object({ lines: z.number() }),
  });

  /** Declares its store through a capability, which is the shape an app writes. */
  function writeAudit(seen: { outcome: string }) {
    return handler({
      name: "write-audit",
      description: "Appends to the audit log.",
      uses: [defineCapability({ name: "audit", resources: { auditLog } })],
      inputSchema: z.object({}),
      outputSchema: z.object({ ok: z.boolean() }),
      execute: async (_input, ctx) => {
        try {
          // A real tool does not optional-chain its own declared resource, and
          // it WRITES: a read of an empty store is indistinguishable from a
          // store that is not wired to anything.
          const res = (
            ctx as { resources: Record<string, { patchState: (u: object) => Promise<void> }> }
          ).resources.auditLog;
          await res.patchState({ lines: 1 });
          seen.outcome = "handle worked";
        } catch (error) {
          seen.outcome = `threw: ${error instanceof Error ? error.message : String(error)}`;
        }
        return { ok: true };
      },
    });
  }

  it("declares the store on the flow, so the handle is there when the model calls the tool", async () => {
    const seen = { outcome: "never ran" };
    const kind = defineAgentWorkerFlow({ catalog: { "write-audit": writeAudit(seen) } });
    const [seat] = hire([record({ id: "support.auditor", declared: { tools: ["write-audit"] } })], {
      [AGENT_KIND]: kind,
    });

    // The static half: the action block the flow walks now carries the
    // declaration. Before the registration this was `undefined` — the tool was
    // advertised to the model with nothing behind it.
    expect(seat!.actions.run!.block.declaredResources?.auditLog).toBe(auditLog);

    // The runtime half, which is the one that matters: the tool ran and its
    // store answered. The turn reporting success proves nothing on its own —
    // it reported success in the broken state too, with the block throwing
    // inside itself — so the outcome the block recorded is what is asserted.
    const result = await runSeat(seat!, "write-audit");
    expect(result.error).toBeUndefined();
    expect(seen.outcome).toBe("handle worked");
  });

  // Kind-wide, not per seat: the catalog belongs to the kind, so its stores
  // belong to every seat of it — the same bill `uses` already presents.
  it("installs the store for a seat whose `tools:` never names the block", () => {
    const seen = { outcome: "never ran" };
    const kind = defineAgentWorkerFlow({ catalog: { "write-audit": writeAudit(seen) } });
    const [seat] = hire([record({ id: "support.ghost" })], { [AGENT_KIND]: kind });

    expect(Object.keys((seat as unknown as { resources?: object }).resources ?? {})).toContain(
      "auditLog",
    );
  });

  // The store reaches the flow's own resource map, which is what an engine
  // installs from — not only the block's declaration.
  it("merges the declaration into the flow's resources", () => {
    const seen = { outcome: "never ran" };
    const kind = defineAgentWorkerFlow({
      catalog: { "write-audit": writeAudit(seen) },
    }) as unknown as { resources?: Record<string, unknown> };

    expect(Object.keys(kind.resources ?? {})).toContain("auditLog");
  });

  // A kind whose catalog declares nothing must not gain a resource map it did
  // not have — the registration has to be the union, not a rewrite.
  it("leaves a resource-free catalog's kind exactly as it was", () => {
    const plain = handler({
      name: "desk-note",
      description: "Answers a note.",
      inputSchema: z.object({}),
      outputSchema: z.object({ ok: z.boolean() }),
      execute: () => ({ ok: true }),
    });
    const withCatalog = defineAgentWorkerFlow({ catalog: { "desk-note": plain } }) as unknown as {
      resources?: Record<string, unknown>;
    };
    const without = defineAgentWorkerFlow() as unknown as { resources?: Record<string, unknown> };

    expect(Object.keys(withCatalog.resources ?? {}).sort()).toEqual(
      Object.keys(without.resources ?? {}).sort(),
    );
  });
});
