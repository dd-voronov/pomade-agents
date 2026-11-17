// What the app shows when it has no Pomade to talk to (HOST-API §3, §6): opened outside Pomade,
// or inside a Pomade that speaks another Host API version.

import type { ReactElement } from "react";
import type { RejectReason } from "pomade-kit/sdk";

import { UnpluggedIcon } from "./icons.tsx";
import { StatePage } from "./StatePage.tsx";

export function NoHost(): ReactElement {
  return (
    <StatePage icon={<UnpluggedIcon size={20} />} title="No Pomade host" tone="warning" testId="no-host">
      Agents is a Pomade app. Open it from the Agents icon in Pomade's left strip.
    </StatePage>
  );
}

const REJECTED: Record<RejectReason, { title: string; text: string }> = {
  "needs-newer-pomade": {
    title: "Agents needs a newer Pomade",
    text: "This build of Agents speaks a newer Host API than this Pomade. Update Pomade, then open Agents again.",
  },
  "app-too-old": {
    title: "Agents needs an update",
    text: "This Pomade speaks a newer Host API than this build of Agents. Install the current Agents build.",
  },
  unauthorized: {
    title: "Pomade refused Agents",
    text: "Pomade did not accept this frame as the Agents app. Reinstall Agents, then open it again.",
  },
};

export function Rejected({ reason }: { reason: RejectReason }): ReactElement {
  const { title, text } = REJECTED[reason];
  return (
    <StatePage icon={<UnpluggedIcon size={20} />} title={title} tone="warning" testId="rejected">
      {text}
    </StatePage>
  );
}
