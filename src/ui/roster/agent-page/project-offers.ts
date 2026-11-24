// Connecting an agent to a project and taking it away again (DESIGN §3.4, `pomade:E-030`): the
// project's visible agents — the list its "+" menu offers — is the one stored fact, written with
// `project.setAgents` as a whole list. Each write reads the list first and edits that, so a change
// made elsewhere in the meantime is kept; a project that offers every agent (`["*"]`) is never
// rewritten from here.

import { HostError, type HostClient } from "pomade-kit/sdk";

import { EVERY_AGENT, withAgent, withoutAgent } from "./projects-model.ts";

export type OfferChange =
  | { done: true; /** The list as it stood before the write. */ before: readonly string[] }
  | { done: false; reason: string };

/** Why a write did not go through, in plain words; the host's own message is the hover text. */
export function offerFailure(err: unknown): { text: string; title: string } {
  const message = err instanceof Error ? err.message : String(err);
  const code = err instanceof HostError ? err.code : null;
  const cause = code === "not-found" ? "Pomade no longer has the project." : code === "invalid-params" ? "Pomade refused the list." : "Something went wrong.";
  return { text: `The project’s agents were not changed. ${cause}`, title: message };
}

/** Offer `agent` in the project's "+" menu. `at` puts it at that place of the list (an Undo of a disconnect). */
export async function connectAgent(host: HostClient, projectId: string, agent: string, at?: number): Promise<OfferChange> {
  const { visibleAgents } = await host.project.getAgents({ projectId });
  if (visibleAgents.includes(EVERY_AGENT)) return { done: false, reason: "The project offers every agent." };
  if (visibleAgents.includes(agent)) return { done: false, reason: `The project already offers ${agent}.` };
  await host.project.setAgents({ projectId, visibleAgents: withAgent(visibleAgents, agent, at) });
  return { done: true, before: visibleAgents };
}

/** Stop offering `agent` in the project's "+" menu; its sessions there stay. */
export async function disconnectAgent(host: HostClient, projectId: string, agent: string): Promise<OfferChange> {
  const { visibleAgents } = await host.project.getAgents({ projectId });
  if (visibleAgents.includes(EVERY_AGENT)) return { done: false, reason: "The project offers every agent: change its setting in the project’s own settings." };
  if (!visibleAgents.includes(agent)) return { done: false, reason: `The project does not offer ${agent}.` };
  await host.project.setAgents({ projectId, visibleAgents: withoutAgent(visibleAgents, agent) });
  return { done: true, before: visibleAgents };
}
