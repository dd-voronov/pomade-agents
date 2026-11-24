// Where the Roster's cards and rows lead: the tab's own navigation. What their other buttons do —
// Start session ▾, Sessions, the ⋯ menu, Re-link, Remove — is `commands/` (`useAgentCommands`),
// shared with the agent's page.

export interface RosterActions {
  /** The agent's page, at its Overview. */
  openAgent(agent: string): void;
  /** The agent's page, at its Projects tab. */
  openProjects(agent: string): void;
  /** The New agent page. */
  newAgent(): void;
  /** The New agent page as a clone of `agent`. */
  cloneAgent(agent: string): void;
}
