import { z } from "zod";
import type { BlockDefinition, ConnectorFn } from "../block";
import { handler } from "../../blocks/handler";

const summarizeBlock = handler({
  name: "summarize",
  inputSchema: z.object({ value: z.number() }),
  outputSchema: z.object({ total: z.number() }),
  execute: (input) => ({ total: input.value })
});

const fromStringInput: ConnectorFn<string, { value: number }> = (input) => ({
  value: Number(input)
});

const connectedBlock = summarizeBlock
  .connectInput(fromStringInput)
  .connectOutput((output) => ({ total: (output as { total: number }).total }));

const mappedBlock = connectedBlock.connectOutput((output) =>
  (output as { total: number }).total.toString()
);

void mappedBlock;
export const sequencerConnectorTypeSmoke = true;
