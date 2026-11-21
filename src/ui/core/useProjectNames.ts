// The workspace's project names by stable id, from Pomade's project list (`project.list`, the
// `project.read` capability); asked again when a project is created or renamed. `null` until the
// first answer.

import { useEffect, useState } from "react";
import type { HostClient } from "pomade-kit/sdk";

export function useProjectNames(host: HostClient): ReadonlyMap<string, string> | null {
  const [names, setNames] = useState<ReadonlyMap<string, string> | null>(null);

  useEffect(() => {
    let cancelled = false;
    let asked = 0;
    const ask = async (): Promise<void> => {
      const mine = ++asked;
      try {
        const list = await host.project.list();
        if (!cancelled && mine === asked) setNames(new Map(list.projects.map((p) => [p.id, p.name])));
      } catch {
        // Names fall back to the welcome's scope name and project ids until the next change asks again.
      }
    };
    const subscriptions = [host.events.subscribe("project.created", () => void ask()), host.events.subscribe("project.renamed", () => void ask())];
    void ask();
    return () => {
      cancelled = true;
      for (const subscription of subscriptions) void subscription.then((s) => s.close()).catch(() => undefined);
    };
  }, [host]);

  return names;
}
