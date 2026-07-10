/**
 * Commander program definition for the fsdev CLI.
 */
import { Command } from "commander";
import { registerBenchmarkCommand } from "./commands/benchmark";
import { registerBlockCommand } from "./commands/block";
import { registerChatCommand } from "./commands/chat";
import { registerDevCommand } from "./commands/dev";
import { registerRunCommand } from "./commands/run";
import { registerUiCommand } from "./commands/ui";

export const program = new Command();

program
  .name("fsdev")
  .description("@flow-state-dev CLI — run, inspect, and scaffold flows")
  .version("0.0.0");

registerBlockCommand(program);
registerChatCommand(program);
registerDevCommand(program);
registerRunCommand(program);
registerUiCommand(program);
registerBenchmarkCommand(program);
