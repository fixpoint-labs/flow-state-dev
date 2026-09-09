/**
 * One coding flow with four static doors sharing the host-selected adapter.
 */
import { defineFlow, sequencer, type harnessRunInputSchema } from "@flow-state-dev/core";
import { withOutcome } from "@flow-state-dev/core/helpers";
import type { BlockDefinition, HarnessCallbackContext, HarnessRunHandle } from "@flow-state-dev/core/types";
import type { z } from "zod";
import { codexAgent, type CodexAgentOptions } from "@flow-state-dev/codex";
import { cursorAgent, type CursorAgentOptions } from "@flow-state-dev/cursor";
import {
  DOOR_PREFIX,
  FLOW_KIND,
  fixFsdInputSchema,
  sessionStateSchema,
  taskInputSchema,
  type CodingDoor,
  type FixFsdInput,
  type HostHarness,
  type TaskInput,
} from "./schemas";

type CodingAgent = BlockDefinition<
  typeof harnessRunInputSchema,
  z.ZodType<HarnessRunHandle, z.ZodTypeDef, unknown>
>;

export interface FsdCodingHostOptions {
  /** Host-selected adapter. Omitted means Cursor. */
  harness?: HostHarness;
  /** Directory the harness works in. Closed over — not taken from input. */
  cwd: string;
  /** Explicit host model override; omitted preserves adapter bags/defaults. */
  model?: string;
  /** Explicit host opt-in for Codex sandbox network access. */
  networkAccess?: boolean;
  /** Extra host-selected writable directories for Codex workspace-write runs. */
  additionalDirectories?: string[];
  /** Codex's supported thread/client bags and client seam. Host feeds win. */
  codex?: CodexAgentOptions;
  /**
   * Extra `cursorAgent` options. Tests pass the version-gate seam and client
   * double here. Host-owned keys (`cwd` / `resume` / `onSession`) still win
   * after the spread.
   */
  cursor?: CursorAgentOptions;
}

function readStateId(
  state: Partial<z.infer<typeof sessionStateSchema>> | undefined,
  harness: HostHarness,
): string | null {
  const id = state?.harnessSessions?.[harness];
  return typeof id === "string" && id !== "" ? id : null;
}

/**
 * Hand the stored vendor id to this resume, then drop it. `onSession` writes
 * it back only when the adapter reconfirms a live session. A failed
 * `client.resume` / a Codex stream with no `thread.started` otherwise leaves
 * the dead id in place and `fixFsd` loops on it.
 */
async function consumeStateId(ctx: HarnessCallbackContext, harness: HostHarness): Promise<string | null> {
  return (await withOutcome(
    (mutator) => ctx.session.atomicState(mutator),
    (state: z.infer<typeof sessionStateSchema>) => {
      const id = readStateId(state, harness);
      if (id === null) return { state, result: null };
      const { [harness]: _removed, ...rest } = state.harnessSessions;
      return { state: { ...state, harnessSessions: rest }, result: id };
    },
  )) ?? null;
}

function hostResolvers(options: FsdCodingHostOptions): Pick<CursorAgentOptions, "cwd" | "resume" | "onSession"> {
  const harness = options.harness ?? "cursor";
  return {
    cwd: () => options.cwd,
    resume: (ctx) => consumeStateId(ctx, harness),
    onSession: async (id, ctx) => {
      await ctx.session.atomicState((state: z.infer<typeof sessionStateSchema>) => ({
        ...state,
        harnessSessions: { ...state.harnessSessions, [harness]: id },
      }));
    },
  };
}

function wrapDoor<TInput extends z.ZodType>(
  name: CodingDoor,
  inputSchema: TInput,
  toPrompt: (input: z.infer<TInput>) => string,
  agent: CodingAgent,
) {
  return sequencer({
    name,
    description: name === "fixFsd"
      ? "Declared self-heal door: fix FSD / the harness, then retry the original door"
      : `Declared coding door: ${name}`,
    inputSchema,
  }).step((input: z.infer<TInput>) => ({ prompt: toPrompt(input) }), agent);
}

function taskPrompt(name: "implement" | "fix" | "openPr") {
  return (input: TaskInput) => `${DOOR_PREFIX[name]}\n\n${input.task}`;
}

function fixFsdPrompt(input: FixFsdInput) {
  const notes = input.notes === undefined || input.notes === "" ? "" : `\n\nNotes:\n${input.notes}`;
  return `${DOOR_PREFIX.fixFsd}\n\nRepro:\n${input.repro}${notes}`;
}

/**
 * Build the `fsd-coding` singleton against a host-resolved checkout.
 *
 * Instance id is the kind (singleton default). `--session` distinguishes turns.
 * Do not invent a collection / instance floor (FIX-1320).
 */
export function createFsdCodingFlow(options: FsdCodingHostOptions) {
  const resolvers = hostResolvers(options);
  let agent: CodingAgent;
  switch (options.harness ?? "cursor") {
    case "codex":
      agent = codexAgent({
        ...options.codex,
        ...resolvers,
        name: "codex-agent",
        thread: {
          ...options.codex?.thread,
          ...(options.model === undefined ? {} : { model: options.model }),
          ...(options.networkAccess === undefined || options.networkAccess === false ? {} : {
            networkAccessEnabled: true,
          }),
          ...(options.additionalDirectories === undefined ? {} : {
            additionalDirectories: options.additionalDirectories,
          }),
        },
      });
      break;
    case "cursor": {
      if (options.networkAccess) {
        throw new Error("FSD_CODING_NETWORK_ACCESS is only supported with FSD_CODING_HARNESS=codex");
      }
      if (options.additionalDirectories !== undefined) {
        throw new Error("FSD_CODING_ADD_DIR is only supported with FSD_CODING_HARNESS=codex");
      }
      const configuredAgent = options.cursor?.agent ?? { model: { id: "composer-2.5" } };
      agent = cursorAgent({
        ...options.cursor,
        ...resolvers,
        name: "cursor-agent",
        agent: options.model === undefined ? configuredAgent : {
          ...configuredAgent,
          model: { ...configuredAgent.model, id: options.model },
        },
      });
      break;
    }
    default:
      throw new Error(`invalid harness "${options.harness}"; expected codex or cursor`);
  }

  const definition = defineFlow({
    kind: FLOW_KIND,
    requireUser: true,
    actions: {
      implement: { block: wrapDoor("implement", taskInputSchema, taskPrompt("implement"), agent) },
      fix: { block: wrapDoor("fix", taskInputSchema, taskPrompt("fix"), agent) },
      openPr: { block: wrapDoor("openPr", taskInputSchema, taskPrompt("openPr"), agent) },
      fixFsd: { block: wrapDoor("fixFsd", fixFsdInputSchema, fixFsdPrompt, agent) },
    },
    session: { stateSchema: sessionStateSchema },
  });

  return definition();
}
