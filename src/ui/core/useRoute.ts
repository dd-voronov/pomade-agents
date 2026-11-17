import { useEffect, useState } from "react";
import type { HostClient } from "pomade-kit/sdk";

/** The frame's current route: the one it was opened at, then every route Pomade navigates it to. */
export function useRoute(host: HostClient): string {
  const [route, setRoute] = useState(host.welcome.route);
  useEffect(() => host.onRouteChange(setRoute), [host]);
  return route;
}
