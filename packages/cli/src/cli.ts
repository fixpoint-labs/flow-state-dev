/**
 * Commander program definition for the fsdev CLI.
 */
import { Command } from "commander";
import { registerBenchmarkCommand } from "./commands/benchmark";
import { registerBlockCommand } from "./commands/block";
import { registerChatCommand } from "./commands/chat";
import { registerConductorCommand } from "./commands/conductor";
import { registerDevCommand } from "./commands/dev";
import { registerRunCommand } from "./commands/run";
import { registerServeCommand } from "./commands/serve";
import { registerUiCommand } from "./commands/ui";

export const program = new Command();

program
  .name("fsdev")
  .description("@flow-state-dev CLI — run, inspect, and scaffold flows")
  .version("0.0.0");

registerBlockCommand(program);
registerChatCommand(program);
registerConductorCommand(program);
registerDevCommand(program);
registerRunCommand(program);
registerServeCommand(program);
registerUiCommand(program);
registerBenchmarkCommand(program);
