// The project in front in Pomade, for a frame that belongs to none (a panel): the welcome's, then
// each `project.changed`.

import { useEffect, useState } from "react";
import type { ProjectRef } from "pomade-kit/protocol";
import type { HostClient } from "pomade-kit/sdk";

export function useActiveProject(host: HostClient): ProjectRef {
  const [project, setProject] = useState<ProjectRef>(host.welcome.project);
  useEffect(() => host.project.onChange(setProject), [host]);
  return project;
}
