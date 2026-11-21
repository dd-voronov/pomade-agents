// The workspace's projects by stable id — names and workspace-relative roots — from Pomade's
// project list (`project.list`, the `project.read` capability); asked again when a project is
// created or renamed. `null` until the first answer.

import { useEffect, useState } from "react";
import type { ProjectRef } from "pomade-kit/protocol";
import type { HostClient } from "pomade-kit/sdk";

export function useProjects(host: HostClient): ReadonlyMap<string, ProjectRef> | null {
  const [projects, setProjects] = useState<ReadonlyMap<string, ProjectRef> | null>(null);

  useEffect(() => {
    let cancelled = false;
    let asked = 0;
    const ask = async (): Promise<void> => {
      const mine = ++asked;
      try {
        const list = await host.project.list();
        if (!cancelled && mine === asked) setProjects(new Map(list.projects.map((p) => [p.id, p])));
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

  return projects;
}
