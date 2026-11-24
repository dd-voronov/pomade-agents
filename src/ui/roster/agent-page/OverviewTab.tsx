// Overview: the role line and tags edited in place, then the agent's facts — provider, launch
// command (its shell alias, read-only), config folder, `CLAUDE.md` and `agent.yaml` (both open in
// Pomade's editor), when it was last active and its week.

import type { ReactElement } from "react";

import { DocIcon } from "../../core/icons.tsx";
import { RoleLine } from "../profile-edit/RoleLine.tsx";
import { TagList } from "../profile-edit/TagList.tsx";
import { LastActive, ThisWeek } from "./AgentActivity.tsx";
import type { AgentContext } from "./agent-context.ts";
import { PROVIDER_LABELS, claudeMdOf, isBuiltin, isEditable, openPathOf, profileFileOf, providerOf } from "./agent-model.ts";
import { Section } from "./Section.tsx";
import styles from "./page.module.css";

export function OverviewTab({ context }: { context: AgentContext }): ReactElement {
  const { entry, profileEdit, openFile, roots, dataDir } = context;
  const { profile } = entry;
  const editable = isEditable(entry);
  const claudeMd = claudeMdOf(entry);
  const profileFile = profileFileOf(dataDir, entry.id);
  const profilePath = `Apps/pomade-agents/agents/${entry.id}/agent.yaml`;
  const profileLabel = profileFile === null ? profilePath : openPathOf(profileFile, roots);
  return (
    <Section title="Overview" testId="agent-overview">
      <div className={styles.block}>
        <div className={styles.roleRow}>
          <RoleLine role={profile?.role} editable={editable} onSave={(role) => profileEdit.saveRole(entry.id, role)} testId="agent-role" />
        </div>
        <TagList tags={profile?.tags ?? []} editable={editable} onSave={(tags) => profileEdit.saveTags(entry.id, tags)} testId="agent-tags" />
        <dl className={`${styles.facts} ${styles.ruled}`} data-testid="agent-facts">
          <dt>Provider</dt>
          <dd data-testid="fact-provider">
            {PROVIDER_LABELS[providerOf(entry)]} · {isBuiltin(entry) ? "built-in" : "folder agent"}
          </dd>
          <dt>Launch command</dt>
          <dd data-testid="fact-command">
            {profile === null ? (
              <span className={styles.dash} title={entry.problem ?? context.profilesOff ?? undefined}>
                —
              </span>
            ) : (
              <>
                <code>{profile.command}</code>
                <span className={styles.faint}>its shell alias</span>
              </>
            )}
          </dd>
          <dt>Config folder</dt>
          <dd data-testid="fact-config-dir">{profile === null ? <span className={styles.dash}>—</span> : <code>{profile.configDir}</code>}</dd>
          <dt>Identity</dt>
          <dd data-testid="fact-identity">
            {providerOf(entry) === "codex" ? (
              <span className={styles.faint}>Codex has no CLAUDE.md</span>
            ) : (
              <>
                <button type="button" className={styles.link} disabled={claudeMd === null} data-testid="open-claude-md" onClick={() => claudeMd !== null && openFile(claudeMd)}>
                  <DocIcon size={12} /> CLAUDE.md
                </button>
                <span className={styles.faint}>opens in Pomade’s editor</span>
              </>
            )}
          </dd>
          <dt>Profile</dt>
          <dd data-testid="fact-profile">
            <button type="button" className={styles.link} disabled={profileFile === null} data-testid="open-agent-yaml" onClick={() => profileFile !== null && openFile(profileFile)}>
              {profileLabel}
            </button>
          </dd>
          <dt>Last active</dt>
          <dd>
            <LastActive context={context} />
          </dd>
          <dt>This week</dt>
          <dd>
            <ThisWeek context={context} />
          </dd>
        </dl>
      </div>
    </Section>
  );
}
