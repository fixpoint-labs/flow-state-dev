/**
 * One coding flow with four static doors sharing the host-selected adapter.
 */
import { defineFlow, sequencer, type harnessRunInputSchema } from "@flow-state-dev/core";
import type { BlockDefinition, HarnessRunHandle } from "@flow-state-dev/core/types";
import type { z } from "zod";
import { codexAgent, type CodexAgentOptions } from "@flow-state-dev/codex";
import { cursorAgent, type CursorAgentOptions } from "@flow-state-dev/cursor";
import { createHostResolvers, type HostResolverOptions } from "./host";
import {
  DOOR_PREFIX,
  FLOW_KIND,
  fixFsdInputSchema,
  sessionStateSchema,
  taskInputSchema,
  type FixFsdInput,
  type TaskInput,
} from "./schemas";

type CodingAgent = BlockDefinition<typeof harnessRunInputSchema, z.ZodType<HarnessRunHandle, z.ZodTypeDef, unknown>>;

export interface FsdCodingHostOptions extends HostResolverOptions {
  /** Explicit host model override; omitted preserves adapter bags/defaults. */
  model?: string;
  /** Explicit host opt-in for Codex sandbox network access. */
  networkAccess?: boolean;
  /** Extra host-selected writable directories for Codex workspace-write runs. */
  additionalDirectories?: string[];
  /** Codex's supported thread/client bags and client seam. Host feeds win. */
  codex?: CodexAgentOptions;
  /** SDK client seam. Tests inject a scripted double; live omits it. */
  resolveCursorClient?: CursorAgentOptions["resolveCursorClient"];
  /** Forwarded Cursor `agent` bag (model, apiKey). `local.cwd` is refused. */
  agent?: CursorAgentOptions["agent"];
  /**
   * Extra `cursorAgent` options. Tests pass the version-gate seam here.
   * Host-owned keys (`cwd` / `resume` / `onSession`) still win after the spread.
   */
  cursor?: CursorAgentOptions;
}

function wrapDoor<TInput extends z.ZodType>(
  name: "implement" | "fix" | "openPr" | "fixFsd",
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
 * Build the `fsd-coding` flow against a host-resolved checkout.
 */
export function createFsdCodingFlow(options: FsdCodingHostOptions) {
  const resolvers = createHostResolvers(options);
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
        throw new Error("--network-access is only supported with --harness codex");
      }
      const configuredAgent = options.agent ?? options.cursor?.agent ?? { model: { id: "composer-2.5" } };
      agent = cursorAgent({
        ...options.cursor,
        ...resolvers,
        name: "cursor-agent",
        resolveCursorClient: options.resolveCursorClient ?? options.cursor?.resolveCursorClient,
        agent: options.model === undefined ? configuredAgent : {
          ...configuredAgent,
          model: { ...configuredAgent.model, id: options.model },
        },
        // A per-turn model must not undo the explicit host choice on send/resume.
        ...(options.model === undefined ? {} : {
          send: {
            ...options.cursor?.send,
            model: { ...options.cursor?.send?.model, id: options.model },
          },
        }),
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

  return definition({ id: "default" });
}
