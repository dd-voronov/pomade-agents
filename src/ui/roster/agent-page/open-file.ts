// Open a file in Pomade's editor (`tabs.openFile`, HOST-API §4): a workspace-relative path inside the
// workspace, an absolute one outside it. The tab opens in the project in front. A refused open says
// why in a toast.

import { useCallback } from "react";
import { HostError, type HostClient } from "pomade-kit/sdk";

import type { ShowToast } from "../../sessions/useToast.ts";
import { openPathOf, type WorkspaceRoots } from "./agent-model.ts";

const CAUSES: Record<string, string> = {
  "not-found": "The file is not there.",
  "io-error": "The file cannot be opened.",
  "capability-denied": "Pomade does not let the app open it.",
  "outside-workspace": "Pomade does not let the app open files there.",
};

export function useOpenFile(host: HostClient, roots: WorkspaceRoots, show: ShowToast): (absolute: string) => void {
  const { workspace, workspaceReal } = roots;
  return useCallback(
    (absolute) => {
      const path = openPathOf(absolute, { workspace, workspaceReal });
      host.tabs.openFile({ path }).catch((err: unknown) => {
        const cause = err instanceof HostError ? (CAUSES[err.code] ?? "Something went wrong.") : "Something went wrong.";
        show(`${path.split("/").at(-1) ?? path} was not opened. ${cause}`, null, err instanceof Error ? err.message : String(err));
      });
    },
    [host, workspace, workspaceReal, show],
  );
}
