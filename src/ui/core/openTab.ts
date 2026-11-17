import type { HostClient } from "pomade-kit/sdk";

/** Open or focus the app's tab at `route` in the active project (HOST-API §4 `tabs.openApp`). */
export function openTab(host: HostClient, route: string): void {
  host.tabs.openApp({ route }).catch((err: unknown) => {
    console.error(`Agents: could not open the tab at "${route}"`, err);
  });
}
