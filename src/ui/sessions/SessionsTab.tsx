import type { ReactElement } from "react";
import type { HostClient } from "pomade-kit/sdk";

import { SessionsIcon } from "../core/icons.tsx";
import { StatePage } from "../core/StatePage.tsx";
import { useSessionSummaries } from "./useSessionSummaries.ts";

function plural(n: number): string {
  return n === 1 ? "1 session" : `${n} sessions`;
}

export function SessionsTab({ host }: { host: HostClient }): ReactElement {
  const copy = useSessionSummaries(host);
  const count = copy?.byTranscript.size ?? 0;
  return (
    <StatePage icon={<SessionsIcon size={20} />} title="Sessions" testId="sessions-empty">
      <span
        data-testid="sessions-count"
        data-count={copy === null ? undefined : count}
        data-revision={copy?.since.revision}
        data-indexing={copy?.indexing ? "" : undefined}
      >
        {copy === null ? "Reading the agents' session stores…" : `${plural(count)} indexed${copy.indexing ? " so far" : ""}.`}
      </span>{" "}
      The table of sessions by status isn't built yet.
    </StatePage>
  );
}
