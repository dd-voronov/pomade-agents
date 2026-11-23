// What the fake Pomade (a Node process) and its shell page (a browser window) say to each other
// over their WebSocket. The fake host lives in Node, where the app's backend can reach it over a
// unix socket; the shell page only hosts the app's frames and relays their postMessage traffic.

/** A frame's id, chosen by the shell: unique within the page. */
export type FrameId = string;

export type ShellToHost =
  /** The shell created a frame: attach it to the host before its page loads. A tab frame shows
   *  the app tab the host opened (`tab` below). */
  | { type: "open"; frame: FrameId; surface: "panel"; icon: string }
  | { type: "open"; frame: FrameId; surface: "tab"; tabId: string }
  /** A message the frame posted to its parent window. */
  | { type: "message"; frame: FrameId; data: unknown };

export type HostToShell =
  /** First message on a connection: which app the shell hosts. */
  | { type: "ready"; app: { id: string; name: string; icon: string | null; strip: { id: string; title: string }[] } }
  /** A message for the frame, to deliver with postMessage. */
  | { type: "post"; frame: FrameId; message: unknown }
  /** The host opened one of the app's tabs (`tabs.openApp`, `fake.openAppTab`): add it to the tab
   *  strip with a frame showing it, and show it. */
  | { type: "tab-opened"; tabId: string; projectId: string }
  /** The host focused an open tab of the app: show it. Its route was already sent to its frames. */
  | { type: "tab-focused"; tabId: string }
  /** The tab closed (`tabs.close`, `fake.closeAppTab`): remove it and its frame. */
  | { type: "tab-closed"; tabId: string };
