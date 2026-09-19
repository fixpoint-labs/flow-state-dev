/**
 * One turn of one seat, on the real path.
 *
 * Every probe observes through this function, and it does no simulating: it
 * loads a tree with the shipped loader, hires with the shipped
 * `hireWorkforce`, executes the seat's own action block with the shipped
 * engine, and records what the MODEL was handed — the tool list and the
 * messages.
 *
 * Observing at the model is deliberate and is the round-1 lesson from
 * `check-conventions.mjs`: a resolver result, a config key or an identifier in
 * a file are all neighbours of the claim. "Can this seat call that tool" is a
 * statement about the tool list the provider receives, so that is what is read.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createTestContext } from "@flow-state-dev/testing";
import { executeBlock } from "@flow-state-dev/engine";
import type { FlowInstance, GeneratorModel, ModelResolver } from "@flow-state-dev/core/types";

/** One model for every lookup, plus the `resolveId` the resolver type carries. */
function resolverFor(model: GeneratorModel): ModelResolver {
  const resolve = (() => model) as unknown as ModelResolver;
  resolve.resolveId = (modelId: string) => modelId;
  return resolve;
}

/** What one turn revealed. */
export interface Turn {
  /** Tool names the provider was offered, in order. */
  toolsOffered: string[];
  /** Every message the provider received, flattened to one searchable string. */
  promptText: string;
  /**
   * `true` when the BLOCK ran — read off the marker file the authored block
   * appends to, not off the fact that a call was scripted. Offering a tool and
   * running it are a tool call apart.
   */
  toolRan: boolean;
  /** Block execution error, if the turn failed. */
  error: string | undefined;
  /** Resource keys the seat's execution context resolved. */
  resourceKeys: string[];
  /** Body of the resource named by `readResource`, when it resolved. */
  resourceBody: string | undefined;
}

export interface RunSeatOptions {
  /** The user message. `/name` drives tier-1 skill activation. */
  message: string;
  /** Script one tool call, to observe whether the block is reachable. */
  callTool?: string;
  /** Resolve this resource key from the seat's context and return its body. */
  readResource?: string;
}

/**
 * Run one turn and report what the model saw.
 *
 * The model is a recording stub rather than `mockGenerator` because
 * `mockGenerator` records `messages` only — and the tool list is half of what
 * every probe here is about. Same shape the shipped fence suite uses
 * (`packages/core/test/generator-tools-fence.test.ts`).
 */
export async function runSeat(seat: FlowInstance, options: RunSeatOptions): Promise<Turn> {
  const seen: { tools: string[]; messages: string } = { tools: [], messages: "" };
  let served = false;

  // The authored block appends here when it executes. A fresh path per turn, so
  // one turn can never read another's evidence.
  const marker = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "fix1394-marker-")),
    "ran.log",
  );
  const previousMarker = process.env["FIX1394_MARKER"];
  process.env["FIX1394_MARKER"] = marker;

  const recording: GeneratorModel = {
    modelId: "probe-model",
    async generate(call: any) {
      seen.tools = (call.tools ?? []).map((t: any) => String(t.name));
      seen.messages = JSON.stringify(call.messages);
      // The tool calls ride on the TERMINAL step, which is the contract
      // `generate` has here: one call runs the whole tool loop and returns the
      // finished turn. Asking for a call and no text instead makes the
      // framework's own loop re-invoke until it gives up.
      if (options.callTool !== undefined && !served) {
        served = true;
        const offered = (call.tools ?? []).find((t: any) => t.name === options.callTool);
        if (offered !== undefined) {
          // `generate` is the SDK-DRIVEN path: the framework hands over tools
          // that already carry an `execute` closure and expects the model to
          // run its own loop. So the call is made here, exactly where a real
          // provider adapter would make it, and the block's own marker is what
          // says it ran.
          const result = await offered.execute?.({}, { toolCallId: "probe-1" });
          return {
            text: "done",
            toolCalls: [{ toolCallId: "probe-1", toolName: options.callTool, args: {} }],
            toolResults: [
              { toolCallId: "probe-1", toolName: options.callTool, result },
            ],
            finishReason: "stop",
          } as any;
        }
      }
      return { text: "done", finishReason: "stop" } as any;
    },
  };

  const block = seat.actions.run!.block;
  const runtime = await createTestContext({
    flow: { ...seat, cardinality: "singleton" },
    orgId: "probe-org",
    org: { state: {} },
    sessionId: "probe-session",
    sequencerName: block.name,
    declaredResources: block.declaredResources,
    modelResolver: resolverFor(recording),
  });

  const result = await executeBlock({ block, input: { message: options.message }, ctx: runtime.ctx });

  const toolRan = fs.existsSync(marker) && fs.readFileSync(marker, "utf8").includes("ran");
  if (previousMarker === undefined) delete process.env["FIX1394_MARKER"];
  else process.env["FIX1394_MARKER"] = previousMarker;

  const resources = (runtime.ctx as any).resources ?? {};
  const resourceKeys = Object.keys(resources);
  let resourceBody: string | undefined;
  if (options.readResource !== undefined) {
    const accessor = resources[options.readResource];
    if (accessor !== undefined) {
      try {
        resourceBody = String((await accessor.readContent?.()) ?? (await accessor.get?.()) ?? "");
      } catch (error) {
        resourceBody = `<<unreadable: ${error instanceof Error ? error.message : String(error)}>>`;
      }
    }
  }

  return {
    toolsOffered: seen.tools,
    promptText: seen.messages,
    toolRan,
    error: result.error === undefined ? undefined : String(result.error),
    resourceKeys,
    resourceBody,
  };
}
