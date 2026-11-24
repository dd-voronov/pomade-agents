// The fake Pomade's window. It hosts the app's frames the way Pomade does — a side panel for the
// strip icon, the app's tabs the host opens in the tab area — and relays each frame's postMessage traffic to
// the fake host in Node (`?host=<ws url>`); `?app=<url>` is the app's page.

import "pomade-kit/tokens.css";
import "./shell.css";
import type { FrameId, HostToShell, ShellToHost } from "../fake-pomade/shell-protocol.ts";

function param(name: string): string {
  const value = new URLSearchParams(location.search).get(name);
  if (!value) throw new Error(`fake Pomade shell: missing ?${name}=`);
  return value;
}

const appUrl = param("app");
const socket = new WebSocket(param("host"));
const frames = new Map<FrameId, HTMLIFrameElement>();

function send(message: ShellToHost): void {
  socket.send(JSON.stringify(message));
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, parent: HTMLElement): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  el.className = className;
  parent.appendChild(el);
  return el;
}

/** Create a frame, tell the host what it is opened for, then load the app in it. */
function openFrame(parent: HTMLElement, testId: string, open: Extract<ShellToHost, { type: "open" }>): HTMLIFrameElement {
  const iframe = element("iframe", "", parent);
  iframe.dataset.testid = testId;
  iframe.setAttribute("sandbox", "allow-scripts allow-same-origin allow-forms");
  frames.set(open.frame, iframe);
  send(open);
  iframe.src = appUrl;
  return iframe;
}

window.addEventListener("message", (event) => {
  for (const [frame, iframe] of frames) {
    if (event.source === iframe.contentWindow) send({ type: "message", frame, data: event.data });
  }
});

/** The tab area: one tab per app tab the host has open, each with its frame. */
interface TabStrip {
  opened(tabId: string, projectId: string): void;
  focused(tabId: string): void;
  closed(tabId: string): void;
}

function build(app: Extract<HostToShell, { type: "ready" }>["app"]): TabStrip {
  const iconUrl = app.icon === null ? null : new URL(app.icon, appUrl).href;
  const icon = (parent: HTMLElement): void => {
    if (iconUrl === null) return;
    const img = element("img", "", parent);
    img.src = iconUrl;
    img.alt = "";
  };

  const strip = element("nav", "strip", document.body);
  const panel = element("section", "panel", document.body);
  const [panelIcon] = app.strip;
  if (panelIcon) {
    const button = element("button", "stripButton", strip);
    button.type = "button";
    button.title = panelIcon.title;
    button.dataset.testid = `strip-${panelIcon.id}`;
    icon(button);
    element("header", "panelHeader", panel).textContent = panelIcon.title;
    openFrame(panel, "panel-frame", { type: "open", frame: `panel:${panelIcon.id}`, surface: "panel", icon: panelIcon.id });
  }

  const main = element("div", "main", document.body);
  const tabStrip = element("div", "tabStrip", main);
  tabStrip.setAttribute("role", "tablist");
  const panes = element("div", "panes", main);
  const tabs = new Map<string, { button: HTMLButtonElement; iframe: HTMLIFrameElement }>();

  const show = (tabId: string): void => {
    for (const [id, tab] of tabs) {
      tab.button.setAttribute("aria-selected", String(id === tabId));
      tab.iframe.hidden = id !== tabId;
    }
  };

  return {
    opened(tabId, projectId) {
      if (!tabs.has(tabId)) {
        const button = element("button", "tab", tabStrip);
        button.type = "button";
        button.setAttribute("role", "tab");
        button.dataset.testid = `tab-${projectId}`;
        button.title = `Project: ${projectId}`;
        icon(button);
        button.append(app.name);
        button.addEventListener("click", () => show(tabId));
        const iframe = openFrame(panes, `tab-frame-${projectId}`, { type: "open", frame: `tab:${tabId}`, surface: "tab", tabId });
        tabs.set(tabId, { button, iframe });
      }
      show(tabId);
    },
    focused: show,
    closed(tabId) {
      const tab = tabs.get(tabId);
      if (tab === undefined) return;
      tab.button.remove();
      tab.iframe.remove();
      frames.delete(`tab:${tabId}`);
      tabs.delete(tabId);
    },
  };
}

let strip: TabStrip | null = null;

socket.addEventListener("message", (event) => {
  const message = JSON.parse(String(event.data)) as HostToShell;
  switch (message.type) {
    case "ready":
      document.title = `Fake Pomade — ${message.app.name}`;
      strip = build(message.app);
      return;
    case "post":
      frames.get(message.frame)?.contentWindow?.postMessage(message.message, "*");
      return;
    case "tab-opened":
      strip?.opened(message.tabId, message.projectId);
      return;
    case "tab-focused":
      strip?.focused(message.tabId);
      return;
    case "tab-closed":
      strip?.closed(message.tabId);
      return;
  }
});
