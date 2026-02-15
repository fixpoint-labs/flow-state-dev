import type { BlockDefinition, ConnectorFn } from "../block";

declare const summarizeBlock: BlockDefinition<{ value: number }, { total: number }>;

const fromStringInput: ConnectorFn<string, { value: number }> = (input) => ({
  value: Number(input)
});

const connectedBlock: BlockDefinition<string, { total: number }> = summarizeBlock
  .connectInput(fromStringInput)
  .connectOutput((output) => ({ total: output.total }));

const mappedBlock: BlockDefinition<string, string> = connectedBlock.connectOutput((output) =>
  output.total.toString()
);

void mappedBlock;
export const sequencerConnectorTypeSmoke = true;
