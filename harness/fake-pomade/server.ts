// A fake Pomade for an app with a backend: pomade-kit's in-memory fake host, reachable the two
// ways the real Pomade is — over a unix socket for the app's backend (HOST-API §3 "Socket") and,
// through a WebSocket to the shell page, over postMessage for its frames. One fake host answers
// both, so a frame's `apps.call` reaches the backend that called `api.serve`, as in Pomade.
//
// It also plays the part of Pomade's tab strip the fake host only records: one tab of the app per
// project, opened at a route or navigated to it (HOST-API §4 `tabs.openApp`).

import { mkdir, rm } from "node:fs/promises";
import { createServer, type Server, type Socket } from "node:net";
import { dirname } from "node:path";

import { createFakeHost, type FakeHost, type FakeHostOptions, type FrameConnection } from "pomade-kit/fake-host";
import {
  CHANNEL,
  HOST_API_VERSION,
  createLineDecoder,
  encodeLine,
  parseAppMessage,
  parseManifest,
  socketPathProblem,
  type Manifest,
} from "pomade-kit/protocol";
import { WebSocketServer, type WebSocket } from "ws";

import type { FrameId, HostToShell, ShellToHost } from "./shell-protocol.ts";

export interface FakePomadeOptions {
  /** The app's parsed `manifest.json`. */
  manifest: unknown;
  /** Where the backend connects: `<userData>/run/pomade.sock`. */
  socketPath: string;
  /** The key Pomade issued for the app; a backend presenting another one is refused. */
  appKey: string;
  /** The fake host's workspace: projects, files, the active project. */
  host?: Omit<FakeHostOptions, "manifest">;
}

export interface FakePomade {
  /** The fake host: its records (`openedTabs`, `badges`, …) and test controls. */
  readonly fake: FakeHost;
  /** The WebSocket a shell page connects to. */
  readonly shellSocketUrl: string;
  /** How many backends are connected and welcomed now. */
  backendCount(): number;
  /** Stop listening and drop every connection. */
  close(): Promise<void>;
}

function listen(server: Server, target: string | { port: number; host: string }): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    const done = (): void => {
      server.off("error", reject);
      resolve();
    };
    if (typeof target === "string") server.listen(target, done);
    else server.listen(target.port, target.host, done);
  });
}

function manifestOf(raw: unknown): Manifest {
  const parsed = parseManifest(raw);
  if (!parsed.ok) throw new Error(`fake Pomade: invalid manifest — ${parsed.errors.map((e) => e.message).join("; ")}`);
  return parsed.manifest;
}

export async function startFakePomade(options: FakePomadeOptions): Promise<FakePomade> {
  const manifest = manifestOf(options.manifest);
  const tooLong = socketPathProblem(options.socketPath);
  if (tooLong) throw new Error(`fake Pomade: ${tooLong}`);
  const fake = createFakeHost({ ...options.host, manifest: options.manifest });

  // ── Backends: the socket ──────────────────────────────────────────────────

  const sockets = new Set<Socket>();
  const welcomedBackends = new Set<Socket>();
  const socketServer = createServer((socket) => {
    sockets.add(socket);
    socket.setEncoding("utf8");
    const decoder = createLineDecoder();
    const connection = fake.attach(
      (message) => {
        if (message.type === "welcome") welcomedBackends.add(socket);
        if (!socket.destroyed) socket.write(encodeLine(message));
      },
      { surface: "backend" },
    );
    const refuse = (): void => {
      socket.end(encodeLine({ channel: CHANNEL, type: "reject", reason: "unauthorized", hostApi: HOST_API_VERSION }));
    };
    socket.on("data", (chunk: string) => {
      let messages: unknown[];
      try {
        messages = decoder.push(chunk);
      } catch {
        socket.destroy();
        return;
      }
      for (const data of messages) {
        const hello = parseAppMessage(data);
        if (hello?.type === "hello") {
          const client = hello.client;
          if (client?.appId !== manifest.id || client.key !== options.appKey || client.role !== "backend") {
            refuse();
            return;
          }
        }
        connection.receive(data);
      }
    });
    socket.on("error", () => socket.destroy());
    socket.on("close", () => {
      sockets.delete(socket);
      welcomedBackends.delete(socket);
      connection.detach();
    });
  });
  await mkdir(dirname(options.socketPath), { recursive: true });
  await rm(options.socketPath, { force: true });
  await listen(socketServer, options.socketPath);

  // ── Frames: the shell page ────────────────────────────────────────────────

  const shellServer = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await new Promise<void>((resolve, reject) => {
    shellServer.once("listening", resolve);
    shellServer.once("error", reject);
  });
  const address = shellServer.address();
  if (address === null || typeof address === "string") throw new Error("fake Pomade: the shell server has no port");

  shellServer.on("connection", (ws: WebSocket) => {
    const frames = new Map<FrameId, FrameConnection>();
    /** The app's tab in each project's tab strip, by project id. */
    const tabs = new Map<string, FrameConnection>();
    const send = (message: HostToShell): void => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
    };

    /** Act on the `tabs.openApp` calls a frame of this shell just made, as Pomade's tab strip does. */
    const followOpenedTabs = (from: number): void => {
      for (const opened of fake.openedTabs.slice(from)) {
        if (opened.kind !== "app") continue;
        tabs.get(opened.projectId)?.navigate(opened.route);
        send({ type: "tab", projectId: opened.projectId, route: opened.route });
      }
    };

    ws.on("message", (raw) => {
      const message = JSON.parse(String(raw)) as ShellToHost;
      if (message.type === "open") {
        const frame = message.frame;
        const connection = fake.attach(
          (data) => send({ type: "post", frame, message: data }),
          message.surface === "panel" ? { surface: "panel", icon: message.icon } : { surface: "tab", route: message.route },
        );
        frames.set(frame, connection);
        if (message.surface === "tab") tabs.set(message.projectId, connection);
        return;
      }
      const before = fake.openedTabs.length;
      frames.get(message.frame)?.receive(message.data);
      followOpenedTabs(before);
    });
    ws.on("close", () => {
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
  });

  return {
    fake,
    shellSocketUrl: `ws://127.0.0.1:${address.port}`,
    backendCount: () => welcomedBackends.size,
    async close() {
      for (const ws of shellServer.clients) ws.terminate();
      for (const socket of sockets) socket.destroy();
      await Promise.all([
        new Promise<void>((resolve) => shellServer.close(() => resolve())),
        new Promise<void>((resolve) => socketServer.close(() => resolve())),
      ]);
      await rm(options.socketPath, { force: true });
    },
  };
}
