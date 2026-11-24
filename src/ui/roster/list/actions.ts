// What the Roster's frames do. Navigation is the Roster tab's own; a card's or row's other buttons
// (Start session ▾, Sessions, the ⋯ menu, Re-link, Remove, Open agent.yaml, editing the role line
// and tags) are rendered in their places and take their behaviour from here as they are given it.

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
