/**
 * What the `fsd` profile (`fsd.fsdev.config.mts`) opens its Lab with: its two
 * projects, the MCP servers it offers them, and the brief and commit style its
 * coders read. A
 * leaf, so a check can open a Lab the same way without serving the profile.
 */
import type { CreateProjectInput, ProjectMcpServers } from "@flow-state-dev/workforce";
import { REPOSITORY } from "./fsd-checkouts.mts";
import { LAB_CROWD, LAB_USERS } from "./host.mts";

/** Who may open workstreams in each project: the Lab's other users, as in DevTeam's. */
const OTHER_USERS = [LAB_USERS.member.userId, ...LAB_CROWD.map((u) => u.userId)];

/**
 * The MCP servers this profile offers its projects: Linear's hosted server.
 * Each user sets their own Linear key on Settings; `LINEAR_MCP_API_KEY` stands
 * in for the Lab's own user only, while that user has none stored.
 */
export const FSD_MCP_SERVERS: ProjectMcpServers = {
  linear: { url: "https://mcp.linear.app/mcp", seedEnv: "LINEAR_MCP_API_KEY" },
};

/** The ref of the brief every worker on the coder flow reads, in DevTeam's tree. */
export const CODER_BRIEF = "teams/eng/feature-brief";

/** Passed as `openLab`'s `documents`: bodies that replace the tree's, by ref. */
export const FSD_DOCUMENTS: Readonly<Record<string, string>> = {
  [CODER_BRIEF]: [
    "# Working in this repository",
    "",
    "You work in a checkout of the flow-state-dev repository. The task you are",
    "handed is the whole job: do what it asks and nothing else.",
    "",
    "Read AGENTS.md and CLAUDE.md at the repository root before you change",
    "anything, and follow them. Keep the change to what the task needs.",
  ].join("\n"),
};

/** Passed as `openLab`'s `skills`: skill text that replaces the tree's, by name. */
export const FSD_SKILLS: Readonly<Record<string, string>> = {
  "commit-style": [
    "---",
    "name: commit-style",
    "description: How a commit message is written in this repository.",
    "---",
    "",
    "Write the commit message the way this repository's AGENTS.md and recent",
    "history on main do. Name what changed and why; add no marker line.",
  ].join("\n"),
};

/** The two projects a fresh open shows. Both name Linear, so their coding runs can read an issue. */
export const FSD_PROJECTS: readonly CreateProjectInput[] = [
  {
    id: "fsd",
    title: "FSD",
    brief: "The framework: the packages under packages/ other than Shift Manager, their docs and their goal checks.",
    members: OTHER_USERS,
    repository: REPOSITORY,
    mcpServers: ["linear"],
  },
  {
    id: "shift-manager",
    title: "Shift Manager",
    brief: "This app: packages/shift-manager, its pages, its team profiles and its checks under goals/shift-manager/.",
    members: OTHER_USERS,
    repository: REPOSITORY,
    mcpServers: ["linear"],
  },
];
