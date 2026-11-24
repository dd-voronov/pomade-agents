// The fake Pomade's frame side: a WebSocket the shell page (`index.html`) connects to, relaying
// each of its frames' postMessage traffic to the fake host in Node — the host the app's backend
// reaches over the socket, so a frame's `apps.call` reaches the backend that called `api.serve`.
//
// The app's own tabs are the fake host's (HOST-API §4 `tabs.openApp`, `tabs.setRoute`): it opens,
// focuses, navigates and closes them as Pomade does; the shell page shows each one with a frame
// attached to it, which follows the tab's route.

import type { FakeHost, FrameConnection } from "pomade-kit/fake-host";
import type { Manifest } from "pomade-kit/protocol";
import { WebSocketServer, type WebSocket } from "ws";

import type { FrameId, HostToShell, ShellToHost } from "./protocol.ts";

export interface FrameRelay {
  /** The WebSocket a shell page connects to. */
  readonly url: string;
  /** Drop every shell page and stop listening. */
  close(): Promise<void>;
}

export async function startFrameRelay(fake: FakeHost, manifest: Manifest): Promise<FrameRelay> {
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("fake Pomade: the shell relay has no port");

  server.on("connection", (ws: WebSocket) => {
    const frames = new Map<FrameId, FrameConnection>();
    /** The frames showing each app tab, by tab id. */
    const tabFrames = new Map<string, FrameId[]>();
    const send = (message: HostToShell): void => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
    };
    const unfollow = fake.onAppTab(({ change, tab }) => {
      if (change === "open") send({ type: "tab-opened", tabId: tab.tabId, projectId: tab.projectId });
      else if (change === "focus") send({ type: "tab-focused", tabId: tab.tabId });
      else if (change === "close") {
        for (const frame of tabFrames.get(tab.tabId) ?? []) {
          frames.get(frame)?.detach();
          frames.delete(frame);
        }
        tabFrames.delete(tab.tabId);
        send({ type: "tab-closed", tabId: tab.tabId });
      }
    });

    ws.on("message", (raw) => {
      const message = JSON.parse(String(raw)) as ShellToHost;
      if (message.type === "open") {
        const frame = message.frame;
        const post = (data: unknown): void => send({ type: "post", frame, message: data });
        if (message.surface === "panel") frames.set(frame, fake.attach(post, { surface: "panel", icon: message.icon }));
        else {
          frames.set(frame, fake.attach(post, { tabId: message.tabId }));
          tabFrames.set(message.tabId, [...(tabFrames.get(message.tabId) ?? []), frame]);
        }
        return;
      }
      frames.get(message.frame)?.receive(message.data);
    });
    ws.on("close", () => {
      unfollow();
      for (const connection of frames.values()) connection.detach();
    });

    send({
      type: "ready",
      app: {
        id: manifest.id,
        name: manifest.name,
        icon: manifest.icon ?? null,
        strip: (manifest.strip ?? []).filter((icon) => icon.action !== "tab").map(({ id, title }) => ({ id, title })),
      },
    });
    // Tabs the host opened before this window connected (Pomade restores them at launch).
    for (const tab of fake.appTabs) send({ type: "tab-opened", tabId: tab.tabId, projectId: tab.projectId });
  });

  return {
    url: `ws://127.0.0.1:${address.port}`,
    async close() {
      for (const ws of server.clients) ws.terminate();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
