/**
 * Commander program definition for the fsdev CLI.
 */
import { Command } from "commander";
import { registerBlockCommand } from "./commands/block.js";
import { registerRunCommand } from "./commands/run.js";

export const program = new Command();

program
  .name("fsdev")
  .description("@flow-state-dev CLI — run, inspect, and scaffold flows")
  .version("0.0.0");

registerBlockCommand(program);
registerRunCommand(program);
