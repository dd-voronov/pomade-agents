// Each project's visible agents — the agents its "+" menu offers (`project.getAgents`, HOST-API §4
// `project.read`) — kept current: read for the projects named, and again whenever a project's
// agents, group, name or presence changes (`project.updated`, `project.created`, `project.renamed`,
// `project.removed`). A project whose list cannot be read (removed meanwhile) is left out. `null`
// until the first answer.

import { useEffect, useState } from "react";
import type { HostClient } from "pomade-kit/sdk";

const PROJECT_EVENTS = ["project.created", "project.renamed", "project.removed", "project.updated"] as const;

export function useVisibleAgents(host: HostClient, projectIds: readonly string[]): ReadonlyMap<string, readonly string[]> | null {
  const [visible, setVisible] = useState<ReadonlyMap<string, readonly string[]> | null>(null);
  const key = projectIds.join("\n");

  useEffect(() => {
    let cancelled = false;
    let asked = 0;
    const ids = key === "" ? [] : key.split("\n");
    const ask = async (): Promise<void> => {
      const mine = ++asked;
      const lists = await Promise.all(ids.map((projectId) => host.project.getAgents({ projectId }).then((answer) => [projectId, answer.visibleAgents] as const, () => null)));
      if (!cancelled && mine === asked) setVisible(new Map(lists.filter((entry) => entry !== null)));
    };
    const subscriptions = PROJECT_EVENTS.map((event) => host.events.subscribe(event, () => void ask()));
    void Promise.allSettled(subscriptions).then(() => ask());
    return () => {
      cancelled = true;
      for (const subscription of subscriptions) void subscription.then((s) => s.close()).catch(() => undefined);
    };
  }, [host, key]);

  return visible;
}
