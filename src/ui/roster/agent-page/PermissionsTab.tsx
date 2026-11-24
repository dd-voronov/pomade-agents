// Permissions: what the agent's provider config grants — permissions, MCP servers, plugins — read
// only, with a button that opens the config file in Pomade's editor. Claude Code: `settings.json`
// and `.claude.json`; Codex: `config.toml`.

import type { ReactElement } from "react";

import { OpenIcon, WarningIcon } from "../../core/icons.tsx";
import { ROSTER_PERMISSIONS_METHOD, isAgentPermissions, type AgentPermissions } from "../../../shared/roster.ts";
import type { AgentContext } from "./agent-context.ts";
import { Section } from "./Section.tsx";
import styles from "./page.module.css";
import { useAgentRead } from "./useAgentRead.ts";

function Codes({ items }: { items: readonly string[] }): ReactElement {
  if (items.length === 0) return <span className={styles.dash}>none</span>;
  return (
    <>
      {items.map((item) => (
        <code key={item}>{item}</code>
      ))}
    </>
  );
}

function Facts({ permissions }: { permissions: AgentPermissions }): ReactElement {
  const claude = permissions.provider === "claude";
  return (
    <dl className={styles.facts} data-testid="permissions-facts">
      <dt>{claude ? "Default mode" : "Approvals"}</dt>
      <dd data-testid="perm-mode">{permissions.defaultMode === null ? <span className={styles.dash}>not set</span> : <code>{permissions.defaultMode}</code>}</dd>
      {!claude && (
        <>
          <dt>Sandbox</dt>
          <dd data-testid="perm-sandbox">{permissions.sandbox === null ? <span className={styles.dash}>not set</span> : <code>{permissions.sandbox}</code>}</dd>
        </>
      )}
      {claude && (
        <>
          <dt>Allow</dt>
          <dd data-testid="perm-allow">
            <Codes items={permissions.allow} />
          </dd>
          {permissions.ask.length > 0 && (
            <>
              <dt>Ask</dt>
              <dd data-testid="perm-ask">
                <Codes items={permissions.ask} />
              </dd>
            </>
          )}
          <dt>Deny</dt>
          <dd data-testid="perm-deny">
            <Codes items={permissions.deny} />
          </dd>
        </>
      )}
      <dt>MCP servers</dt>
      <dd data-testid="perm-mcp">
        {permissions.mcp.length === 0 ? (
          <span className={styles.dash}>none</span>
        ) : (
          permissions.mcp.map((server) => (
            <span key={server.name} className={styles.pair}>
              <code>{server.name}</code>
              {server.type !== null && <span className={styles.faint}>{server.type}</span>}
            </span>
          ))
        )}
      </dd>
      {claude && (
        <>
          <dt>Plugins</dt>
          <dd data-testid="perm-plugins">
            <Codes items={permissions.plugins} />
          </dd>
        </>
      )}
    </dl>
  );
}

export function PermissionsTab({ context }: { context: AgentContext }): ReactElement {
  const { host, entry, revision, openFile } = context;
  const read = useAgentRead(host, ROSTER_PERMISSIONS_METHOD, entry.id, isAgentPermissions, revision);
  const permissions = read.status === "ready" ? read.value : null;
  const fileName = permissions === null ? "settings.json" : (permissions.file.split("/").at(-1) ?? "settings.json");
  const open =
    permissions === null ? null : (
      <button
        type="button"
        className={`${styles.btn} ${styles.sm}`}
        disabled={!permissions.exists}
        title={permissions.exists ? undefined : `${fileName} does not exist yet`}
        data-testid="open-settings"
        onClick={() => openFile(permissions.file)}
      >
        <OpenIcon size={14} />
        Open {fileName}
      </button>
    );
  return (
    <Section title="Permissions, MCP, plugins" action={open} testId="agent-permissions">
      <div className={styles.block}>
        {read.status === "loading" && <p className={styles.none}>Reading the config…</p>}
        {read.status === "refused" && (
          <p className={styles.none} data-testid="permissions-refused">
            This agent’s config cannot be read: {read.reason}
          </p>
        )}
        {permissions !== null && (
          <>
            {permissions.problem !== null && (
              <div className={styles.notice} data-testid="permissions-problem">
                <WarningIcon size={14} />
                <span>
                  <code>{fileName}</code> cannot be read: {permissions.problem}.
                </span>
              </div>
            )}
            <Facts permissions={permissions} />
            <p className={styles.hint}>
              Read-only.{" "}
              {permissions.provider === "claude" ? (
                <>
                  From <code>settings.json</code> and <code>.claude.json</code>.
                </>
              ) : (
                <>
                  From <code>config.toml</code>.
                </>
              )}
            </p>
          </>
        )}
      </div>
    </Section>
  );
}
