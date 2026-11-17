// What the fake Pomade (a Node process) and its shell page (a browser window) say to each other
// over their WebSocket. The fake host lives in Node, where the app's backend can reach it over a
// unix socket; the shell page only hosts the app's frames and relays their postMessage traffic.

/** A frame's id, chosen by the shell: unique within the page. */
export type FrameId = string;

export type ShellToHost =
  /** The shell created a frame: attach it to the host before its page loads. A tab frame names
   *  the project whose tab strip it is in. */
  | { type: "open"; frame: FrameId; surface: "panel"; icon: string }
  | { type: "open"; frame: FrameId; surface: "tab"; route: string; projectId: string }
  /** A message the frame posted to its parent window. */
  | { type: "message"; frame: FrameId; data: unknown };

export type HostToShell =
  /** First message on a connection: which app the shell hosts. */
  | { type: "ready"; app: { id: string; name: string; icon: string | null; strip: { id: string; title: string }[] } }
  /** A message for the frame, to deliver with postMessage. */
  | { type: "post"; frame: FrameId; message: unknown }
  /** The app asked for its tab in a project (`tabs.openApp`): show that project's tab, creating it
   *  at `route` when the project has none. An existing tab was already navigated by the host. */
  | { type: "tab"; projectId: string; route: string };
