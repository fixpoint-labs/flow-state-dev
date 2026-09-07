/**
 * One coding flow. Four static doors. One Cursor harness.
 *
 * No Conductor, no Workforce, no board, no dynamic dispatcher address.
 * Each door is a sequencer that stamps a prefix onto `{ prompt }` and
 * hands that to the same `cursorAgent` instance.
 */
import { defineFlow, sequencer } from "@flow-state-dev/core";
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

export interface FsdCodingHostOptions extends HostResolverOptions {
  /** SDK client seam. Tests inject a scripted double; live omits it. */
  resolveCursorClient?: CursorAgentOptions["resolveCursorClient"];
  /** Forwarded Cursor `agent` bag (model, apiKey). `local.cwd` is refused. */
  agent?: CursorAgentOptions["agent"];
  /**
   * Extra `cursorAgent` options. Tests pass the version-gate seam here.
   * Host-owned keys (`cwd` / `resume` / `onSession`) still win after the spread.
   */
  cursor?: CursorAgentOptions;
  instanceId?: string;
}

function wrapTaskDoor(
  name: "implement" | "fix" | "openPr",
  agent: ReturnType<typeof cursorAgent>,
) {
  return sequencer({
    name,
    description: `Declared coding door: ${name}`,
    inputSchema: taskInputSchema,
  }).step((input: TaskInput) => ({ prompt: `${DOOR_PREFIX[name]}\n\n${input.task}` }), agent);
}

function wrapFixFsdDoor(agent: ReturnType<typeof cursorAgent>) {
  return sequencer({
    name: "fixFsd",
    description: "Declared self-heal door: fix FSD / the harness, then retry the original door",
    inputSchema: fixFsdInputSchema,
  }).step((input: FixFsdInput) => {
    const notes = input.notes === undefined || input.notes === "" ? "" : `\n\nNotes:\n${input.notes}`;
    return {
      prompt: `${DOOR_PREFIX.fixFsd}\n\nRepro:\n${input.repro}${notes}`,
    };
  }, agent);
}

/**
 * Build the `fsd-coding` flow against a host-resolved checkout.
 */
export function createFsdCodingFlow(options: FsdCodingHostOptions) {
  const resolvers = createHostResolvers(options);
  const agent = cursorAgent({
    ...(options.cursor ?? {}),
    name: "cursor-agent",
    cwd: resolvers.cwd,
    resume: resolvers.resume,
    onSession: resolvers.onSession,
    resolveCursorClient: options.resolveCursorClient,
    agent: options.agent ?? { model: { id: "composer-2.5" } },
  });

  const definition = defineFlow({
    kind: FLOW_KIND,
    requireUser: true,
    actions: {
      implement: { block: wrapTaskDoor("implement", agent) },
      fix: { block: wrapTaskDoor("fix", agent) },
      openPr: { block: wrapTaskDoor("openPr", agent) },
      fixFsd: { block: wrapFixFsdDoor(agent) },
    },
    session: { stateSchema: sessionStateSchema },
  });

  return definition({ id: options.instanceId ?? "default" });
}
