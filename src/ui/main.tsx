// The UI's entry. The handshake runs once, before React mounts: until Pomade answers (or 1500 ms
// pass without one) the frame stays blank on its surface's background.

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { connect } from "pomade-kit/sdk";

import "./core/tokens.css";
import "./core/base.css";
import { App } from "./core/App.tsx";

const root = document.getElementById("root");
if (!root) throw new Error("Agents: index.html has no #root");

const connection = await connect();
if (connection.status === "connected") document.documentElement.dataset.surface = connection.host.welcome.surface;

createRoot(root).render(
  <StrictMode>
    <App connection={connection} />
  </StrictMode>,
);
