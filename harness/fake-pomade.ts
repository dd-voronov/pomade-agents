// A fake Pomade for an app with a backend: pomade-kit's in-memory fake host, reachable the two
// ways the real Pomade is — the kit's socket side (`serveFakeHost`, HOST-API §3 "Socket") for the
// app's backend and, through the shell page's relay (`shell/relay.ts`), postMessage for its
// frames. One fake host answers both: the broker, events, `project.*`, `agentTabs.*` and the app's
// tabs are all the kit's.

import { createFakeHost, type FakeHost, type FakeHostOptions } from "pomade-kit/fake-host";
import { serveFakeHost } from "pomade-kit/fake-host/node";
import { parseManifest, type ClientRole } from "pomade-kit/protocol";

import { startFrameRelay } from "./shell/relay.ts";

/** Where Pomade keeps its socket, relative to its user data. */
const SOCKET_FILE = "/run/pomade.sock";

export interface FakePomadeOptions {
  /** The app's parsed `manifest.json`. */
  manifest: unknown;
  /** Where the backend connects: `<userData>/run/pomade.sock` (the sandbox's `socketPath`). */
  socketPath: string;
  /** The key issued for the app at `<userData>/app-keys/<appId>` (the sandbox's `appKey`); a
   *  backend presenting another one is refused. */
  appKey: string;
  /** The fake host's workspace: projects, files, the active project. */
  host?: Omit<FakeHostOptions, "manifest">;
}

export interface FakePomade {
  /** The fake host: its records (`openedTabs`, `badges`, …) and test controls. */
  readonly fake: FakeHost;
  /** The WebSocket a shell page connects to. */
  readonly shellSocketUrl: string;
  /** The environment this Pomade gives the app's backend (`"backend"`) or a command. */
  env(role?: ClientRole): Record<string, string>;
  /** How many backends are connected and welcomed now. */
  backendCount(): number;
  /** Stop listening and drop every connection. */
  close(): Promise<void>;
}

export async function startFakePomade(options: FakePomadeOptions): Promise<FakePomade> {
  const parsed = parseManifest(options.manifest);
  if (!parsed.ok) throw new Error(`fake Pomade: invalid manifest — ${parsed.errors.map((e) => e.message).join("; ")}`);
  if (!options.socketPath.endsWith(SOCKET_FILE)) throw new Error(`fake Pomade: ${options.socketPath} is not <userData>${SOCKET_FILE}`);
  const userData = options.socketPath.slice(0, -SOCKET_FILE.length);

  const fake = createFakeHost({ ...options.host, manifest: options.manifest });
  const socket = await serveFakeHost(fake, { userData });
  if (socket.key !== options.appKey) {
    await socket.close();
    throw new Error(`fake Pomade: the key at ${socket.keyFile} is not the app's key`);
  }
  const relay = await startFrameRelay(fake, parsed.manifest);

  return {
    fake,
    shellSocketUrl: relay.url,
    env: (role) => socket.env(role),
    backendCount: () => socket.clients().filter((client) => client.role === "backend").length,
    async close() {
      await Promise.all([relay.close(), socket.close()]);
    },
  };
}
