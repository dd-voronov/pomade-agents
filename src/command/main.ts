// The `pomade-agents` command's entry (the manifest's `commands`): Pomade's shim in its command
// folder runs it with Pomade's runtime and the app's identity (HOST-API §2 "Commands"); Pomade's
// terminals add the tab it runs in (`POMADE_TAB_ID`). It talks to the app's backend through
// Pomade's socket, as the app's own command.

import { connectSocket, resolveWorkspace } from "pomade-kit/node";

import manifest from "../../public/manifest.json" with { type: "json" };
import { CALL_TIMEOUT_MS, runCli, type Link } from "./cli.ts";

/** How long Pomade has to answer the hello. */
const CONNECT_TIMEOUT_MS = 3000;

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));

async function connect(): Promise<Link> {
  let result;
  try {
    result = await connectSocket({ role: "command", timeoutMs: CONNECT_TIMEOUT_MS });
  } catch (err) {
    return { status: "no-identity", reason: message(err) };
  }
  if (result.status === "not-running") return { status: "not-running" };
  if (result.status === "rejected") return { status: "refused", reason: result.reason };
  const { host } = result;
  return {
    status: "connected",
    call: (method, params) => host.apps.call(manifest.id, method, params, { timeoutMs: CALL_TIMEOUT_MS }),
    projectNames: () =>
      host.project.list().then(
        ({ projects }) => new Map(projects.map((p) => [p.id, p.name])),
        () => new Map(),
      ),
    close: () => host.close(),
  };
}

const tabId = process.env.POMADE_TAB_ID;

process.exitCode = await runCli(process.argv.slice(2), {
  out: (text) => process.stdout.write(text),
  err: (text) => process.stderr.write(text),
  tabId: tabId === undefined || tabId === "" ? null : tabId,
  workspace: () => resolveWorkspace(),
  connect,
});
